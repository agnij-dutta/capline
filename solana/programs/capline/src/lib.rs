// Capline — on-chain spend authority for AI agents, Solana edition.
//
// The thesis, unchanged from the EVM original: the spend limit is not a sentence
// in a prompt, it's a contract the LLM cannot talk to. The novel part on Solana
// is that we enforce a *multi-dimensional AP2 mandate* — per-tx cap, cumulative
// cap, expiry window, and a merchant allowlist — not just a single number. That
// is the "up-stack" move: Solana's native allowance primitive enforces a number;
// Capline enforces the signed intent the number came from.
//
// Enforcement lives in `settle`. Even a fully compromised agent key — an attacker
// who steals the signer and is prompt-injected to pay 1000 USDC to a scammer —
// is reverted on-chain: over cap, wrong merchant, or past expiry, the transfer
// never happens. The worst a jailbroken brain can do is *ask*.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::ed25519_program;
use solana_sha256_hasher::hash;

declare_id!("DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp");

/// Max merchants in an allowlist. Bounded so the account is fixed-size.
pub const MAX_MERCHANTS: usize = 8;

#[program]
pub mod capline {
    use super::*;

    /// A principal (the human/owner) grants a bounded, revocable mandate to an
    /// agent's wallet. The mandate PDA owns a vault the agent spends *from* — but
    /// only through `settle`, which enforces every constraint on-chain.
    pub fn create_mandate(
        ctx: Context<CreateMandate>,
        nonce: u64,
        agent: Pubkey,
        max_per_tx: u64,
        total_cap: u64,
        not_after: i64,
        ap2_hash: [u8; 32],
        merchants: Vec<Pubkey>,
    ) -> Result<()> {
        require!(merchants.len() <= MAX_MERCHANTS, CaplineError::TooManyMerchants);
        require!(max_per_tx > 0 && total_cap > 0, CaplineError::BadCap);
        require!(max_per_tx <= total_cap, CaplineError::CapOrdering);
        let now = Clock::get()?.unix_timestamp;
        require!(not_after > now, CaplineError::BadTimeWindow);

        let m = &mut ctx.accounts.mandate;
        m.principal = ctx.accounts.principal.key();
        m.agent = agent;
        m.mint = ctx.accounts.mint.key();
        m.vault = ctx.accounts.vault.key();
        m.max_per_tx = max_per_tx;
        m.total_cap = total_cap;
        m.spent = 0;
        m.not_after = not_after;
        m.ap2_hash = ap2_hash;
        m.merchants = merchants;
        m.revoked = false;
        m.ap2_verified = false;
        m.nonce = nonce;
        m.bump = ctx.bumps.mandate;

        emit!(MandateCreated {
            mandate: m.key(),
            principal: m.principal,
            agent: m.agent,
            total_cap,
            not_after,
            ap2_hash,
        });
        Ok(())
    }

