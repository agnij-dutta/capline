#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, token, vec, Address, BytesN, Env};

fn setup() -> (
    Env,
    MandateContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let principal = Address::generate(&env);
    let agent = Address::generate(&env);
    let merchant = Address::generate(&env);
    let scammer = Address::generate(&env);

    // A Stellar Asset Contract token, admin = principal, mint 100 to principal.
    let sac = env.register_stellar_asset_contract_v2(principal.clone());
    let token_addr = sac.address();
    token::StellarAssetClient::new(&env, &token_addr).mint(&principal, &100);

    let contract_id = env.register(MandateContract, ());
    let client = MandateContractClient::new(&env, &contract_id);

    (env, client, principal, agent, merchant, scammer, token_addr)
}

#[test]
fn mandate_enforcement() {
    let (env, client, principal, agent, merchant, scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[1u8; 32]);
    let ap2 = BytesN::from_array(&env, &[2u8; 32]);
    let merchants = vec![&env, merchant.clone()];

    // cap 5/tx, 50 total, merchant allowlisted, no expiry
    client.create_mandate(
        &id,
        &principal,
        &agent,
        &token_addr,
        &5,
        &50,
        &0,
        &merchants,
        &ap2,
    );
    client.fund(&id, &50);

    let tok = token::Client::new(&env, &token_addr);
    assert_eq!(tok.balance(&principal), 50); // 100 minted - 50 funded

    // 1. legit payment within mandate settles
    client.settle(&id, &merchant, &5);
    assert_eq!(tok.balance(&merchant), 5);

    // 2. over per-tx cap reverts
    assert_eq!(
        client.try_settle(&id, &merchant, &10),
        Err(Ok(Error::PerTxCapExceeded))
    );

    // 3. off-allowlist payee reverts
    assert_eq!(
        client.try_settle(&id, &scammer, &5),
        Err(Ok(Error::MerchantNotAllowed))
    );

    // spend unchanged after the two reverts
    let m = client.get_mandate(&id);
    assert_eq!(m.spent, 5);
    assert_eq!(m.vault, 45);

    // 4. revoke → every future settle reverts
    client.revoke(&id);
    assert_eq!(
        client.try_settle(&id, &merchant, &5),
        Err(Ok(Error::Revoked))
    );
}

#[test]
fn total_cap_enforced() {
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[9u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    let merchants = vec![&env, merchant.clone()];

    // per-tx 40, total 50; two 40s would exceed the cumulative cap
    client.create_mandate(
        &id,
        &principal,
        &agent,
        &token_addr,
        &40,
        &50,
        &0,
        &merchants,
        &ap2,
    );
    client.fund(&id, &100);

    client.settle(&id, &merchant, &40); // ok, spent 40
    assert_eq!(
        client.try_settle(&id, &merchant, &40), // 80 > 50 total cap
        Err(Ok(Error::TotalCapExceeded))
    );
    client.settle(&id, &merchant, &10); // exactly fills the cap
    assert_eq!(client.get_mandate(&id).spent, 50);
}

#[test]
fn zero_and_negative_amounts_rejected() {
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[3u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    client.create_mandate(
        &id,
        &principal,
        &agent,
        &token_addr,
        &5,
        &50,
        &0,
        &vec![&env, merchant.clone()],
        &ap2,
    );
    client.fund(&id, &10);
    assert_eq!(
        client.try_settle(&id, &merchant, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        client.try_settle(&id, &merchant, &-5),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(client.try_fund(&id, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(
        client.try_withdraw_unspent(&id, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(client.get_mandate(&id).spent, 0);
}

#[test]
fn create_validates_caps() {
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    let ms = vec![&env, merchant.clone()];
    for (i, (per, total)) in [(0i128, 10i128), (5, 0), (11, 10), (-1, 10)]
        .into_iter()
        .enumerate()
    {
        let id = BytesN::from_array(&env, &[40 + i as u8; 32]);
        assert_eq!(
            client.try_create_mandate(
                &id,
                &principal,
                &agent,
                &token_addr,
                &per,
                &total,
                &0,
                &ms,
                &ap2
            ),
            Err(Ok(Error::InvalidMandate))
        );
    }
}

#[test]
fn expiry_enforced() {
    use soroban_sdk::testutils::Ledger as _;
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[4u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    client.create_mandate(
        &id,
        &principal,
        &agent,
        &token_addr,
        &5,
        &50,
        &1_000,
        &vec![&env, merchant.clone()],
        &ap2,
    );
    client.fund(&id, &10);
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.settle(&id, &merchant, &1); // at expiry: allowed
    env.ledger().with_mut(|l| l.timestamp = 1_001);
    assert_eq!(
        client.try_settle(&id, &merchant, &1),
        Err(Ok(Error::Expired))
    );
}

#[test]
fn settle_requires_agent_auth_and_withdraw_requires_principal_auth() {
    use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation};
    use soroban_sdk::{IntoVal, Symbol};
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[5u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    client.create_mandate(
        &id,
        &principal,
        &agent,
        &token_addr,
        &5,
        &50,
        &0,
        &vec![&env, merchant.clone()],
        &ap2,
    );
    client.fund(&id, &20);

    client.settle(&id, &merchant, &5);
    assert_eq!(
        env.auths(),
        std::vec![(
            agent.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "settle"),
                    (id.clone(), merchant.clone(), 5i128).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );

    client.withdraw_unspent(&id, &15);
    assert_eq!(
        env.auths(),
        std::vec![(
            principal.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "withdraw_unspent"),
                    (id.clone(), 15i128).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn principal_reclaims_unspent_after_revoke() {
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[6u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    client.create_mandate(
        &id,
        &principal,
        &agent,
        &token_addr,
        &5,
        &50,
        &0,
        &vec![&env, merchant.clone()],
        &ap2,
    );
    client.fund(&id, &50);
    client.settle(&id, &merchant, &5);
    client.revoke(&id);

    let tok = token::Client::new(&env, &token_addr);
    assert_eq!(tok.balance(&principal), 50);
    assert_eq!(
        client.try_withdraw_unspent(&id, &46),
        Err(Ok(Error::InsufficientVault))
    );
    client.withdraw_unspent(&id, &45);
    assert_eq!(tok.balance(&principal), 95);
    assert_eq!(client.get_mandate(&id).vault, 0);
    assert_eq!(
        client.try_settle(&id, &merchant, &1),
        Err(Ok(Error::Revoked))
    );
}

#[test]
fn duplicate_id_rejected() {
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[7u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    let ms = vec![&env, merchant.clone()];
    client.create_mandate(&id, &principal, &agent, &token_addr, &5, &50, &0, &ms, &ap2);
    assert_eq!(
        client.try_create_mandate(
            &id,
            &principal,
            &agent,
            &token_addr,
            &50,
            &500,
            &0,
            &ms,
            &ap2
        ),
        Err(Ok(Error::AlreadyExists))
    );
}
