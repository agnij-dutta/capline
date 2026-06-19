// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IIdentity} from "./MandateRegistry.sol";

/// @title  IdentityRegistry
/// @notice Minimal ERC-8004-style Identity Registry. It is a compact, transfer-
///         enabled ERC-721 where `agentId == tokenId` and the agent's controller
///         is the NFT owner. `register` mints the next id to the caller and
///         records the agent's domain plus an updatable agent-card pointer.
///
///         This satisfies `MandateRegistry`'s controller check: a principal can
///         only grant a mandate for an agent whose token they own.
///
/// @dev    Hand-rolled (no external deps) but follows the canonical ERC-721
///         reference pattern: explicit ownership/approval mappings, zero-address
///         checks, and checks-effects ordering. No safe-transfer receiver hook
///         is implemented because agent identities are not expected to be held by
///         contracts that depend on `onERC721Received`; `transferFrom` is the
///         supported transfer path. Burning is intentionally omitted (identities
///         are persistent so existing mandates never dangle on a vanished owner).
contract IdentityRegistry is IIdentity {
    // --- ERC-721 metadata ---
    string public constant name = "Mandate Agent Identity";
    string public constant symbol = "AGENT";

    // --- ERC-721 state ---
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // --- ERC-8004 agent data ---
    uint256 public nextAgentId = 1; // tokenId 0 is reserved/unused
    mapping(uint256 => string) public agentDomain; // agentId => DNS/registrable domain
    mapping(uint256 => string) public agentCard;    // agentId => agent-card URI (A2A / authority pointer)

    // --- ERC-721 events ---
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // --- ERC-8004 events ---
    /// @notice Emitted when a new agent identity is minted.
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentDomain);
    /// @notice Emitted when an agent's card pointer (incl. the `authority` field that
    ///         references its MandateRegistry mandate) is set or updated.
    event AgentCardUpdated(uint256 indexed agentId, string agentCard);

    error ZeroAddress();
    error NotOwnerOrApproved();
    error NonexistentToken();
    error WrongFrom();
    error NotAuthorized();

    // -----------------------------------------------------------------
    // ERC-8004: registration
    // -----------------------------------------------------------------

    /// @notice Mint the next agent identity to the caller.
    /// @param  agentDomain_ the agent's registrable domain (e.g. "demo-agent.mandate.box").
    /// @return agentId the freshly minted tokenId; caller is its controller (owner).
    function register(string calldata agentDomain_) external returns (uint256 agentId) {
        agentId = nextAgentId++;
        // Effects
        _owners[agentId] = msg.sender;
        unchecked {
            _balances[msg.sender] += 1;
        }
        agentDomain[agentId] = agentDomain_;
        emit Transfer(address(0), msg.sender, agentId);
        emit AgentRegistered(agentId, msg.sender, agentDomain_);
    }

    /// @notice Set/update the agent-card URI for an agent. Only the controller.
    /// @dev    The agent card's `authority` field is expected to point at this
    ///         agent's MandateRegistry mandate, closing the x402 <-> ERC-8004 loop.
    function setAgentCard(uint256 agentId, string calldata uri) external {
        if (_owners[agentId] != msg.sender) revert NotAuthorized();
        agentCard[agentId] = uri;
        emit AgentCardUpdated(agentId, uri);
    }

    // -----------------------------------------------------------------
    // ERC-721 core
    // -----------------------------------------------------------------

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balances[owner];
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operatorApprovals[owner][msg.sender]) revert NotOwnerOrApproved();
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ZeroAddress();
        address owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
        if (owner != from) revert WrongFrom();
        if (
            msg.sender != owner && msg.sender != _tokenApprovals[tokenId]
                && !_operatorApprovals[owner][msg.sender]
        ) revert NotOwnerOrApproved();

        // Effects
        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    /// @dev No receiver hook; agent identities use plain `transferFrom`.
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    // -----------------------------------------------------------------
    // ERC-165
    // -----------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }
}
