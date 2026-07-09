#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token, vec, Address, BytesN, Env,
};

fn setup() -> (Env, MandateContractClient<'static>, Address, Address, Address, Address, Address) {
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
    client.create_mandate(&id, &principal, &agent, &token_addr, &5, &50, &0, &merchants, &ap2);
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
    assert_eq!(client.try_settle(&id, &merchant, &5), Err(Ok(Error::Revoked)));
}

#[test]
fn total_cap_enforced() {
    let (env, client, principal, agent, merchant, _scammer, token_addr) = setup();
    let id = BytesN::from_array(&env, &[9u8; 32]);
    let ap2 = BytesN::from_array(&env, &[0u8; 32]);
    let merchants = vec![&env, merchant.clone()];

    // per-tx 40, total 50; two 40s would exceed the cumulative cap
    client.create_mandate(&id, &principal, &agent, &token_addr, &40, &50, &0, &merchants, &ap2);
    client.fund(&id, &100);

    client.settle(&id, &merchant, &40); // ok, spent 40
    assert_eq!(
        client.try_settle(&id, &merchant, &40), // 80 > 50 total cap
        Err(Ok(Error::TotalCapExceeded))
    );
    client.settle(&id, &merchant, &10); // exactly fills the cap
    assert_eq!(client.get_mandate(&id).spent, 50);
}
