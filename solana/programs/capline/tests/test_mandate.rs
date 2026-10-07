// The proof, on a real SVM (LiteSVM) running the compiled program.
//
// Core scenarios (mirroring the EVM demo):
//   1. A legitimate purchase settles.
//   2. A COMPROMISED agent key, asked to overpay 1000 USDC, is reverted ON-CHAIN.
//   3. The same attack redirected to an injected scammer merchant is reverted:
//      that merchant is not on the signed allowlist.
//   4. revoke kills a live mandate instantly.
//
// Plus the review regression suite: zero-amount settle, account substitution
// (wrong vault, wrong agent, wrong merchant token account), expiry, exact cap
// boundaries, principal-only revoke/withdraw, nonce re-use, Token-2022 mints,
// and every Ed25519 introspection spoofing variant for attest_ap2.
//
// Run: `anchor build --ignore-keys && cargo test --release -- --nocapture`.
// The tests load target/deploy/capline.so, so rebuild after editing lib.rs.
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, program_pack::Pack, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{
        spl_token, CreateAccount, CreateAssociatedTokenAccount, CreateMint, MintTo, TOKEN_ID,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC: u64 = 1_000_000; // 6 decimals
const FAR_FUTURE: i64 = 4_000_000_000;

// Anchor error codes: custom program errors start at 6000, in enum order.
// These numbers are part of the public interface; integrations match on them.
const E_MANDATE_REVOKED: u32 = 6000;
const E_MANDATE_EXPIRED: u32 = 6001;
const E_UNAUTHORIZED: u32 = 6002;
const E_PER_TX: u32 = 6003;
const E_TOTAL_CAP: u32 = 6004;
const E_MERCHANT_NOT_ALLOWED: u32 = 6005;
const E_INVALID_MERCHANT_ACCOUNT: u32 = 6006;
const E_MISSING_AP2_PROOF: u32 = 6012;
const E_BAD_AP2_PROOF: u32 = 6013;
const E_AP2_SIGNER_MISMATCH: u32 = 6014;
const E_AP2_HASH_MISMATCH: u32 = 6015;
const E_ZERO_AMOUNT: u32 = 6016;
const E_AP2_NOT_SELF_CONTAINED: u32 = 6017;
// Anchor framework constraint errors.
const E_CONSTRAINT_ADDRESS: u32 = 2012;
const E_ACCOUNT_OWNED_BY_WRONG_PROGRAM: u32 = 3007;

fn load() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let so = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/capline.so"
    ));
    svm.add_program(capline::ID, so).unwrap();
    svm
}

/// Deterministic keypair, so PDA bump searches (and therefore the CU numbers
/// printed by the benchmark) are reproducible run to run.
fn kp(seed: u8) -> Keypair {
    Keypair::new_from_array([seed; 32])
}

/// Send `ixs` signed by `signers` with `payer` as fee payer. Ok = metadata
/// (carries compute_units_consumed for the CU benchmark); Err = error string.
fn send(
    svm: &mut LiteSVM,
    payer: &Pubkey,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<litesvm::types::TransactionMetadata, String> {
    // a fresh blockhash per tx, so two identical instructions are never
    // rejected as an already-processed duplicate
    svm.expire_blockhash();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map_err(|e| format!("{:?}", e.err))
}

/// Assert a tx failed with a specific custom error code.
fn assert_code(res: Result<litesvm::types::TransactionMetadata, String>, code: u32, what: &str) {
    match res {
        Ok(_) => panic!("{what}: expected error {code}, but the transaction succeeded"),
        Err(e) => assert!(
            e.contains(&format!("Custom({code})")),
            "{what}: expected Custom({code}), got {e}"
        ),
    }
}

fn token_balance(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    let acc = svm.get_account(ata).unwrap();
    spl_token::state::Account::unpack(&acc.data).unwrap().amount
}

fn read_mandate(svm: &LiteSVM, mandate: &Pubkey) -> capline::Mandate {
    let acc = svm.get_account(mandate).unwrap();
    capline::Mandate::try_deserialize(&mut &acc.data[..]).unwrap()
}

fn pdas(principal: &Pubkey, nonce: u64) -> (Pubkey, Pubkey) {
    let (mandate, _) = Pubkey::find_program_address(
        &[b"mandate", principal.as_ref(), &nonce.to_le_bytes()],
        &capline::ID,
    );
    let (vault, _) = Pubkey::find_program_address(&[b"vault", mandate.as_ref()], &capline::ID);
    (mandate, vault)
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

struct Fx {
    svm: LiteSVM,
    principal: Keypair,
    agent: Keypair,
    merchant: Keypair,
    scammer: Keypair,
    mint: Pubkey,
    mandate: Pubkey,
    vault: Pubkey,
    merchant_ata: Pubkey,
    scammer_ata: Pubkey,
    ap2_hash: [u8; 32],
    cu_create: u64,
}

struct Params {
    nonce: u64,
    max_per_tx: u64,
    total_cap: u64,
    not_after: i64,
    fund: u64,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            nonce: 1,
            max_per_tx: 10 * USDC,
            total_cap: 50 * USDC,
            not_after: FAR_FUTURE,
            fund: 50 * USDC,
        }
    }
}

