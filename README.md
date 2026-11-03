# Friends Expense Manager

A full-stack expense-sharing application for friends. It includes authentication, friend requests, equal/custom expense splits, participant approvals, pairwise balances, settlements, and a transaction history.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A PostgreSQL database (Neon works)

## 1. Install

From the project root:

```bash
npm install
```

## 2. Configure the database and secrets

Copy `server/.env.example` to `server/.env` and fill in your own values:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=4000
CLIENT_ORIGIN="http://localhost:5173"
NODE_ENV="development"
```

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Never commit `server/.env`.

## 3. Create database tables

```bash
npm run db:generate
npm run db:migrate
```

When prompted for a migration name, use `init`.

## 4. Run locally

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Health check: http://localhost:4000/api/health

## Core rules implemented

1. The payer must be one of the expense participants.
2. Equal and custom splits are supported.
3. Every participant other than the creator must approve.
4. A pending or rejected expense never changes balances.
5. The last required approval confirms the expense and writes ledger entries atomically.
6. Amounts are stored as integer paise.
7. Confirmed expenses are immutable. Corrections should be made with a new expense or a reversal workflow.
8. Friendships are permanent after acceptance. There is no unfriend endpoint.
9. Settlements require approval by the receiver before they affect balances.
10. Pairwise balances are derived from immutable ledger entries.

## Important notes

- This is a local-first project. Deployment configuration and production hardening are intentionally left for the deployment stage.
- Email/SMS/push notifications are not configured. Pending approvals appear in the app.
- No real money is transferred by this application.
- Before public launch, add email verification, password reset, rate limiting, audit logging, backups, monitoring, and a proper production secret-management setup.
