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

/// Send `ixs` signed by `signers` with `payer` as fee payer. Ok = metadata
/// (carries compute_units_consumed for the CU benchmark); Err = revert string.
fn send(
    svm: &mut LiteSVM,
    payer: &Pubkey,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<litesvm::types::TransactionMetadata, String> {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map_err(|e| format!("{:?}", e.err))
}

/// Build a real Ed25519 program verify instruction (single sig, standard layout).
fn ed25519_ix(signer: &Keypair, message: &[u8]) -> Instruction {
    let pk = signer.pubkey().to_bytes();
    let sig = signer.sign_message(message);
    let sig_bytes: &[u8] = sig.as_ref();
    let mut data: Vec<u8> = vec![1, 0]; // num signatures, padding
    let cur = u16::MAX; // "this instruction" holds the data
    for v in [48u16, cur, 16u16, cur, 112u16, message.len() as u16, cur] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(&pk); // @16
    data.extend_from_slice(sig_bytes); // @48
    data.extend_from_slice(message); // @112
    let ed25519_id = Pubkey::new_from_array(solana_sdk_ids::ed25519_program::ID.to_bytes());
    Instruction::new_with_bytes(ed25519_id, &data, vec![])
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
    let cu_create = send(&mut svm, &principal_pk, &[create], &[&principal])
        .expect("create_mandate should succeed")
        .compute_units_consumed;

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
    let cu_settle = send(&mut svm, &agent_pk, &[settle(5 * USDC, merchant.pubkey(), merchant_ata)], &[&agent])
        .expect("legit purchase should settle")
        .compute_units_consumed;
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
    println!("── CU benchmark ──  create_mandate: {cu_create} CU   settle: {cu_settle} CU");
}

#[test]
fn ap2_attestation() {
    let (mut svm, program_id) = load();
    let principal = Keypair::new();
    let agent = Keypair::new();
    let merchant = Keypair::new();
    let attacker = Keypair::new();
    svm.airdrop(&principal.pubkey(), 10 * 1_000_000_000).unwrap();
    let principal_pk = principal.pubkey();

    let mint = CreateMint::new(&mut svm, &principal).decimals(6).authority(&principal_pk).send().unwrap();
    let nonce: u64 = 42;
    let (mandate, _) = Pubkey::find_program_address(
        &[b"mandate", principal_pk.as_ref(), &nonce.to_le_bytes()],
        &program_id,
    );
    let (vault, _) = Pubkey::find_program_address(&[b"vault", mandate.as_ref()], &program_id);

    // the AP2 intent the principal signs; the mandate commits to its sha256
    let ap2_message = b"AP2:intent principal spends<=10 merchant=X until=T nonce=42";
    let ap2_hash: [u8; 32] = solana_sha256_hasher::hash(ap2_message).to_bytes();

    let create = Instruction::new_with_bytes(
        program_id,
        &capline::instruction::CreateMandate {
            nonce,
            agent: agent.pubkey(),
            max_per_tx: 10 * USDC,
            total_cap: 50 * USDC,
            not_after: 4_000_000_000,
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
    send(&mut svm, &principal_pk, &[create], &[&principal]).expect("create ok");

    let ix_sysvar = Pubkey::new_from_array(solana_sdk_ids::sysvar::instructions::ID.to_bytes());
    let attest = Instruction::new_with_bytes(
        program_id,
        &capline::instruction::AttestAp2 {}.data(),
        capline::accounts::AttestAp2 { principal: principal_pk, mandate, instructions_sysvar: ix_sysvar }
            .to_account_metas(None),
    );

    // happy path: real ed25519 signature by the principal over the AP2 message
    let ed_ok = ed25519_ix(&principal, ap2_message);
    let meta = send(&mut svm, &principal_pk, &[ed_ok, attest.clone()], &[&principal])
        .expect("attest should succeed with a valid principal signature");
    {
        let acc = svm.get_account(&mandate).unwrap();
        let m = capline::Mandate::try_deserialize(&mut &acc.data[..]).unwrap();
        assert!(m.ap2_verified, "mandate should be marked ap2_verified");
    }

    // attack A: someone else signs the same message -> signer mismatch -> revert
    let ed_forged = ed25519_ix(&attacker, ap2_message);
    let forged = send(&mut svm, &principal_pk, &[ed_forged, attest.clone()], &[&principal]);
    assert!(forged.is_err(), "attestation by a non-principal signer must revert");

    // attack B: principal signs a DIFFERENT message -> hash mismatch -> revert
    let ed_wrong = ed25519_ix(&principal, b"AP2:intent spends<=999999 to anyone");
    let wrong = send(&mut svm, &principal_pk, &[ed_wrong, attest], &[&principal]);
    assert!(wrong.is_err(), "attestation of a different message must revert");

    println!("✓ AP2 attestation: valid principal sig accepted; forged signer + wrong message rejected");
    println!("── CU benchmark ──  attest_ap2: {} CU", meta.compute_units_consumed);
}
