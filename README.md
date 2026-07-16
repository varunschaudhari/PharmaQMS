# PharmaQMS

A 21 CFR Part 11-capable pharma eQMS SaaS. See [SPEC.md](./SPEC.md) for the full product/build spec and [CLAUDE.md](./CLAUDE.md) for build conventions.

> **Status:** Phase 0 scaffold. No business logic (PLT/DOC/TRN/EQP) is implemented yet — see the phase gate in CLAUDE.md.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (for local MongoDB + Redis)

## Repo layout

```
packages/shared/   # types, enums, zod schemas shared by server + client
server/            # NestJS API (strict TypeScript)
client/            # React + Vite + Tailwind web app
validation-pack/   # regulatory deliverable (changelog, traceability, docs)
```

## Setup

1. Install dependencies (installs all workspaces — `server`, `client`, `packages/shared`):

   ```sh
   npm install
   ```

2. Start local MongoDB + Redis:

   ```sh
   docker compose up -d
   ```

3. Copy environment templates and adjust as needed:

   ```sh
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

4. Seed the local database (dev only — creates the demo tenant, roles, users, numbering schemes, and the 2-step approval workflow template; idempotent, safe to re-run):

   ```sh
   npm run seed
   ```

   All seeded users share the password `Demo123!` (also the e-signature credential). Log in as `admin@demo.local` (Tenant Admin + platform admin), `qa.head@demo.local`, `qa.exec@demo.local`, `prod.head@demo.local`, `operator@demo.local`, or `maintenance@demo.local`. The demo tenant id matches `VITE_DEFAULT_TENANT_ID` in `client/.env`, so the client works with no further configuration.

## Running

| Command | What it does |
|---|---|
| `npm run dev` | Runs the server (NestJS, port 4000) and client (Vite, port 5173) together |
| `npm run test` | Runs the test suite for every workspace (Jest+Supertest on server, Vitest+RTL on client) |
| `npm run lint` | Lints every workspace with the shared ESLint/Prettier config |

Server API is served under `http://localhost:4000/api/v1`. Client dev server runs at `http://localhost:5173`.

## Testing notes

- **Server:** Jest + Supertest, with `mongodb-memory-server` spinning up an in-memory MongoDB per test run — no external database needed to run tests.
- **Client:** Vitest + React Testing Library, jsdom environment.

## Regulatory / validation

Every implemented requirement references its SPEC.md ID (e.g. `DOC-3`, `EQP-6`) in code comments and test names, so the traceability matrix under `validation-pack/` can be generated from test names. Each release gets one line in [validation-pack/CHANGELOG.md](./validation-pack/CHANGELOG.md).