const AP2_MESSAGE: &[u8] = b"AP2:intent principal spends<=10 merchant=X until=T nonce=1";

#[allow(clippy::too_many_arguments)]
fn create_ix(
    principal: &Pubkey,
    mint: &Pubkey,
    nonce: u64,
    agent: &Pubkey,
    max_per_tx: u64,
    total_cap: u64,
    not_after: i64,
    ap2_hash: [u8; 32],
    merchants: Vec<Pubkey>,
) -> Instruction {
    let (mandate, vault) = pdas(principal, nonce);
    Instruction::new_with_bytes(
        capline::ID,
        &capline::instruction::CreateMandate {
            nonce,
            agent: *agent,
            max_per_tx,
            total_cap,
            not_after,
            ap2_hash,
            merchants,
        }
        .data(),
        capline::accounts::CreateMandate {
            principal: *principal,
            mint: *mint,
            mandate,
            vault,
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn setup(p: Params) -> Fx {
    let mut svm = load();
    let principal = kp(1);
    let agent = kp(2);
    let merchant = kp(3);
    let scammer = kp(4);
    for k in [&principal, &agent] {
        svm.airdrop(&k.pubkey(), 10 * 1_000_000_000).unwrap();
    }
    let principal_pk = principal.pubkey();

    let mint = CreateMint::new(&mut svm, &principal)
        .decimals(6)
        .authority(&principal_pk)
        .send()
        .unwrap();
    let merchant_ata = CreateAssociatedTokenAccount::new(&mut svm, &principal, &mint)
        .owner(&merchant.pubkey())
        .send()
        .unwrap();
    let scammer_ata = CreateAssociatedTokenAccount::new(&mut svm, &principal, &mint)
        .owner(&scammer.pubkey())
        .send()
        .unwrap();

    let ap2_hash = solana_sha256_hasher::hash(AP2_MESSAGE).to_bytes();
    let (mandate, vault) = pdas(&principal_pk, p.nonce);
    let ix = create_ix(
        &principal_pk,
        &mint,
        p.nonce,
        &agent.pubkey(),
        p.max_per_tx,
        p.total_cap,
        p.not_after,
        ap2_hash,
        vec![merchant.pubkey()],
    );
    let cu_create = send(&mut svm, &principal_pk, &[ix], &[&principal])
        .expect("create_mandate should succeed")
        .compute_units_consumed;
    if p.fund > 0 {
        MintTo::new(&mut svm, &principal, &mint, &vault, p.fund)
            .owner(&principal)
            .send()
            .unwrap();
    }
    Fx {
        svm,
        principal,
        agent,
        merchant,
        scammer,
        mint,
        mandate,
        vault,
        merchant_ata,
        scammer_ata,
        ap2_hash,
        cu_create,
    }
}

impl Fx {
    fn settle_ix_full(
        &self,
        amount: u64,
        mandate: Pubkey,
        agent: Pubkey,
        vault: Pubkey,
        merchant: Pubkey,
        merchant_ata: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            capline::ID,
            &capline::instruction::Settle { amount }.data(),
            capline::accounts::Settle {
                mandate,
                agent,
                vault,
                merchant,
                merchant_token_account: merchant_ata,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        )
    }

    fn settle_ix(&self, amount: u64, merchant: Pubkey, merchant_ata: Pubkey) -> Instruction {
        self.settle_ix_full(
            amount,
            self.mandate,
            self.agent.pubkey(),
            self.vault,
            merchant,
            merchant_ata,
        )
    }

    fn settle(&mut self, amount: u64) -> Result<litesvm::types::TransactionMetadata, String> {
        let ix = self.settle_ix(amount, self.merchant.pubkey(), self.merchant_ata);
        let agent = self.agent.insecure_clone();
        send(&mut self.svm, &agent.pubkey(), &[ix], &[&agent])
    }

    fn revoke_ix(&self, signer: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            capline::ID,
            &capline::instruction::Revoke {}.data(),
            capline::accounts::Revoke {
                principal: signer,
                mandate: self.mandate,
            }
            .to_account_metas(None),
        )
    }

    fn withdraw_ix(&self, signer: Pubkey, to: Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            capline::ID,
            &capline::instruction::WithdrawUnspent { amount }.data(),
            capline::accounts::WithdrawUnspent {
                principal: signer,
                mandate: self.mandate,
                vault: self.vault,
                principal_token_account: to,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        )
    }

    fn attest_ix(&self) -> Instruction {
        let ix_sysvar = Pubkey::new_from_array(solana_sdk_ids::sysvar::instructions::ID.to_bytes());
        Instruction::new_with_bytes(
            capline::ID,
            &capline::instruction::AttestAp2 {}.data(),
            capline::accounts::AttestAp2 {
                principal: self.principal.pubkey(),
                mandate: self.mandate,
                instructions_sysvar: ix_sysvar,
            }
            .to_account_metas(None),
        )
    }

    fn attest_with(
        &mut self,
        pre: Vec<Instruction>,
    ) -> Result<litesvm::types::TransactionMetadata, String> {
        let mut ixs = pre;
        ixs.push(self.attest_ix());
        let principal = self.principal.insecure_clone();
        send(&mut self.svm, &principal.pubkey(), &ixs, &[&principal])
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }
}

// ---------------------------------------------------------------------------
// Ed25519 instruction builders (genuine + spoofed)
// ---------------------------------------------------------------------------

const SELF_IX: u16 = u16::MAX;

/// Raw Ed25519 program instruction from explicit header fields + body.
fn ed25519_raw(header: [u16; 7], num: u8, pad: u8, body: &[u8]) -> Instruction {
    let mut data: Vec<u8> = vec![num, pad];
    for v in header {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(body);
    let ed25519_id = Pubkey::new_from_array(solana_sdk_ids::ed25519_program::ID.to_bytes());
    Instruction::new_with_bytes(ed25519_id, &data, vec![])
}

/// Standard single-signature layout: pubkey @16, signature @48, message @112.
/// `idx` sets the three instruction-index fields (sig, pubkey, message).
fn ed25519_layout(pk: &[u8; 32], sig: &[u8], message: &[u8], idx: [u16; 3]) -> Instruction {
    let header = [
        48u16,
        idx[0],
        16u16,
        idx[1],
        112u16,
        message.len() as u16,
        idx[2],
    ];
    let mut body = Vec::new();
    body.extend_from_slice(pk);
    body.extend_from_slice(sig);
    body.extend_from_slice(message);
    ed25519_raw(header, 1, 0, &body)
}

/// A genuine, self-contained Ed25519 verify instruction.
fn ed25519_ix(signer: &Keypair, message: &[u8]) -> Instruction {
    let sig = signer.sign_message(message);
    ed25519_layout(
        &signer.pubkey().to_bytes(),
        sig.as_ref(),
        message,
        [SELF_IX; 3],
    )
}

// ===========================================================================
// core scenarios + CU benchmark
// ===========================================================================

#[test]
fn mandate_enforcement() {
    let mut fx = setup(Params::default());
    assert_eq!(token_balance(&fx.svm, &fx.vault), 50 * USDC);

    // 1. legitimate purchase settles
    let cu_settle = fx
        .settle(5 * USDC)
        .expect("legit purchase should settle")
        .compute_units_consumed;
    assert_eq!(token_balance(&fx.svm, &fx.merchant_ata), 5 * USDC);
    let m = read_mandate(&fx.svm, &fx.mandate);
    assert_eq!(m.spent, 5 * USDC);
    assert_eq!(m.ap2_hash, fx.ap2_hash); // bound to the signed intent

    // 2. compromised key, prompt-injected to overpay 1000 USDC -> reverted on-chain
    assert_code(fx.settle(1000 * USDC), E_PER_TX, "over per-tx cap");
    assert_eq!(
        token_balance(&fx.svm, &fx.merchant_ata),
        5 * USDC,
        "no funds moved"
    );

    // 3. injected scammer merchant -> reverted (not on the signed allowlist)
    let ix = fx.settle_ix(5 * USDC, fx.scammer.pubkey(), fx.scammer_ata);
    let agent = fx.agent.insecure_clone();
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_MERCHANT_NOT_ALLOWED,
        "scammer",
    );
    assert_eq!(
        token_balance(&fx.svm, &fx.scammer_ata),
        0,
        "scammer got nothing"
    );

    // 4. revoke kills the mandate; next settle reverts
    let principal = fx.principal.insecure_clone();
    let ix = fx.revoke_ix(principal.pubkey());
    send(&mut fx.svm, &principal.pubkey(), &[ix], &[&principal]).expect("revoke should succeed");
    assert_code(fx.settle(USDC), E_MANDATE_REVOKED, "settle after revoke");

    println!(
        "✓ core scenarios passed: legit settles, over-cap reverts, scammer reverts, revoke kills"
    );
    println!(
        "── CU benchmark (deterministic keys) ──  create_mandate: {} CU   settle: {cu_settle} CU",
        fx.cu_create
    );
}

// ===========================================================================
// settle: amount, caps, expiry
// ===========================================================================

#[test]
fn settle_rejects_zero_amount() {
    let mut fx = setup(Params::default());
    assert_code(fx.settle(0), E_ZERO_AMOUNT, "zero-amount settle");
    assert_eq!(read_mandate(&fx.svm, &fx.mandate).spent, 0);
}

#[test]
fn settle_cap_boundaries_are_inclusive() {
    let mut fx = setup(Params {
        max_per_tx: 10 * USDC,
        total_cap: 25 * USDC,
        ..Params::default()
    });
    // exactly max_per_tx is allowed
    fx.settle(10 * USDC).expect("amount == max_per_tx settles");
    // one base unit over max_per_tx is not
    assert_code(fx.settle(10 * USDC + 1), E_PER_TX, "max_per_tx + 1");
    fx.settle(10 * USDC).expect("spent 20");
    // 20 + 6 > 25
    assert_code(fx.settle(6 * USDC), E_TOTAL_CAP, "total cap");
    // exactly fills total cap
    fx.settle(5 * USDC).expect("spent == total_cap settles");
    assert_code(fx.settle(1), E_TOTAL_CAP, "1 unit past total cap");
    assert_eq!(read_mandate(&fx.svm, &fx.mandate).spent, 25 * USDC);
    assert_eq!(token_balance(&fx.svm, &fx.merchant_ata), 25 * USDC);
}

#[test]
fn settle_rejects_after_expiry() {
    let not_after = 2_000_000_000;
    let mut fx = setup(Params {
        not_after,
        ..Params::default()
    });
    fx.set_time(not_after);
    fx.settle(USDC)
        .expect("settle at exactly not_after is allowed");
    fx.set_time(not_after + 1);
    assert_code(fx.settle(USDC), E_MANDATE_EXPIRED, "settle after not_after");
}

#[test]
fn create_rejects_past_expiry_and_bad_caps() {
    let mut svm = load();
    let principal = kp(1);
    svm.airdrop(&principal.pubkey(), 10_000_000_000).unwrap();
    let p = principal.pubkey();
    let mint = CreateMint::new(&mut svm, &principal)
        .decimals(6)
        .authority(&p)
        .send()
        .unwrap();
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = 1_000;
    svm.set_sysvar(&clock);
    let a = kp(2).pubkey();
    let m = vec![kp(3).pubkey()];
    let cases: [(u64, u64, i64, u32, &str); 5] = [
        (0, 10, 2_000, 6008, "zero per-tx cap"),
        (5, 0, 2_000, 6008, "zero total cap"),
        (11, 10, 2_000, 6009, "per-tx above total"),
        (5, 10, 1_000, 6010, "not_after == now"),
        (5, 10, 999, 6010, "not_after in the past"),
    ];
    for (i, (per, total, na, code, what)) in cases.into_iter().enumerate() {
        let ix = create_ix(
            &p,
            &mint,
            100 + i as u64,
            &a,
            per,
            total,
            na,
            [0u8; 32],
            m.clone(),
        );
        assert_code(send(&mut svm, &p, &[ix], &[&principal]), code, what);
    }
    let too_many: Vec<Pubkey> = (0..9).map(|i| kp(50 + i).pubkey()).collect();
    let ix = create_ix(&p, &mint, 200, &a, 5, 10, 2_000, [0u8; 32], too_many);
    assert_code(
        send(&mut svm, &p, &[ix], &[&principal]),
        6007,
        "9 merchants > MAX_MERCHANTS",
    );
    let eight: Vec<Pubkey> = (0..8).map(|i| kp(50 + i).pubkey()).collect();
    let ix = create_ix(&p, &mint, 201, &a, 5, 10, 2_000, [0u8; 32], eight);
    send(&mut svm, &p, &[ix], &[&principal]).expect("exactly MAX_MERCHANTS fits the account");
}

// ===========================================================================
// settle: account substitution
// ===========================================================================

#[test]
fn settle_rejects_wrong_agent() {
    let mut fx = setup(Params::default());
    let impostor = kp(9);
    fx.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    let ix = fx.settle_ix_full(
        USDC,
        fx.mandate,
        impostor.pubkey(),
        fx.vault,
        fx.merchant.pubkey(),
        fx.merchant_ata,
    );
    assert_code(
        send(&mut fx.svm, &impostor.pubkey(), &[ix], &[&impostor]),
        E_UNAUTHORIZED,
        "impostor agent",
    );
    // the principal is not the agent either
    let principal = fx.principal.insecure_clone();
    let ix = fx.settle_ix_full(
        USDC,
        fx.mandate,
        principal.pubkey(),
        fx.vault,
        fx.merchant.pubkey(),
        fx.merchant_ata,
    );
    assert_code(
        send(&mut fx.svm, &principal.pubkey(), &[ix], &[&principal]),
        E_UNAUTHORIZED,
        "principal as agent",
    );
}

#[test]
fn settle_rejects_a_vault_that_is_not_the_mandates() {
    let mut fx = setup(Params::default());
    // a second mandate from the same principal (nonce 2), with its own funded vault
    let p = fx.principal.pubkey();
    let ix = create_ix(
        &p,
        &fx.mint,
        2,
        &fx.agent.pubkey(),
        10 * USDC,
        50 * USDC,
        FAR_FUTURE,
        [0u8; 32],
        vec![fx.merchant.pubkey()],
    );
    let principal = fx.principal.insecure_clone();
    send(&mut fx.svm, &p, &[ix], &[&principal]).unwrap();
    let (_, vault2) = pdas(&p, 2);
    MintTo::new(&mut fx.svm, &principal, &fx.mint, &vault2, 50 * USDC)
        .owner(&principal)
        .send()
        .unwrap();

    // settle against mandate #1's limits while draining mandate #2's vault
    let ix = fx.settle_ix_full(
        USDC,
        fx.mandate,
        fx.agent.pubkey(),
        vault2,
        fx.merchant.pubkey(),
        fx.merchant_ata,
    );
    let agent = fx.agent.insecure_clone();
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_CONSTRAINT_ADDRESS,
        "foreign vault",
    );
    assert_eq!(token_balance(&fx.svm, &vault2), 50 * USDC);

    // a token account the attacker owns, posing as the vault
    let fake_vault = CreateAccount::new(&mut fx.svm, &principal, &fx.mint)
        .owner(&agent.pubkey())
        .send()
        .unwrap();
    let ix = fx.settle_ix_full(
        USDC,
        fx.mandate,
        agent.pubkey(),
        fake_vault,
        fx.merchant.pubkey(),
        fx.merchant_ata,
    );
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_CONSTRAINT_ADDRESS,
        "fake vault",
    );
}

