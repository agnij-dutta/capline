/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/capline.json`.
 */
export type Capline = {
  "address": "DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp",
  "metadata": {
    "name": "capline",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "On-chain spend authority for AI agents — AP2 mandate enforcement on Solana"
  },
  "instructions": [
    {
      "name": "attestAp2",
      "docs": [
        "Prove the principal actually ed25519-SIGNED the AP2 mandate — not just",
        "that someone committed a hash. The transaction must carry an Ed25519",
        "program instruction (the native program verifies the signature); this",
        "handler introspects it and binds it: the signer must be the principal,",
        "and sha256(signed message) must equal the mandate's committed ap2_hash.",
        "Flips `ap2_verified`, turning the commitment into a proof."
      ],
      "discriminator": [
        50,
        75,
        178,
        13,
        216,
        233,
        116,
        130
      ],
      "accounts": [
        {
          "name": "principal",
          "signer": true
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.principal",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.nonce",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createMandate",
      "docs": [
        "A principal (the human/owner) grants a bounded, revocable mandate to an",
        "agent's wallet. The mandate PDA owns a vault the agent spends *from* — but",
        "only through `settle`, which enforces every constraint on-chain."
      ],
      "discriminator": [
        230,
        170,
        158,
        68,
        33,
        169,
        16,
        158
      ],
      "accounts": [
        {
          "name": "principal",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "principal"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mandate"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "agent",
          "type": "pubkey"
        },
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "totalCap",
          "type": "u64"
        },
        {
          "name": "notAfter",
          "type": "i64"
        },
        {
          "name": "ap2Hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "merchants",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "revoke",
      "docs": [
        "The principal can kill a mandate at any time. Enforcement is immediate:",
        "the next `settle` reverts with MandateRevoked."
      ],
      "discriminator": [
        170,
        23,
        31,
        34,
        133,
        173,
        93,
        242
      ],
      "accounts": [
        {
          "name": "principal",
          "signer": true
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.principal",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.nonce",
                "account": "mandate"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "settle",
      "docs": [
        "Layer-B enforcement. The agent (or an attacker holding the agent key)",
        "requests a payment of `amount` to `merchant`. Every check below is code,",
        "not language — no jailbreak prompt changes `amount > max_per_tx`."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.principal",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.nonce",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "agent",
          "docs": [
            "The agent key. May be compromised — enforcement does not trust it."
          ],
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "merchant"
        },
        {
          "name": "merchantTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawUnspent",
      "docs": [
        "Principal reclaims whatever the agent didn't spend."
      ],
      "discriminator": [
        189,
        32,
        15,
        199,
        98,
        73,
        236,
        235
      ],
      "accounts": [
        {
          "name": "principal",
          "signer": true
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.principal",
                "account": "mandate"
              },
              {
                "kind": "account",
                "path": "mandate.nonce",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "principalTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "mandate",
      "discriminator": [
        113,
        216,
        98,
        159,
        185,
        63,
        55,
        18
      ]
    }
  ],
  "events": [
    {
      "name": "ap2Verified",
      "discriminator": [
        36,
        165,
        70,
        117,
        84,
        231,
        80,
        3
      ]
    },
    {
      "name": "mandateCreated",
      "discriminator": [
        140,
        30,
        209,
        254,
        5,
        128,
        147,
        113
      ]
    },
    {
      "name": "revoked",
      "discriminator": [
        113,
        216,
        148,
        99,
        124,
        184,
        0,
        65
      ]
    },
    {
      "name": "settled",
      "discriminator": [
        232,
        210,
        40,
        17,
        142,
        124,
        145,
        238
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mandateRevoked",
      "msg": "mandate has been revoked"
    },
    {
      "code": 6001,
      "name": "mandateExpired",
      "msg": "mandate spend window has expired"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "signer is not the granted agent"
    },
    {
      "code": 6003,
      "name": "perTxCapExceeded",
      "msg": "amount exceeds the per-transaction cap"
    },
    {
      "code": 6004,
      "name": "totalCapExceeded",
      "msg": "amount would exceed the total mandate cap"
    },
    {
      "code": 6005,
      "name": "merchantNotAllowed",
      "msg": "merchant is not on the signed allowlist"
    },
    {
      "code": 6006,
      "name": "invalidMerchantAccount",
      "msg": "merchant token account does not match merchant/mint"
    },
    {
      "code": 6007,
      "name": "tooManyMerchants",
      "msg": "too many merchants for the allowlist"
    },
    {
      "code": 6008,
      "name": "badCap",
      "msg": "caps must be non-zero"
    },
    {
      "code": 6009,
      "name": "capOrdering",
      "msg": "max_per_tx must be <= total_cap"
    },
    {
      "code": 6010,
      "name": "badTimeWindow",
      "msg": "not_after must be in the future"
    },
    {
      "code": 6011,
      "name": "mathOverflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6012,
      "name": "missingAp2Proof",
      "msg": "no Ed25519 signature-verification instruction found in the transaction"
    },
    {
      "code": 6013,
      "name": "badAp2Proof",
      "msg": "malformed Ed25519 instruction data"
    },
    {
      "code": 6014,
      "name": "ap2SignerMismatch",
      "msg": "AP2 signature is not from the mandate principal"
    },
    {
      "code": 6015,
      "name": "ap2HashMismatch",
      "msg": "signed message does not match the committed AP2 hash"
    }
  ],
  "types": [
    {
      "name": "ap2Verified",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "signer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "mandate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "principal",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "totalCap",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "notAfter",
            "type": "i64"
          },
          {
            "name": "ap2Hash",
            "docs": [
              "sha256 of the off-chain signed AP2 Intent Mandate — binds on-chain policy",
              "to the exact intent the principal signed."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "merchants",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "ap2Verified",
            "docs": [
              "true once the principal's ed25519 signature over the AP2 mandate has been",
              "proven on-chain (see `attest_ap2`)."
            ],
            "type": "bool"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mandateCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "totalCap",
            "type": "u64"
          },
          {
            "name": "notAfter",
            "type": "i64"
          },
          {
            "name": "ap2Hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "revoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "settled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
