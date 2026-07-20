# VibeCodingTribe Testing Exchange

VibeCodingTribe is a credit-based exchange where builders test each other’s products. The exchange lives at `/exchange`; the public Tribe Chat remains at [`/r/general`](https://vibecodingtribe.com/r/general).

Missions, claims, feedback, credits, and planning artifacts use an authenticated Worker API backed by a transactional Cloudflare Durable Object. There are no seeded users, guest credit accounts, or reset commands. This is a real server-authoritative MVP, but it is not yet ready for unrestricted public launch—see [Current boundary](#current-boundary).

## What works

### Server-backed testing exchange

- LinkedIn/GitHub-backed builder identities, skills, devices, and reputation signals
- 10-credit starter grants represented as balanced, append-only postings
- Product + mission creation and 10-credit escrow funding
- Mission discovery, self-testing prevention, one-active-claim enforcement, and a 48-hour deadline
- Structured feedback with severity, expected/actual behavior, recommendation, and evidence URL
- Requester review through Needs You
- Atomic 8-credit tester reward + 2-credit platform sink settlement
- Immutable transaction views and derived balances
- Accepted-feedback-only conversion into draft tasks through a deterministic, read-only server planning adapter
- Authenticated, idempotent exchange commands with atomic Durable Object transactions
- Server-derived ownership; browsers cannot choose requester or tester identities in production
- Lazy abandoned-claim expiry and projected per-user API responses

### Existing production services

- One public server and canonical room at `/r/general`
- Public read access without an account
- Authenticated posting with GitHub OAuth or LinkedIn OpenID Connect
- Persistent signed browser sessions refreshed for up to 30 days
- Realtime WebSocket messages
- Live presence and participant identities
- Optimistic sending, retry, and a reconnecting browser outbox
- Durable history of the latest 200 accepted messages
- Responsive desktop and mobile layouts

GitHub and LinkedIn sign-in establish the identity displayed in chat. They do not prove community membership or grant repository access.

## Room visibility model

- **Public rooms** can be read by anyone. Posting requires an authenticated identity.
- **Private rooms** are the member-only model for future servers and rooms. They will require authorization to read or post and are not implemented yet.

## Run locally

```bash
npm install
npm run dev
```

The client runs at [http://localhost:4173](http://localhost:4173). Run the Worker in another terminal before testing the exchange or realtime chat:

```bash
cp .dev.vars.example .dev.vars
npm run dev:realtime
```

The local Worker runs at `http://localhost:8787`. Exchange writes and chat posting require a real LinkedIn or GitHub session in every environment. Open the exchange at [http://localhost:4173/exchange](http://localhost:4173/exchange).

## Authentication

Production callbacks:

```text
https://vibecodingtribe-realtime.techfren.workers.dev/auth/github/callback
https://vibecodingtribe-realtime.techfren.workers.dev/auth/linkedin/callback
```

The Worker requires these secrets:

```text
SESSION_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET
```

GitHub requests `read:user`. LinkedIn requests `openid profile`. Provider access tokens are only used to resolve identity and are not retained.

## Architecture

```text
React client on Cloudflare Pages
  ├── ExchangeApiClient
  │     └── authenticated HTTP commands
  │           └── Cloudflare Worker
  │                 └── ExchangeStore Durable Object
  │                       ├── missions, claims, and feedback
  │                       ├── append-only credit postings
  │                       ├── idempotency records
  │                       └── draft planning artifacts
  └── RealtimeRoomClient
        └── public read-only or authenticated WebSocket
              └── Cloudflare Worker
                    └── RealtimeRoom Durable Object
                          ├── connected participants
                          └── latest 200 messages
```

The Worker derives the exchange actor and chat identity from the signed OAuth session. Exchange mutations require idempotency keys and run in Durable Object storage transactions. Anonymous sockets can receive public chat history, messages, and presence but cannot send.

## Commands

```bash
npm run typecheck
npx tsc -p tsconfig.worker.json --noEmit
npm run lint
npm test
npm run build
npm run build:docs
npm run deploy:realtime
npm run deploy:cloudflare
npm run deploy:docs
```

## Current boundary

The exchange is now authoritative on the server for its implemented flow. Credits are closed-loop application credits, not money, purchases, or withdrawals. Before unrestricted public launch, the product still needs account linking, LinkedIn nonce validation, R2-backed evidence uploads, proactive scheduled expiry, reject/clarify/dispute/admin paths, editable profiles, rate limits, abuse controls, observability, and recovery procedures. The current single Durable Object stores one aggregate JSON snapshot, which is appropriate for the first cohort but must be sharded or normalized before high-volume growth. Planning artifacts are drafts only and agents never receive repository access.

The full reuse assessment, proposed data model, lifecycle, authentication plan, agent boundary, and productionization sequence are in [`docs/testing-exchange-mvp.md`](docs/testing-exchange-mvp.md).

See [`docs/implementation-status.md`](docs/implementation-status.md) for the implementation handoff.
