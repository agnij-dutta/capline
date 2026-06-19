// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC3009} from "../../src/MandateRegistry.sol";

/// @notice Demo/test USDC stand-in. Moves an internal balance on a 3009 auth.
///         Signature is NOT verified here (real Fuji USDC does) — these tests
///         and the local demo prove the MANDATE caps gate the move; the cap
///         revert in MandateRegistry.settle fires BEFORE this is ever called.
contract MockUSDC is IERC3009 {
    string public name = "USD Coin (mock)";
    mapping(address => uint256) public balanceOf;
    mapping(bytes32 => bool) public usedNonce;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256, // validAfter
        uint256, // validBefore
        bytes32 nonce,
        uint8,
        bytes32,
        bytes32
    ) external {
        require(!usedNonce[nonce], "nonce used"); // EIP-3009 replay protection
        usedNonce[nonce] = true;
        require(balanceOf[from] >= value, "insufficient");
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}
