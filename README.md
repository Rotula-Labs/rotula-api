# Rotula API — WhatsApp to Stellar

> The coordination layer for community savings that can settle on Stellar.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-%237b2ff7?logo=stellar)](https://developers.stellar.org)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-%23339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-%233178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Postgres](https://img.shields.io/badge/Postgres-Prisma-%234169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Rotula is a WhatsApp-first product for communities that already save together through Ajo, Esusu, and other rotating savings circles. This service connects those conversational workflows with member and group records, Stellar accounts and payments, and Soroban savings-group contracts.

The goal is to make a group's agreement understandable and its settlement verifiable: members coordinate in a familiar channel; Rotula tracks the group; Stellar provides the asset and transaction network; Soroban can apply the group's on-chain rules.

**Status:** active development, not a production financial service. Individual Stellar and Soroban services exist, but the complete WhatsApp-to-contract lifecycle is not yet integrated end to end. Read [Current status and limitations](#current-status-and-limitations) before interpreting this repository as a live product.

## Table of Contents

- [Why Stellar is part of Rotula](#why-stellar-is-part-of-rotula)
- [How the savings model maps to Stellar](#how-the-savings-model-maps-to-stellar)
- [Repository family](#repository-family)
- [Main components](#main-components)
- [Prerequisites](#prerequisites)
- [Development setup](#development-setup)
- [Environment Variables Reference](#environment-variables-reference)
- [Current status and limitations](#current-status-and-limitations)
- [Stellar development notes](#stellar-development-notes)
- [Security Notes](#security-notes)
- [Tests](#tests)
- [Contributing](#contributing)

## Why Stellar is part of Rotula

Savings groups need more than a chat log. They need a reliable record of who contributed, what asset moved, who is next in the rotation, and whether a payout actually settled. Rotula uses Stellar as the planned shared settlement layer for those actions.

- **Stellar accounts and Horizon:** The service can create Stellar keypairs, encrypt generated signing material for storage, read account balances and transaction history, create asset trustlines, and submit native XLM payments. It connects to Horizon on the configured testnet or public network.
- **Soroban contracts:** The service can upload contract WASM, deploy group instances, invoke contract operations, simulate transactions, submit them through Soroban RPC, and poll for confirmation. Contract state can be queried for reconciliation.
- **SEP-10:** Authentication services implement Stellar challenge transaction creation and verification before issuing application authentication.
- **WhatsApp orchestration:** Webhooks are verified, commands are queued through BullMQ and Redis, then workers process commands and send localized responses and reminders.
- **Reconciliation:** A worker compares contribution state in Soroban with application records and records discrepancies for investigation.

```text
WhatsApp
   │ signed webhook
   ▼
Express API ──► BullMQ / Redis ──► command and schedule workers
                                      │
                                      ├──► PostgreSQL / Prisma
                                      ├──► Stellar Horizon payments and accounts
                                      └──► Soroban RPC contract calls
                                               │
                                               ▼
                                      confirmation + reconciliation
```

The product brief targets **USDC on Stellar** for savings. That is not yet consistent across the implementation: several payment and command flows currently use native XLM, while the contract accepts whichever token contract is configured. Asset choice, issuer, decimal conversion, authorization, and payout accounting must be made consistent before treating contributions as a live-money feature.

## How the savings model maps to Stellar

1. **A group agrees on its rules.** Members, contribution amount, group type, and rotation are represented in Rotula's application state. The planned interface is WhatsApp-first, with a web companion in the [frontend](https://github.com/Rotula-Labs/rotula-app).
2. **A Soroban group can encode the rules.** The contract supports rotational and goal-based groups, a configured token, member authorization, contribution checks, payout order, and pause or recovery operations.
3. **The backend coordinates authorized actions.** It deploys or invokes a group contract, prepares and simulates Soroban transactions, signs and submits them, and waits for confirmation before reporting a result.
4. **Rotula reconciles records.** Contract state and database records can be compared so a mismatch is visible and reviewable instead of being silently treated as success.

The backend is a coordinator, not proof that a transfer has settled. A transaction must be confirmed by Stellar before the application presents the corresponding action as complete. See the [Soroban contract README](https://github.com/Rotula-Labs/rotula-contracts) for its current interface and limitations.

## Repository family

| Repository                                                          | Role                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [rotula-app](https://github.com/Rotula-Labs/rotula-app)             | Landing page and early member and administrator web screens              |
| [rotula-api](https://github.com/Rotula-Labs/rotula-api)             | WhatsApp, API, data, Stellar, and Soroban coordination (this repository) |
| [rotula-contracts](https://github.com/Rotula-Labs/rotula-contracts) | Rust Soroban contract for group savings rules                            |

## Main components

- `src/controllers/`, `src/routes/`, `src/middleware/` — API and WhatsApp webhook entry points, signature checks, and request controls.
- `src/services/` — user, group, payment request, payout, WhatsApp, Stellar, and Soroban operations.
- `src/queue/`, `src/workers/` — asynchronous message handling, deployment, contribution reconciliation, payment requests, and scheduled jobs.
- `prisma/` — PostgreSQL schema and migrations.
- `src/locales/` — response strings for English, French, Hausa, Igbo, Nigerian Pidgin, and Yoruba.
- `src/utils/` — encryption, secret handling, audit logging, and shared utilities.

## Prerequisites

| Tool                | Version / Notes                                                         | Install                                                 |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| **Node.js**         | 20 or newer, with npm                                                   | https://nodejs.org                                      |
| **PostgreSQL**      | a running instance for Prisma migrations and data-backed flows          | https://www.postgresql.org                              |
| **Redis**           | a running instance for BullMQ queues and workers                        | https://redis.io                                        |
| **Stellar Testnet** | a Soroban RPC endpoint and a funded deployer identity for contract work | `stellar keys generate <name> --network testnet --fund` |

Verify your setup:

```bash
node --version
psql --version
redis-server --version
```

## Development setup

Requires Node.js, PostgreSQL, and Redis. Configure the environment for the services being used. The application requires encryption and WhatsApp webhook secrets at startup; keep all credentials in local environment configuration or a secret manager, never in Git.

```bash
npm ci
npm run dev
```

Available scripts:

```bash
npm start
npm test
```

Apply Prisma migrations and generate the Prisma client for your development database before running database-backed flows. Configure Stellar Testnet and a Soroban Testnet RPC endpoint for integration work.

## Environment Variables Reference

Copy the required values into a local `.env` (never committed). Grouped by area:

| Variable                                                                            | Area     | Purpose                                                   |
| ----------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `NODE_ENV`                                                                          | Runtime  | `development`, `test`, or `production`                    |
| `PORT`                                                                              | Runtime  | HTTP port for the Express server                          |
| `DATABASE_URL`                                                                      | Data     | PostgreSQL connection string used by Prisma               |
| `REDIS_URL`                                                                         | Data     | Redis connection string for BullMQ queues and workers     |
| `JWT_SECRET`                                                                        | Auth     | Signing secret for application sessions                   |
| `HMAC_KEY`                                                                          | Security | Key for request/webhook integrity checks                  |
| `ENCRYPTION_KEY`, `ENCRYPTION_KEY_V1..V3`                                           | Security | At-rest encryption keys for stored wallet material        |
| `CURRENT_ENCRYPTION_KEY_VERSION`                                                    | Security | Which encryption key version new records use              |
| `STELLAR_NETWORK`                                                                   | Stellar  | Target network (`testnet` or `public`)                    |
| `SOROBAN_RPC_URL`                                                                   | Stellar  | Soroban RPC endpoint for contract calls                   |
| `CONTRACT_WASM_PATH`                                                                | Stellar  | Path to the compiled savings-group Wasm for deploys       |
| `DEPLOYER_SECRET_KEY`                                                               | Stellar  | Deployer identity used to publish contract instances      |
| `GROUP_TREASURY_SECRET`                                                             | Stellar  | Treasury signing material for group flows                 |
| `USDC_TOKEN_ADDRESS`, `USDC_ISSUER_PUBLIC_KEY`                                      | Assets   | Configured savings token contract and issuer              |
| `SEP10_HOME_DOMAIN`, `SEP10_SERVER_SECRET`, `SEP10_CHALLENGE_TTL_SECONDS`           | SEP-10   | Challenge transaction settings for Stellar authentication |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `VERIFY_TOKEN` | WhatsApp | Cloud API credentials and webhook verification            |
| `ADMIN_TOKEN`, `ADMIN_PHONE_NUMBER`                                                 | Admin    | Operator access to administrative commands                |
| `MAX_PAYOUT_DEADLINE_EXTENSIONS`                                                    | Rules    | Upper bound on payout deadline extensions                 |

Every value above is a placeholder in your own configuration; none is committed. See [Security Notes](#security-notes) for how secrets are handled.

## Current status and limitations

- The frontend and backend are not yet a fully connected product. Some frontend data, authentication, and wallet routes are prototypes.
- Worker implementations exist, but not all are started by the current server entry point. Verify worker lifecycle before relying on a background flow.
- Contract deployment, member lifecycle, contribution handling, and payout orchestration are still being aligned with the current Soroban ABI.
- The contract code has a Stellar Testnet deployment for review, but no savings group has been initialized. This is not an active savings service.
- Asset denomination is inconsistent: the product brief targets USDC, while implemented payment and command paths include XLM. Contract amounts are integer base units and require exact asset decimal handling.
- Some user-facing operations, including group withdrawal, are marked or implemented as mocked. A success message in a command path is not evidence of an on-chain transfer.
- Platform-managed wallet signing material is encrypted at rest in the current design. Rotula is not currently a self-custody wallet product; key custody and operational safeguards remain part of product and security work.

Use Stellar Testnet for development. Do not use production keys or describe the service as ready to custody funds or run real savings circles.

## Stellar development notes

- Keep the configured Stellar network, Horizon endpoint, Soroban RPC endpoint, and network passphrase aligned.
- Validate the asset code **and issuer**, token contract address, amount units, and conversion rules together.
- Require appropriate user or administrator authorization for every state-changing contract call.
- Treat submission as pending until network confirmation; persist the transaction hash and make retries idempotent.
- Keep database records reconcilable with Horizon transaction data and Soroban contract state.
- Minimize signing-secret lifetime in memory. Never log secrets, seed phrases, tokens, or full environment values.
- Test failure, retry, duplicate-message, partial-group, and reconciliation scenarios on Testnet.

## Security Notes

- **Secrets never enter Git.** Only placeholders belong in the repository; real values live in local environment configuration or a secret manager, and `.gitignore` keeps `.env` out of commits.
- **Signing material is encrypted at rest.** Platform-managed wallet keys are stored encrypted; Rotula is not currently a self-custody product, so key custody and operational safeguards remain part of the security work.
- **Authorization is on chain.** Every state-changing contract call requires the corresponding Soroban authorization; a success message in a command path is not evidence of an on-chain transfer.
- **Confirm before claiming success.** A submitted transaction is pending until Stellar confirms it. Persist the transaction hash and make retries idempotent.
- **Never log secrets.** Do not print seed phrases, keys, tokens, or full environment values on any path, including errors.
- **Testnet by default.** Develop against Stellar Testnet and never point tests or demos at production accounts or contracts.

## Tests

The Jest suite covers command processing, webhook verification, encryption, services, workers, and integration scenarios.

```bash
npm test
```

Integration tests may require local services and test credentials. Keep them on Testnet and never point them at production accounts or contracts.

## Contributing

Open an issue for substantial changes and describe the user need and affected workflow. For Stellar or Soroban changes, include network, asset, authorization, confirmation, retry, and failure behavior. Changes that can move pooled funds need focused tests and careful review.
