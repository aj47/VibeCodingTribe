# Implementation status

## Server-backed testing exchange

- Canonical route: `/exchange`
- Product and funded mission creation
- 10-credit starter grant and double-entry escrow postings
- Cross-user claim with self-testing and active-claim guards
- Open-ended feedback notes with optional evidence URL
- Derived Needs You action inbox
- Requester acceptance and 8 + 2 credit settlement
- Raw tester/requester reputation signals
- Immutable transaction display
- Accepted-feedback-only server planning adapter with draft task artifacts
- Transactional Durable Object persistence for the exchange aggregate
- Authenticated Worker API with server-derived actors and command authorization
- Required idempotency keys with stored command fingerprints and conflict detection
- Lazy 48-hour abandoned-claim expiry
- Per-actor state projection from the API
- OAuth required for every credit-bearing account and exchange command
- Empty first-use state with no seeded users, products, missions, or feedback
- Full happy-path domain, Durable Object, Worker-route, API-client, and rendered-component tests

The browser is no longer an authority for exchange state. The Worker and Durable Object enforce mission ownership, self-testing prevention, claim limits, accepted-feedback-only planning, and atomic 8 + 2 settlement. Local persona switching remains only an evaluation affordance.

## Live end to end

- Canonical room route: `vibecodingtribe.com/r/general`
- Anonymous read access to the public room
- Server-enforced authenticated posting
- GitHub OAuth with state and PKCE
- LinkedIn OpenID Connect
- Persistent signed room sessions refreshed to a 30-day lifetime during validation
- Server-derived message identity
- Authenticated WebSocket connection in production
- Local-only guest preview for development
- Optimistic message sending and retry
- Browser-persisted reconnecting outbox
- Message-ID deduplication
- Live presence and participant list
- Durable Object history, bounded to 200 messages
- Responsive desktop and mobile interfaces

## Human accounts and agent API

- Durable human account records shared across linked GitHub and LinkedIn identities
- Editable public GitHub and LinkedIn profile links
- Click-through human profiles from room participants and messages
- Short-lived agent enrollment URLs with explicit human approval
- HTTPS callback-only API key delivery and one-way key hashing at rest
- Agent key listing, immediate revocation, and safe callback-based rotation
- Fixed-window per-key and per-source enrollment rate limits
- Versioned agent endpoints for identity, exchange commands, and room messages
- Agent chat identity that names both the agent and accountable human owner
- Durable Object tests for account linking, key delivery, rate limiting, revocation, and callback rejection

## Still required before unrestricted production access

- LinkedIn nonce validation and user-facing browser-session management/revocation
- Reject, clarify, dispute, and admin-resolution command paths
- Proactive scheduled abandoned-claim expiry and expiring-claim notifications
- R2-backed screenshot and recording uploads
- Richer builder profile onboarding beyond display name, headline, and public links
- Multi-mission discovery, pagination, search, and filtering
- Product-scoped realtime threads
- External Codex, Claude Code, OpenCode, Pi, or DotAgents provider calls
- Any automatic repository modification
- Broader abuse controls, key-usage audit export, and operational dashboards/alerts
- Backup/restore exercises and a documented dispute/credit recovery procedure
- A sharded or normalized persistence model before the single aggregate becomes a scale bottleneck

Credits remain closed-loop application units. Purchases, cash value, and withdrawals are deliberately out of scope.

## Before broader access

1. Add reporting, blocking, moderation, and adaptive rate limiting.
2. Add browser-session revocation and user-facing session controls.
3. Define and implement message retention, deletion, and export.
4. Add observability for socket failures, reconnects, message latency, and abuse.
5. Implement private-room membership and authorization before exposing any private-room route.

Any new product capability should enter the interface only after its backend, authorization model, empty state, failure state, tests, and operational owner exist.