#[test]
fn settle_rejects_merchant_token_account_not_owned_by_merchant_or_wrong_mint() {
    let mut fx = setup(Params::default());
    let agent = fx.agent.insecure_clone();
    let principal = fx.principal.insecure_clone();

    // allowlisted merchant, but the destination token account belongs to the scammer
    let ix = fx.settle_ix(USDC, fx.merchant.pubkey(), fx.scammer_ata);
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_INVALID_MERCHANT_ACCOUNT,
        "merchant != token account owner",
    );

    // merchant-owned token account of a different mint
    let other_mint = CreateMint::new(&mut fx.svm, &principal)
        .decimals(6)
        .authority(&principal.pubkey())
        .send()
        .unwrap();
    let wrong_mint_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &principal, &other_mint)
        .owner(&fx.merchant.pubkey())
        .send()
        .unwrap();
    let ix = fx.settle_ix(USDC, fx.merchant.pubkey(), wrong_mint_ata);
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_INVALID_MERCHANT_ACCOUNT,
        "wrong mint destination",
    );
    assert_eq!(token_balance(&fx.svm, &fx.scammer_ata), 0);
    assert_eq!(read_mandate(&fx.svm, &fx.mandate).spent, 0);
}

// ===========================================================================
// revoke / withdraw / re-init / token program
// ===========================================================================