    /// Layer-B enforcement. The agent (or an attacker holding the agent key)
    /// requests a payment of `amount` to `merchant`. Every check below is code,
    /// not language — no jailbreak prompt changes `amount > max_per_tx`.
    pub fn settle(ctx: Context<Settle>, amount: u64) -> Result<()> {
        let m = &ctx.accounts.mandate;

        // 1. still live?
        require!(!m.revoked, CaplineError::MandateRevoked);
        let now = Clock::get()?.unix_timestamp;
        require!(now <= m.not_after, CaplineError::MandateExpired);

        // 2. only the granted agent may spend (its key, compromised or not, is
        //    still bounded by everything below).
        require_keys_eq!(ctx.accounts.agent.key(), m.agent, CaplineError::Unauthorized);

        // 3. the caps — the whole point.
        require!(amount <= m.max_per_tx, CaplineError::PerTxCapExceeded);
        let new_spent = m.spent.checked_add(amount).ok_or(CaplineError::MathOverflow)?;
        require!(new_spent <= m.total_cap, CaplineError::TotalCapExceeded);

        // 4. the merchant must be on the signed allowlist, and the destination
        //    token account must actually belong to that merchant + right mint.
        let merchant = ctx.accounts.merchant.key();
        require!(m.merchants.contains(&merchant), CaplineError::MerchantNotAllowed);
        require_keys_eq!(
            ctx.accounts.merchant_token_account.owner,
            merchant,
            CaplineError::InvalidMerchantAccount
        );
        require_keys_eq!(
            ctx.accounts.merchant_token_account.mint,
            m.mint,
            CaplineError::InvalidMerchantAccount
        );

        // 5. move the money — CPI signed by the mandate PDA, not the agent.
        let principal = m.principal;
        let nonce = m.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[b"mandate", principal.as_ref(), nonce.as_ref(), &[m.bump]];
        let signer = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.merchant_token_account.to_account_info(),
                    authority: ctx.accounts.mandate.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        ctx.accounts.mandate.spent = new_spent;
        emit!(Settled { mandate: ctx.accounts.mandate.key(), merchant, amount, spent: new_spent });
        Ok(())
    }

    /// Prove the principal actually ed25519-SIGNED the AP2 mandate — not just
    /// that someone committed a hash. The transaction must carry an Ed25519
    /// program instruction (the native program verifies the signature); this
    /// handler introspects it and binds it: the signer must be the principal,
    /// and sha256(signed message) must equal the mandate's committed ap2_hash.
    /// Flips `ap2_verified`, turning the commitment into a proof.
    pub fn attest_ap2(ctx: Context<AttestAp2>) -> Result<()> {
        let ix_sysvar = ctx.accounts.instructions_sysvar.to_account_info();
        let current = load_current_index_checked(&ix_sysvar)?;

        // find the Ed25519 verify instruction in this transaction
        let mut found: Option<(Pubkey, [u8; 32])> = None;
        for i in 0..current {
            let ix = load_instruction_at_checked(i as usize, &ix_sysvar)?;
            if ix.program_id != ed25519_program::ID {
                continue;
            }
            let d = &ix.data;
            // Ed25519 instruction layout (single signature, standard builder):
            // [num=1, pad, offsets(14)], then pubkey, signature, message.
            require!(d.len() >= 16 && d[0] == 1, CaplineError::BadAp2Proof);
            let u16at = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]) as usize;
            let pk_off = u16at(6);
            let msg_off = u16at(10);
            let msg_size = u16at(12);
            require!(
                pk_off + 32 <= d.len() && msg_off + msg_size <= d.len(),
                CaplineError::BadAp2Proof
            );
            let pubkey = Pubkey::try_from(&d[pk_off..pk_off + 32]).map_err(|_| CaplineError::BadAp2Proof)?;
            let msg = &d[msg_off..msg_off + msg_size];
            found = Some((pubkey, hash(msg).to_bytes()));
            break;
        }

        let (signer, msg_hash) = found.ok_or(CaplineError::MissingAp2Proof)?;
        let m = &mut ctx.accounts.mandate;
        require_keys_eq!(signer, m.principal, CaplineError::Ap2SignerMismatch);
        require!(msg_hash == m.ap2_hash, CaplineError::Ap2HashMismatch);
        m.ap2_verified = true;
        emit!(Ap2Verified { mandate: m.key(), signer });
        Ok(())
    }

    /// The principal can kill a mandate at any time. Enforcement is immediate:
    /// the next `settle` reverts with MandateRevoked.
    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        ctx.accounts.mandate.revoked = true;
        emit!(Revoked { mandate: ctx.accounts.mandate.key() });
        Ok(())
    }

    /// Principal reclaims whatever the agent didn't spend.
    pub fn withdraw_unspent(ctx: Context<WithdrawUnspent>, amount: u64) -> Result<()> {
        let m = &ctx.accounts.mandate;
        let principal = m.principal;
        let nonce = m.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[b"mandate", principal.as_ref(), nonce.as_ref(), &[m.bump]];
        let signer = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.principal_token_account.to_account_info(),
                    authority: ctx.accounts.mandate.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub principal: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = principal,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [b"mandate", principal.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        init,
        payer = principal,
        seeds = [b"vault", mandate.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = mandate
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"mandate", mandate.principal.as_ref(), &mandate.nonce.to_le_bytes()],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,

    /// The agent key. May be compromised — enforcement does not trust it.
    pub agent: Signer<'info>,

    #[account(mut, address = mandate.vault)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: identity only; validated against the allowlist in-handler.
    pub merchant: UncheckedAccount<'info>,

    #[account(mut)]
    pub merchant_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AttestAp2<'info> {
    #[account(address = mandate.principal)]
    pub principal: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mandate", mandate.principal.as_ref(), &mandate.nonce.to_le_bytes()],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,
    /// CHECK: address-checked to the Instructions sysvar; read via helpers.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Revoke<'info> {
    #[account(address = mandate.principal)]
    pub principal: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mandate", mandate.principal.as_ref(), &mandate.nonce.to_le_bytes()],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,
}

#[derive(Accounts)]
pub struct WithdrawUnspent<'info> {
    #[account(address = mandate.principal)]
    pub principal: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mandate", mandate.principal.as_ref(), &mandate.nonce.to_le_bytes()],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(mut, address = mandate.vault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub principal_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub principal: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub max_per_tx: u64,
    pub total_cap: u64,
    pub spent: u64,
    pub not_after: i64,
    /// sha256 of the off-chain signed AP2 Intent Mandate — binds on-chain policy
    /// to the exact intent the principal signed.
    pub ap2_hash: [u8; 32],
    #[max_len(MAX_MERCHANTS)]
    pub merchants: Vec<Pubkey>,
    pub revoked: bool,
    /// true once the principal's ed25519 signature over the AP2 mandate has been
    /// proven on-chain (see `attest_ap2`).
    pub ap2_verified: bool,
    pub nonce: u64,
    pub bump: u8,
}

