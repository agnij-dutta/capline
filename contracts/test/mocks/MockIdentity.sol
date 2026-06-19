// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IIdentity} from "../../src/MandateRegistry.sol";

/// @notice Demo/test ERC-8004 Identity stand-in: agentId => controller (owner).
///         On Fuji this is the real ERC-8004 Identity Registry (an ERC-721).
contract MockIdentity is IIdentity {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 agentId, address owner) external {
        owners[agentId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }
}
