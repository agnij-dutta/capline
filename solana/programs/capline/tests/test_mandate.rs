// The proof. Three scenarios on a real SVM (LiteSVM), mirroring the EVM demo:
//   1. A legitimate purchase settles.
//   2. A COMPROMISED agent key, asked to overpay 1000 USDC, is reverted ON-CHAIN.
//   3. The same attack redirected to an injected scammer merchant is reverted —
//      that merchant is not on the signed allowlist.
//   + revoke kills a live mandate instantly.
//
// Run: `cargo test` (or `anchor test`, which builds the .so first).
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, program_pack::Pack, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo, TOKEN_ID},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC: u64 = 1_000_000; // 6 decimals

fn load() -> (LiteSVM, Pubkey) {
    let program_id = capline::ID;
    let mut svm = LiteSVM::new();
    let so = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/capline.so"));
    svm.add_program(program_id, so).unwrap();
    (svm, program_id)
}

/// Send `ixs` signed by `signers` with `payer` as fee payer. Returns Ok/Err.
fn send(
    svm: &mut LiteSVM,
    payer: &Pubkey,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), String> {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}

fn token_balance(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    let acc = svm.get_account(ata).unwrap();
    spl_token::state::Account::unpack(&acc.data).unwrap().amount
}

#[test]
fn mandate_enforcement() {
    let (mut svm, program_id) = load();

    // actors
    let principal = Keypair::new();
    let agent = Keypair::new();
    let merchant = Keypair::new(); // the legitimate seller
    let scammer = Keypair::new(); // the injected payee
    for kp in [&principal, &agent] {
        svm.airdrop(&kp.pubkey(), 10 * 1_000_000_000).unwrap();
    }
    let principal_pk = principal.pubkey();
    let agent_pk = agent.pubkey();

    // mint (USDC-like), authority = principal
    let mint = CreateMint::new(&mut svm, &principal)
        .decimals(6)
        .authority(&principal_pk)
        .send()
        .unwrap();

    // PDAs
    let nonce: u64 = 1;
    let (mandate, _) = Pubkey::find_program_address(
        &[b"mandate", principal_pk.as_ref(), &nonce.to_le_bytes()],
        &program_id,
    );
    let (vault, _) = Pubkey::find_program_address(&[b"vault", mandate.as_ref()], &program_id);

    // merchant + scammer token accounts
    let merchant_ata = CreateAssociatedTokenAccount::new(&mut svm, &principal, &mint)
        .owner(&merchant.pubkey())
        .send()
        .unwrap();
    let scammer_ata = CreateAssociatedTokenAccount::new(&mut svm, &principal, &mint)
        .owner(&scammer.pubkey())
        .send()
        .unwrap();

    // --- create the mandate, bound to a signed AP2 intent hash ---
    let ap2_hash: [u8; 32] = [7u8; 32];
    let not_after: i64 = 4_000_000_000; // far future
    let create = Instruction::new_with_bytes(
        program_id,
        &capline::instruction::CreateMandate {
            nonce,
            agent: agent_pk,
            max_per_tx: 10 * USDC,
            total_cap: 50 * USDC,
            not_after,
            ap2_hash,
            merchants: vec![merchant.pubkey()],
        }
        .data(),
        capline::accounts::CreateMandate {
            principal: principal_pk,
            mint,
            mandate,
            vault,
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &principal_pk, &[create], &[&principal]).expect("create_mandate should succeed");

    // fund the vault with 50 USDC
    MintTo::new(&mut svm, &principal, &mint, &vault, 50 * USDC)
        .owner(&principal)
        .send()
        .unwrap();
    assert_eq!(token_balance(&svm, &vault), 50 * USDC);

    // helper to build a settle ix
    let settle = |amount: u64, merchant_pk: Pubkey, merchant_ata: Pubkey| {
        Instruction::new_with_bytes(
            program_id,
            &capline::instruction::Settle { amount }.data(),
            capline::accounts::Settle {
                mandate,
                agent: agent_pk,
                vault,
                merchant: merchant_pk,
                merchant_token_account: merchant_ata,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        )
    };

    // 1. legitimate purchase settles
    send(&mut svm, &agent_pk, &[settle(5 * USDC, merchant.pubkey(), merchant_ata)], &[&agent])
        .expect("legit purchase should settle");
    assert_eq!(token_balance(&svm, &merchant_ata), 5 * USDC);
    {
        let acc = svm.get_account(&mandate).unwrap();
        let m = capline::Mandate::try_deserialize(&mut &acc.data[..]).unwrap();
        assert_eq!(m.spent, 5 * USDC);
        assert_eq!(m.ap2_hash, ap2_hash); // bound to the signed intent
    }

    // 2. compromised key, prompt-injected to overpay 1000 USDC -> reverted on-chain
    let over = send(
        &mut svm,
        &agent_pk,
        &[settle(1000 * USDC, merchant.pubkey(), merchant_ata)],
        &[&agent],
    );
    assert!(over.is_err(), "over-cap drain must be rejected by the chain");
    assert_eq!(token_balance(&svm, &merchant_ata), 5 * USDC, "no funds moved");

    // 3. injected scammer merchant -> reverted (not on the signed allowlist)
    let evil = send(
        &mut svm,
        &agent_pk,
        &[settle(5 * USDC, scammer.pubkey(), scammer_ata)],
        &[&agent],
    );
    assert!(evil.is_err(), "off-allowlist merchant must be rejected");
    assert_eq!(token_balance(&svm, &scammer_ata), 0, "scammer got nothing");

    // 4. revoke kills the mandate; next settle reverts
    let revoke = Instruction::new_with_bytes(
        program_id,
        &capline::instruction::Revoke {}.data(),
        capline::accounts::Revoke { principal: principal_pk, mandate }.to_account_metas(None),
    );
    send(&mut svm, &principal_pk, &[revoke], &[&principal]).expect("revoke should succeed");
    let after = send(
        &mut svm,
        &agent_pk,
        &[settle(1 * USDC, merchant.pubkey(), merchant_ata)],
        &[&agent],
    );
    assert!(after.is_err(), "revoked mandate must reject all settlement");

    println!("✓ all four scenarios passed: legit settles, over-cap reverts, scammer reverts, revoke kills");
}