#[event]
pub struct MandateCreated {
    pub mandate: Pubkey,
    pub principal: Pubkey,
    pub agent: Pubkey,
    pub total_cap: u64,
    pub not_after: i64,
    pub ap2_hash: [u8; 32],
}

#[event]
pub struct Settled {
    pub mandate: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub spent: u64,
}

#[event]
pub struct Revoked {
    pub mandate: Pubkey,
}

#[event]
pub struct Ap2Verified {
    pub mandate: Pubkey,
    pub signer: Pubkey,
}

#[error_code]
pub enum CaplineError {
    #[msg("mandate has been revoked")]
    MandateRevoked,
    #[msg("mandate spend window has expired")]
    MandateExpired,
    #[msg("signer is not the granted agent")]
    Unauthorized,
    #[msg("amount exceeds the per-transaction cap")]
    PerTxCapExceeded,
    #[msg("amount would exceed the total mandate cap")]
    TotalCapExceeded,
    #[msg("merchant is not on the signed allowlist")]
    MerchantNotAllowed,
    #[msg("merchant token account does not match merchant/mint")]
    InvalidMerchantAccount,
    #[msg("too many merchants for the allowlist")]
    TooManyMerchants,
    #[msg("caps must be non-zero")]
    BadCap,
    #[msg("max_per_tx must be <= total_cap")]
    CapOrdering,
    #[msg("not_after must be in the future")]
    BadTimeWindow,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("no Ed25519 signature-verification instruction found in the transaction")]
    MissingAp2Proof,
    #[msg("malformed Ed25519 instruction data")]
    BadAp2Proof,
    #[msg("AP2 signature is not from the mandate principal")]
    Ap2SignerMismatch,
    #[msg("signed message does not match the committed AP2 hash")]
    Ap2HashMismatch,
}