#[test]
fn revoke_and_withdraw_are_principal_only() {
    let mut fx = setup(Params::default());
    let agent = fx.agent.insecure_clone();
    let principal = fx.principal.insecure_clone();

    // the agent cannot revoke (address constraint on `principal`)
    let ix = fx.revoke_ix(agent.pubkey());
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_CONSTRAINT_ADDRESS,
        "agent revoke",
    );

    // the agent cannot withdraw the vault to itself
    let agent_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &principal, &fx.mint)
        .owner(&agent.pubkey())
        .send()
        .unwrap();
    let ix = fx.withdraw_ix(agent.pubkey(), agent_ata, 50 * USDC);
    assert_code(
        send(&mut fx.svm, &agent.pubkey(), &[ix], &[&agent]),
        E_CONSTRAINT_ADDRESS,
        "agent withdraw",
    );
    assert_eq!(token_balance(&fx.svm, &fx.vault), 50 * USDC);

    // the principal revokes, then reclaims the unspent balance
    fx.settle(5 * USDC).unwrap();
    let ix = fx.revoke_ix(principal.pubkey());
    send(&mut fx.svm, &principal.pubkey(), &[ix], &[&principal]).unwrap();
    let principal_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &principal, &fx.mint)
        .owner(&principal.pubkey())
        .send()
        .unwrap();
    let ix = fx.withdraw_ix(principal.pubkey(), principal_ata, 0);
    assert_code(
        send(&mut fx.svm, &principal.pubkey(), &[ix], &[&principal]),
        E_ZERO_AMOUNT,
        "zero withdraw",
    );
    let ix = fx.withdraw_ix(principal.pubkey(), principal_ata, 45 * USDC);
    send(&mut fx.svm, &principal.pubkey(), &[ix], &[&principal]).expect("principal withdraw");
    assert_eq!(token_balance(&fx.svm, &principal_ata), 45 * USDC);
    assert_eq!(token_balance(&fx.svm, &fx.vault), 0);
}

