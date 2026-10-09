# Kolo Backend

**Kolo is a WhatsApp-first community savings platform being built on Stellar.** This TypeScript service connects WhatsApp conversations to member accounts, savings groups, Stellar wallets, and Soroban smart contracts. It is the coordination layer between the messaging experience, off-chain application records, and on-chain settlement.

Kolo is designed for Ajo/Esusu-style rotating savings circles: members agree to contribute on a schedule, and the pooled value is paid to members in an agreed order. The long-term product direction is to use Stellar assets for payments and Soroban for transparent, enforceable group rules.

## How Stellar fits into Kolo

- **Stellar accounts and assets:** The backend creates a platform-managed Stellar wallet for a new WhatsApp user, encrypts the signing secret at rest, and uses Stellar Horizon for account balances, transaction history, native XLM payments, and asset trustlines.
- **SEP-10 authentication:** The auth service creates and verifies Stellar challenge transactions and issues a JWT for the authenticated account.
- **Soroban savings groups:** A background deployment worker uploads the contract WASM, deploys a group contract, and records its contract ID. Contribution handling signs a Soroban invocation with the contributing member's wallet and records the result after confirmation.
- **Reconciliation:** A scheduled worker compares contract contribution state with database records and records mismatches for review rather than silently changing either source.
- **WhatsApp as the interface:** Signed WhatsApp webhooks enter a BullMQ queue; workers process commands and send responses and reminders.

Stellar is intended to give Kolo a shared settlement network for member-to-member transfers and savings-group contributions and payouts. The planned savings asset is USDC issued on Stellar. Soroban is intended to hold that asset under group rules, while Horizon and Soroban RPC let the backend submit transactions and check their ledger or contract results. WhatsApp remains the conversational interface; Stellar provides the wallet, asset, and settlement rails underneath it.

The intended flow is:

```text
WhatsApp message
  -> verified webhook
  -> queued command processing
  -> Kolo services and PostgreSQL
  -> Stellar Horizon payment or Soroban contract call
  -> confirmation and WhatsApp response
```

## Kolo repositories

- [Frontend](https://github.com/Stellar-Kolo/kolo-frontend) — member and admin web experience.
- [Backend](https://github.com/Stellar-Kolo/kolo-backend) — this WhatsApp and Stellar orchestration service.
- [Soroban contracts](https://github.com/Stellar-Kolo/kolo-contracts) — contract-enforced savings group rules.

## Current development status

This repository contains active product and integration work; it is not a production-ready financial service. The web frontend and this backend are not yet fully connected. Some worker implementations exist but are not all started by the current server entry point. The Soroban deployment and payout interfaces are also being aligned with the current contract ABI and membership lifecycle.

The product brief calls for USDC savings, while some implemented wallet transfers and user-facing commands currently use native XLM, and the contract accepts a configured token address. Asset denomination and decimal conversion must be made consistent before treating savings contributions or payouts as live-money flows. Always test on Stellar Testnet and never use production keys in development.

## Main components

- `src/controllers/`, `src/routes/`, `src/middleware/` — WhatsApp webhook and authentication entry points, signature verification, and request controls.
- `src/services/` — user, group, payment request, payout, WhatsApp, Stellar, and Soroban operations.
- `src/queue/`, `src/workers/` — asynchronous message processing, contract deployment, reconciliation, payment requests, and scheduled jobs.
- `prisma/` — PostgreSQL schema and migrations.
- `src/locales/` — English, French, Hausa, Igbo, Nigerian Pidgin, and Yoruba response strings.
- `src/utils/` — encryption, secret handling, audit logging, and related utilities.

## Local development

Requires Node.js, PostgreSQL, and Redis. Configure the environment for the services you intend to run; the application requires encryption and WhatsApp webhook secrets at startup. Do not commit `.env` files, wallet secrets, or API tokens.

```bash
npm ci
npm run dev
```

Other scripts:

```bash
npm start
npm test
```

The backend uses Prisma. Apply migrations and generate the Prisma client according to your local database setup before running against a development database.

## Stellar development notes

- Use Stellar Testnet while developing and configure the matching Horizon and Soroban RPC endpoints.
- Keep secret material in encrypted storage and minimize its lifetime in memory. Never log or expose signing secrets.
- Treat Horizon or Soroban submission as pending until the network confirms the transaction.
- Keep database records reconcilable with transaction hashes and contract state.
- Verify the contract ABI, token address, amount units, authorization requirements, and group membership state together when changing an on-chain flow.

## Tests

The Jest suite covers command processing, webhook verification, encryption, services, workers, and integration scenarios. Run it with:

```bash
npm test
```

For integration tests, configure their required test services and credentials as described in the test setup. Do not point tests at production accounts or contracts.

## Contributing

Open an issue before substantial changes. Stellar and Soroban contributions should include the intended network behavior, authorization model, transaction failure and retry behavior, and tests for the relevant edge cases. Changes to money movement require careful review.
