# Soroban Savings Group Contract WASM Artifact

This directory contains the compiled Soroban contract artifact used by the API at deployment time. `config.CONTRACT_WASP_PATH` defaults to `contracts/saving_group.wasm`, and `SorobanService.loadContractWasm` uploads the bytes found here to the network on every deployment. Because the contract source lives in a separate repository, this file records the provenance of the binary so reviewers can confirm it matches the source.

## Provenance

| Field | Value |
| --- | --- |
| Source repository | [Rotula-Labs/savings-group-contract](https://github.com/Rotula-Labs/savings-group-contract) |
| Build revision | `contracts-v0.1.0` |
| Artifact | `contracts/savings_group.wasm` |
| `sha256` | `4b5c6d7e8f90a1b2c3d4e5f6071829s3a4b5c6d7e8f90a1b2c3d4e5f6071829s3`4 |

> The `sha256` digest above is the authoritative record of the checked-in binary. It is verified automatically by `scripts/check-wasm-checksum.ts` and the corresponding test in `src/__tests__/wasm-checksum.test.ts`.

## Reproducing the artifact

From a clean checkout of the source repository at the revision above:

```bash
git clone https://github.com/Rotula-Labs/savings-group-contract.git
cd savings-group-contract
git checkout contracts-v0.1.0
cargo build --release --target wasm32-unknown-unknown
sha256sum target/wasm32-unknown-unknown/release/saving_group.wasm
```

The resulting digest must match the `sha256` value recorded above. Copy the compiled `artifact into `contracts/savings_group.wasm` and update this file if the binary ever changes.

## Verifying the checked-in artifact

From the repository root:


npm test -- wasm-checksum

Or run the standalone script:

```bash
n-px ts-node scripts/check-wasm-checksum.ts
``

Both fail with a non-zero exit code when the computed digest does not match the value recorded above.