#[test]
fn nonce_reuse_cannot_reinitialize_a_mandate() {
    let mut fx = setup(Params::default());
    fx.settle(5 * USDC).unwrap();
    let p = fx.principal.pubkey();
    let principal = fx.principal.insecure_clone();
    // same principal + nonce, looser caps and a different agent: must fail
    let ix = create_ix(
        &p,
        &fx.mint,
        1,
        &kp(9).pubkey(),
        1_000 * USDC,
        1_000 * USDC,
        FAR_FUTURE,
        [0u8; 32],
        vec![],
    );
    assert!(
        send(&mut fx.svm, &p, &[ix], &[&principal]).is_err(),
        "re-init must fail"
    );
    let m = read_mandate(&fx.svm, &fx.mandate);
    assert_eq!(m.agent, fx.agent.pubkey());
    assert_eq!(m.spent, 5 * USDC, "spent is never reset");
    assert_eq!(m.max_per_tx, 10 * USDC);
}

#[test]
fn token_2022_mints_are_rejected_at_create() {
    let mut svm = load();
    let principal = kp(1);
    svm.airdrop(&principal.pubkey(), 10_000_000_000).unwrap();
    let p = principal.pubkey();
    let token_2022: Pubkey = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        .parse()
        .unwrap();
    // A valid, initialized mint whose owner is the Token-2022 program (base
    // Mint layout, 82 bytes, no extensions).
    let mint = kp(60).pubkey();
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: Some(p).into(),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    svm.set_account(
        mint,
        solana_account::Account {
            lamports: 1_000_000_000,
            data,
            owner: token_2022,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let ix = create_ix(
        &p,
        &mint,
        1,
        &kp(2).pubkey(),
        5,
        10,
        FAR_FUTURE,
        [0u8; 32],
        vec![kp(3).pubkey()],
    );
    assert_code(
        send(&mut svm, &p, &[ix], &[&principal]),
        E_ACCOUNT_OWNED_BY_WRONG_PROGRAM,
        "Token-2022 mint",
    );
}

// ===========================================================================
// attest_ap2: genuine + every spoofing variant
// ===========================================================================

#[test]
fn ap2_attestation() {
    let mut fx = setup(Params::default());
    let principal = fx.principal.insecure_clone();
    let attacker = kp(7);

    // no Ed25519 instruction at all
    assert_code(fx.attest_with(vec![]), E_MISSING_AP2_PROOF, "no proof");

    // someone else signs the same message -> signer mismatch
    assert_code(
        fx.attest_with(vec![ed25519_ix(&attacker, AP2_MESSAGE)]),
        E_AP2_SIGNER_MISMATCH,
        "non-principal signer",
    );

    // principal signs a DIFFERENT message -> hash mismatch
    assert_code(
        fx.attest_with(vec![ed25519_ix(
            &principal,
            b"AP2:intent spends<=999999 to anyone",
        )]),
        E_AP2_HASH_MISMATCH,
        "different message",
    );
    assert!(!read_mandate(&fx.svm, &fx.mandate).ap2_verified);

    // genuine: real ed25519 signature by the principal over the AP2 message
    let meta = fx
        .attest_with(vec![ed25519_ix(&principal, AP2_MESSAGE)])
        .expect("attest should succeed with a valid principal signature");
    assert!(
        read_mandate(&fx.svm, &fx.mandate).ap2_verified,
        "mandate should be ap2_verified"
    );

    println!(
        "✓ AP2 attestation: valid principal sig accepted; forged signer + wrong message rejected"
    );
    println!(
        "── CU benchmark (deterministic keys) ──  attest_ap2: {} CU",
        meta.compute_units_consumed
    );
}

/// The classic introspection spoof. Instruction 0 carries the principal's
/// pubkey and the AP2 message in its own data but points all three index
/// fields at instruction 1. Instruction 1 is a genuine, self-contained
/// signature by the ATTACKER over an attacker message of the same length, at
/// the same offsets. The native program therefore verifies the attacker's
/// signature (valid) for instruction 0, while a naive parser reads the
/// principal + AP2 message out of instruction 0's own bytes.
#[test]
fn ap2_rejects_cross_instruction_spoof() {
    let mut fx = setup(Params::default());
    let attacker = kp(7);
    let principal_pk = fx.principal.pubkey().to_bytes();

    let attacker_msg: Vec<u8> = vec![b'x'; AP2_MESSAGE.len()];
    let genuine_attacker_ix = ed25519_ix(&attacker, &attacker_msg);
    let spoof = ed25519_layout(&principal_pk, &[0u8; 64], AP2_MESSAGE, [1, 1, 1]);

    assert_code(
        fx.attest_with(vec![spoof, genuine_attacker_ix]),
        E_AP2_NOT_SELF_CONTAINED,
        "cross-instruction spoof",
    );
    assert!(
        !read_mandate(&fx.svm, &fx.mandate).ap2_verified,
        "spoof must not flip ap2_verified"
    );
}

/// Each index field on its own is enough to redirect verification, so each is
/// checked independently. The referenced instruction is a genuine principal
/// signature, so the native verifier would accept every variant; the program
/// must still refuse.
#[test]
fn ap2_rejects_each_non_self_index_field() {
    let principal_sig_ix_body = |fx: &Fx| {
        let sig = fx.principal.sign_message(AP2_MESSAGE);
        (fx.principal.pubkey().to_bytes(), sig)
    };
    for (which, idx) in [
        ("signature", [1, SELF_IX, SELF_IX]),
        ("pubkey", [SELF_IX, 1, SELF_IX]),
        ("message", [SELF_IX, SELF_IX, 1]),
    ] {
        let mut fx = setup(Params::default());
        let (pk, sig) = principal_sig_ix_body(&fx);
        let pointing = ed25519_layout(&pk, sig.as_ref(), AP2_MESSAGE, idx);
        let genuine = ed25519_ix(&fx.principal, AP2_MESSAGE);
        assert_code(
            fx.attest_with(vec![pointing, genuine]),
            E_AP2_NOT_SELF_CONTAINED,
            &format!("{which} index != u16::MAX"),
        );
        assert!(!read_mandate(&fx.svm, &fx.mandate).ap2_verified);
    }
}

#[test]
fn ap2_rejects_malformed_headers() {
    let mut fx = setup(Params::default());
    let principal = fx.principal.insecure_clone();
    let sig = principal.sign_message(AP2_MESSAGE);
    let mut body = Vec::new();
    body.extend_from_slice(&principal.pubkey().to_bytes());
    body.extend_from_slice(sig.as_ref());
    body.extend_from_slice(AP2_MESSAGE);
    let len = AP2_MESSAGE.len() as u16;
    let hdr = |sig_off: u16, msg_len: u16| [sig_off, SELF_IX, 16, SELF_IX, 112, msg_len, SELF_IX];

    // Self-referencing but malformed: the native Ed25519 program (instruction
    // 0) rejects these before Capline runs (PrecompileError 2 = invalid
    // signature, 3 = invalid data offsets). Capline's own bounds checks are
    // defense in depth for the same cases.
    let precompile_rejects: Vec<(&str, Instruction)> = vec![
        (
            "two signatures declared",
            ed25519_raw(hdr(48, len), 2, 0, &body),
        ),
        (
            "signature offset past end",
            ed25519_raw(hdr(200, len), 1, 0, &body),
        ),
        (
            "signature overlaps header",
            ed25519_raw(hdr(4, len), 1, 0, &body),
        ),
        (
            "message runs past end",
            ed25519_raw(hdr(48, len + 1), 1, 0, &body),
        ),
    ];
    for (what, ix) in precompile_rejects {
        let err = fx.attest_with(vec![ix]).expect_err(what);
        assert!(
            err.starts_with("InstructionError(0, Custom("),
            "{what}: expected precompile rejection, got {err}"
        );
        assert!(
            !read_mandate(&fx.svm, &fx.mandate).ap2_verified,
            "{what}: must not verify"
        );
    }

    // Non-zero padding is ignored by the native program, so this one reaches
    // Capline (instruction 1), which rejects it as BadAp2Proof.
    let err = fx
        .attest_with(vec![ed25519_raw(hdr(48, len), 1, 7, &body)])
        .expect_err("padding");
    assert_eq!(
        err,
        format!("InstructionError(1, Custom({E_BAD_AP2_PROOF}))")
    );
    assert!(!read_mandate(&fx.svm, &fx.mandate).ap2_verified);

    // sanity: the same bytes with a correct header still pass
    fx.attest_with(vec![ed25519_raw(hdr(48, len), 1, 0, &body)])
        .expect("well-formed header passes");
    assert!(read_mandate(&fx.svm, &fx.mandate).ap2_verified);
}
