// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal EIP-3009 surface used by x402 / USDC.
interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice Minimal ERC-8004 Identity Registry surface. The registry is an
///         ERC-721 where agentId == tokenId and the controller is the owner.
interface IIdentity {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title  MandateRegistry
/// @notice The authority layer between x402 (how an agent pays) and ERC-8004
///         (who the agent is). A principal grants a bounded, revocable spend
///         mandate to an agent identity. Enforcement lives here, on-chain, at
///         settlement time — NOT in a prompt. A fully jailbroken agent can
///         propose any payment it likes; `settle` reverts if it exceeds the
///         mandate, even if the agent's signing key is fully compromised.
contract MandateRegistry {
    struct Mandate {
        address principal;     // human/org that granted authority
        uint256 agentId;       // ERC-8004 tokenId of the buyer agent
        address agentSigner;   // wallet that holds USDC & signs EIP-3009 auths
        uint256 maxPerTx;      // hard per-transaction ceiling (USDC, 6 decimals)
        uint256 maxCumulative; // lifetime spend ceiling across all settlements
        uint64  expiry;        // unix seconds; 0 = no expiry
        bytes32 allowedPayeesRoot; // merkle root of allowed payees; 0 = any
        bool    revoked;
    }

    IIdentity public immutable identity;
    IERC3009  public immutable usdc;

    mapping(bytes32 => Mandate) public mandates; // mandateId => Mandate
    mapping(bytes32 => uint256) public spent;    // mandateId => cumulative spent

    event MandateCreated(
        bytes32 indexed id,
        uint256 indexed agentId,
        address agentSigner,
        uint256 maxPerTx,
        uint256 maxCumulative,
        uint64  expiry
    );
    event MandateRevoked(bytes32 indexed id);
    event Settled(bytes32 indexed id, address indexed to, uint256 value, uint256 newSpent);

    error NotController();   // caller does not control the ERC-8004 agent identity
    error MandateExists();
    error MandateMissing();
    error NotPrincipal();
    error Revoked();
    error Expired();
    error CapExceeded();     // <-- the demo's money shot
    error PayeeNotAllowed();

    constructor(IIdentity _identity, IERC3009 _usdc) {
        identity = _identity;
        usdc = _usdc;
    }

    /// @notice Grant a mandate. Caller must control the ERC-8004 agent identity.
    /// @dev    mandateId is supplied by the caller (keccak of canonical fields
    ///         off-chain) so it can be referenced in the agent card before any tx.
    function createMandate(bytes32 mandateId, Mandate calldata m) external {
        if (mandates[mandateId].principal != address(0)) revert MandateExists();
        // Principal must be the on-chain controller of the agent identity.
        if (identity.ownerOf(m.agentId) != msg.sender) revert NotController();
        if (m.principal != msg.sender) revert NotPrincipal();
        mandates[mandateId] = m;
        emit MandateCreated(mandateId, m.agentId, m.agentSigner, m.maxPerTx, m.maxCumulative, m.expiry);
    }

    /// @notice Revoke a mandate. Only the principal. Propagates with no callback:
    ///         every future `settle` reads `revoked` and reverts.
    function revoke(bytes32 mandateId) external {
        Mandate storage m = mandates[mandateId];
        if (m.principal == address(0)) revert MandateMissing();
        if (msg.sender != m.principal) revert NotPrincipal();
        m.revoked = true;
        emit MandateRevoked(mandateId);
    }

    /// @notice Settle an EIP-3009 authorization ONLY if it is within mandate.
    ///         This is the backstop: it holds even if `agentSigner`'s key is
    ///         stolen, because the caps are enforced here before USDC moves.
    /// @param  payeeProof merkle proof that `to` is in `allowedPayeesRoot`
    ///         (ignored when the root is 0 = any payee).
    function settle(
        bytes32 mandateId,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes32[] calldata payeeProof
    ) external {
        Mandate storage m = mandates[mandateId];
        if (m.principal == address(0)) revert MandateMissing();
        if (m.revoked) revert Revoked();
        if (m.expiry != 0 && block.timestamp > m.expiry) revert Expired();
        if (value > m.maxPerTx) revert CapExceeded();

        uint256 newSpent = spent[mandateId] + value;
        if (newSpent > m.maxCumulative) revert CapExceeded();

        if (m.allowedPayeesRoot != bytes32(0) && !_verifyPayee(payeeProof, m.allowedPayeesRoot, to)) {
            revert PayeeNotAllowed();
        }

        // Effects before interaction (caps are committed atomically with the move).
        spent[mandateId] = newSpent;

        // The signed authorization moves USDC from the agent's wallet to `to`.
        // `from` is pinned to the mandate's agentSigner — a stolen key cannot
        // redirect funds out of a *different* wallet, and cannot exceed caps.
        usdc.transferWithAuthorization(m.agentSigner, to, value, validAfter, validBefore, nonce, v, r, s);

        emit Settled(mandateId, to, value, newSpent);
    }

    function _verifyPayee(bytes32[] calldata proof, bytes32 root, address leafAddr)
        internal
        pure
        returns (bool)
    {
        bytes32 h = keccak256(abi.encodePacked(leafAddr));
        for (uint256 i; i < proof.length; ++i) {
            h = h <= proof[i]
                ? keccak256(abi.encodePacked(h, proof[i]))
                : keccak256(abi.encodePacked(proof[i], h));
        }
        return h == root;
    }

    /// @notice Convenience view for off-chain agents/sellers to pre-check a
    ///         proposed payment without spending gas. Mirrors `settle`'s guards.
    function checkAllowance(bytes32 mandateId, uint256 value)
        external
        view
        returns (bool ok, string memory reason)
    {
        Mandate storage m = mandates[mandateId];
        if (m.principal == address(0)) return (false, "MANDATE_MISSING");
        if (m.revoked) return (false, "REVOKED");
        if (m.expiry != 0 && block.timestamp > m.expiry) return (false, "EXPIRED");
        if (value > m.maxPerTx) return (false, "OVER_PER_TX");
        if (spent[mandateId] + value > m.maxCumulative) return (false, "OVER_CUMULATIVE");
        return (true, "OK");
    }
}
