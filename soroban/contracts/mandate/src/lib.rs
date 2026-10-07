#![no_std]
// create_mandate's argument list is the contract ABI (and soroban_sdk generates
// a client with the same signature), so it cannot be bundled into a struct
// without breaking deployed callers.
#![allow(clippy::too_many_arguments)]
//! Capline mandate — the Stellar (Soroban) enforcement primitive.
//!
//! Mirrors the Solana program and the EVM MandateRegistry: a principal grants a
//! bounded, revocable spend mandate to an agent. Enforcement lives here, on-chain,
//! at settlement — NOT in a prompt. A fully jailbroken agent can propose any
//! payment; `settle` reverts if it exceeds the mandate (per-tx cap, total cap,
//! expiry, merchant allowlist) even if the agent's key is compromised.
//!
//! Funds are held by the contract (a per-mandate vault the principal funds), so
//! `settle` moves them out only within the mandate. The signed AP2 intent is
//! committed as `ap2_hash` — the same 32-byte sha256 commitment as the other chains.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Mandate {
    pub principal: Address,
    pub agent: Address,
    pub token: Address,
    pub max_per_tx: i128,
    pub total_cap: i128,
    pub spent: i128,
    pub expiry: u64,             // ledger timestamp; 0 = no expiry
    pub merchants: Vec<Address>, // empty = any payee
    pub ap2_hash: BytesN<32>,
    pub revoked: bool,
    pub vault: i128, // token units held by the contract for this mandate
}

#[contracttype]
pub enum DataKey {
    Mandate(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyExists = 1,
    NotFound = 2,
    Revoked = 3,
    Expired = 4,
    PerTxCapExceeded = 5, // <-- the demo's money shot
    TotalCapExceeded = 6,
    MerchantNotAllowed = 7,
    InsufficientVault = 8,
    InvalidAmount = 9,
    // appended after the testnet deploy; never renumber the above
    InvalidMandate = 10,
}

#[contract]
pub struct MandateContract;

#[contractimpl]
impl MandateContract {
    /// Grant a mandate. `id` is caller-supplied (sha of canonical fields
    /// off-chain) so it can be referenced before any tx. Principal must authorize.
    pub fn create_mandate(
        env: Env,
        id: BytesN<32>,
        principal: Address,
        agent: Address,
        token: Address,
        max_per_tx: i128,
        total_cap: i128,
        expiry: u64,
        merchants: Vec<Address>,
        ap2_hash: BytesN<32>,
    ) -> Result<(), Error> {
        principal.require_auth();
        // same shape rules as the Solana program: non-zero caps, per-tx <= total
        if max_per_tx <= 0 || total_cap <= 0 || max_per_tx > total_cap {
            return Err(Error::InvalidMandate);
        }
        let key = DataKey::Mandate(id);
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }
        let m = Mandate {
            principal,
            agent,
            token,
            max_per_tx,
            total_cap,
            spent: 0,
            expiry,
            merchants,
            ap2_hash,
            revoked: false,
            vault: 0,
        };
        env.storage().persistent().set(&key, &m);
        Ok(())
    }

    /// Principal funds the mandate's vault (moves token into the contract).
    pub fn fund(env: Env, id: BytesN<32>, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Mandate(id);
        let mut m: Mandate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        m.principal.require_auth();
        token::Client::new(&env, &m.token).transfer(
            &m.principal,
            env.current_contract_address(),
            &amount,
        );
        m.vault += amount;
        env.storage().persistent().set(&key, &m);
        Ok(())
    }

    /// Settle a payment ONLY if within mandate. The backstop: it holds even if
    /// the agent's key is compromised, because caps are enforced here before the
    /// token moves. Reverts with the precise reason otherwise.
    pub fn settle(env: Env, id: BytesN<32>, to: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Mandate(id);
        let mut m: Mandate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        m.agent.require_auth();

        if m.revoked {
            return Err(Error::Revoked);
        }
        if m.expiry != 0 && env.ledger().timestamp() > m.expiry {
            return Err(Error::Expired);
        }
        if amount > m.max_per_tx {
            return Err(Error::PerTxCapExceeded);
        }
        // checked: spent <= total_cap and amount <= max_per_tx keep this far
        // from i128::MAX, but never rely on that silently
        let new_spent = m.spent.checked_add(amount).ok_or(Error::InvalidAmount)?;
        if new_spent > m.total_cap {
            return Err(Error::TotalCapExceeded);
        }
        if !m.merchants.is_empty() && !m.merchants.iter().any(|a| a == to) {
            return Err(Error::MerchantNotAllowed);
        }
        if amount > m.vault {
            return Err(Error::InsufficientVault);
        }

        token::Client::new(&env, &m.token).transfer(&env.current_contract_address(), &to, &amount);
        m.spent = new_spent;
        m.vault -= amount;
        env.storage().persistent().set(&key, &m);
        Ok(())
    }

    /// Principal reclaims unspent funds from the mandate's vault. Without this,
    /// tokens funded into a mandate that is later revoked or expires would be
    /// locked in the contract forever. Allowed at any time, like the Solana
    /// program's `withdraw_unspent`: the vault is the principal's money.
    pub fn withdraw_unspent(env: Env, id: BytesN<32>, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Mandate(id);
        let mut m: Mandate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        m.principal.require_auth();
        if amount > m.vault {
            return Err(Error::InsufficientVault);
        }
        m.vault -= amount;
        env.storage().persistent().set(&key, &m);
        token::Client::new(&env, &m.token).transfer(
            &env.current_contract_address(),
            &m.principal,
            &amount,
        );
        Ok(())
    }

    /// Revoke a mandate. Only the principal. Every future `settle` then reverts.
    pub fn revoke(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let key = DataKey::Mandate(id);
        let mut m: Mandate = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        m.principal.require_auth();
        m.revoked = true;
        env.storage().persistent().set(&key, &m);
        Ok(())
    }

    /// View a mandate's current state.
    pub fn get_mandate(env: Env, id: BytesN<32>) -> Result<Mandate, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Mandate(id))
            .ok_or(Error::NotFound)
    }
}

mod test;
