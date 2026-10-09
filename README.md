# Kolo Backend — WhatsApp to Stellar

> The coordination layer for community savings that can settle on Stellar.

Kolo is a WhatsApp-first product for communities that already save together through Ajo, Esusu, and other rotating savings circles. This service connects those conversational workflows with member and group records, Stellar accounts and payments, and Soroban savings-group contracts.

The goal is to make a group's agreement understandable and its settlement verifiable: members coordinate in a familiar channel; Kolo tracks the group; Stellar provides the asset and transaction network; Soroban can apply the group's on-chain rules.

**Status:** active development, not a production financial service. Individual Stellar and Soroban services exist, but the complete WhatsApp-to-contract lifecycle is not yet integrated end to end. Read [Current status and limitations](#current-status-and-limitations) before interpreting this repository as a live product.

## Why Stellar is part of Kolo

Savings groups need more than a chat log. They need a reliable record of who contributed, what asset moved, who is next in the rotation, and whether a payout actually settled. Kolo uses Stellar as the planned shared settlement layer for those actions.

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

1. **A group agrees on its rules.** Members, contribution amount, group type, and rotation are represented in Kolo's application state. The planned interface is WhatsApp-first, with a web companion in the [frontend](https://github.com/Stellar-Kolo/kolo-frontend).
2. **A Soroban group can encode the rules.** The contract supports rotational and goal-based groups, a configured token, member authorization, contribution checks, payout order, and pause or recovery operations.
3. **The backend coordinates authorized actions.** It deploys or invokes a group contract, prepares and simulates Soroban transactions, signs and submits them, and waits for confirmation before reporting a result.
4. **Kolo reconciles records.** Contract state and database records can be compared so a mismatch is visible and reviewable instead of being silently treated as success.

The backend is a coordinator, not proof that a transfer has settled. A transaction must be confirmed by Stellar before the application presents the corresponding action as complete. See the [Soroban contract README](https://github.com/Stellar-Kolo/kolo-contracts) for its current interface and limitations.

## Repository family

| Repository | Role |
| --- | --- |
| [kolo-frontend](https://github.com/Stellar-Kolo/kolo-frontend) | Landing page and early member and administrator web screens |
| [kolo-backend](https://github.com/Stellar-Kolo/kolo-backend) | WhatsApp, API, data, Stellar, and Soroban coordination (this repository) |
| [kolo-contracts](https://github.com/Stellar-Kolo/kolo-contracts) | Rust Soroban contract for group savings rules |

## Main components

- `src/controllers/`, `src/routes/`, `src/middleware/` — API and WhatsApp webhook entry points, signature checks, and request controls.
- `src/services/` — user, group, payment request, payout, WhatsApp, Stellar, and Soroban operations.
- `src/queue/`, `src/workers/` — asynchronous message handling, deployment, contribution reconciliation, payment requests, and scheduled jobs.
- `prisma/` — PostgreSQL schema and migrations.
- `src/locales/` — response strings for English, French, Hausa, Igbo, Nigerian Pidgin, and Yoruba.
- `src/utils/` — encryption, secret handling, audit logging, and shared utilities.

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

## Current status and limitations

- The frontend and backend are not yet a fully connected product. Some frontend data, authentication, and wallet routes are prototypes.
- Worker implementations exist, but not all are started by the current server entry point. Verify worker lifecycle before relying on a background flow.
- Contract deployment, member lifecycle, contribution handling, and payout orchestration are still being aligned with the current Soroban ABI.
- The contract code has a Stellar Testnet deployment for review, but no savings group has been initialized. This is not an active savings service.
- Asset denomination is inconsistent: the product brief targets USDC, while implemented payment and command paths include XLM. Contract amounts are integer base units and require exact asset decimal handling.
- Some user-facing operations, including group withdrawal, are marked or implemented as mocked. A success message in a command path is not evidence of an on-chain transfer.
- Platform-managed wallet signing material is encrypted at rest in the current design. Kolo is not currently a self-custody wallet product; key custody and operational safeguards remain part of product and security work.

Use Stellar Testnet for development. Do not use production keys or describe the service as ready to custody funds or run real savings circles.

## Stellar development notes

- Keep the configured Stellar network, Horizon endpoint, Soroban RPC endpoint, and network passphrase aligned.
- Validate the asset code **and issuer**, token contract address, amount units, and conversion rules together.
- Require appropriate user or administrator authorization for every state-changing contract call.
- Treat submission as pending until network confirmation; persist the transaction hash and make retries idempotent.
- Keep database records reconcilable with Horizon transaction data and Soroban contract state.
- Minimize signing-secret lifetime in memory. Never log secrets, seed phrases, tokens, or full environment values.
- Test failure, retry, duplicate-message, partial-group, and reconciliation scenarios on Testnet.

## Tests

The Jest suite covers command processing, webhook verification, encryption, services, workers, and integration scenarios.

```bash
npm test
```

Integration tests may require local services and test credentials. Keep them on Testnet and never point them at production accounts or contracts.

## Contributing

Open an issue for substantial changes and describe the user need and affected workflow. For Stellar or Soroban changes, include network, asset, authorization, confirmation, retry, and failure behavior. Changes that can move pooled funds need focused tests and careful review.
