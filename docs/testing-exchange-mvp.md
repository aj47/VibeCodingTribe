# Testing Exchange MVP

This document records the product and architecture decision for pivoting VibeCodingTribe from a public chat room into a testing exchange. It reflects the codebase as it exists on July 20, 2026.

## Implementation update

The first server-backed tranche is complete. `/api/exchange` authenticates the actor in the Worker and delegates to an `ExchangeStore` Durable Object. Its storage transaction atomically applies domain commands, writes the exchange snapshot, and stores the idempotent command fingerprint. The React client does not read or write authoritative exchange state in browser storage. A signed LinkedIn or GitHub session is required in every environment.

The verified flow is: a new requester receives 10 credits and funds a 10-credit mission; another authenticated builder claims it and submits structured feedback; the requester accepts it; the tester receives 8 credits; 2 credits move to the platform sink; and the server planning adapter persists read-only task drafts. A reload preserves the result.

## 1. Current codebase reuse assessment

### Reuse directly

| Existing capability | Evidence | Exchange use |
| --- | --- | --- |
| GitHub OAuth and LinkedIn OpenID Connect | `worker/auth.ts`, `src/services/auth.ts` | Keep LinkedIn as the primary credible identity and GitHub as the fallback. Keep signed, refreshed 30-day sessions. |
| Server-derived realtime identity | `worker/index.ts` | Use the authenticated provider subject as the stable user identity. Do not accept requester/tester identity from the browser in production. |
| Public room WebSocket, message history, presence, reconnecting outbox | `worker/index.ts`, `src/services/realtime.ts` | Recast a room as a product discussion space. Reuse messages for clarification after the mission workflow exists. |
| Provider-aware profile display | `src/auth/types.ts`, `LiveRoom.tsx` | Seed the exchange profile from OAuth and add GitHub, website, skills, and device fields. |
| Existing visual system and responsive shell | `src/styles.css`, `Brand.tsx` | Extend the Manrope/IBM Plex Mono system, compact controls, status treatments, and responsive breakpoints. |
| Cloudflare Pages + Worker + Durable Object deployment | `package.json`, `wrangler.realtime.jsonc` | Host the exchange API and authoritative state without adding a second infrastructure stack. |
| Validation and automated-test conventions | `src/realtime/protocol.ts`, Vitest suites | Put mission and ledger rules in a pure domain module and test invariants before wiring persistence. |

### Reuse conceptually, but rebuild

The requested “threads,” “Needs You,” “agent approval,” and “activity” systems are not present in this revision. The README and implementation status explicitly list them as absent. Their product vocabulary is still valuable:

- a room becomes a product testing space;
- a thread becomes one mission’s clarification/dispute discussion;
- Needs You becomes a derived action inbox for review, clarification, dispute, and expiring-claim actions;
- activity becomes an append-only domain event feed;
- agent approval becomes an explicit, read-only planning run created only after feedback is accepted.

### Do not reuse

- The single hard-coded `vibecodingtribe.com/r/general` key cannot model product ownership or authorization.
- Chat-first navigation and the agent-invite marketing page make conversation the primary job; the exchange must lead with missions and pending actions.
- Browser-provided identities are not accepted for mission ownership, credits, or chat posting.
- The bounded 200-message history is not an accounting store. Credit state needs append-only, authoritative server persistence and idempotent commands.

## 2. Proposed data model

Identifiers are opaque strings. Every mutable aggregate includes `createdAt`, `updatedAt`, and a version for optimistic concurrency. Production commands include an idempotency key.

### Identity and profile

- `User`: `id`, `status`, timestamps. Internal identity, independent of provider.
- `AuthIdentity`: `userId`, `provider` (`linkedin | github`), `providerSubject`, optional verified email, avatar, provider profile URL. Unique on provider + subject.
- `BuilderProfile`: `userId`, display name, headline, bio, GitHub URL, website URL, skills, testing devices, timezone.
- `ReputationSnapshot`: derived counts for requester missions completed, acceptance rate, median review time, tester submissions accepted, disputes, and completion rate. Display counts and confidence bands before introducing a composite score.

### Product and work

- `ProductSpace`: `id`, `ownerId`, name, URL, description, platforms, access instructions, room key, status.
- `Mission`: `id`, `productId`, `requesterId`, title, scenario, acceptance criteria, required devices/skills, reward credits, platform fee credits, claim duration, status.
- `Claim`: `id`, `missionId`, `testerId`, status, claimed/expires/submitted timestamps. One active claim per mission; enforce a configurable per-tester active limit.
- `Feedback`: `id`, `claimId`, summary, steps taken, expected result, actual result, severity, recommendation, submitted timestamp, review status.
- `FeedbackAsset`: `id`, `feedbackId`, media type, object-store key, content type, size, checksum. Use signed upload URLs; never embed large media in mission records.
- `DiscussionThread` and `ThreadMessage`: attached to a mission, feedback, or dispute; participants are authorized from the parent object.
- `Dispute`: `id`, `feedbackId`, openedById`, reason, status, assignedAdminId, resolution, resolvedAt`.
- `DevelopmentTask`: `id`, `feedbackId`, title, description, priority, evidence, status, source agent run.

### Credits, attention, and agent activity

- `CreditAccount`: one per user plus system escrow, grant, and sink accounts.
- `CreditTransaction`: immutable header with type, reference, idempotency key, actor, timestamp, and metadata.
- `CreditPosting`: immutable debit/credit lines. Postings within a transaction sum to zero. Balance is the sum of postings, not an editable field.
- `ActionItem`: the Needs You projection with owner, kind, resource, due time, read/dismissed time, and resolution.
- `DomainEvent`: append-only activity record emitted after a successful command.
- `AgentConnection`: user-owned provider configuration and capability declarations; secrets remain server-side.
- `AgentRun`: provider, capability, accepted feedback IDs, prompt-policy version, status, request/response hashes, timestamps.
- `AgentArtifact`: typed `feedback_summary | task_set | priority_suggestion` JSON validated against a versioned schema.
- `AdminSetting`: versioned values for starter grant, mission cost, tester reward, platform sink, active-claim limit, and claim duration.

## 3. Mission and credit lifecycle

Default settings are a 10-credit starter grant, 10-credit mission cost, 8-credit tester reward, 2-credit platform sink, one active claim per tester, and a 48-hour claim expiry.

1. On first account creation, post `grant account -10 / user account +10`. The unique reference `starter-grant:{userId}` makes it idempotent.
2. A requester creates a draft product and mission. Publish validates the owner, prevents insufficient funds, and atomically posts `requester -10 / escrow +10` before making the mission discoverable.
3. Claim validates that the tester does not own the product, has not exceeded the active-claim limit, and that no active claim exists. It records an expiry time.
4. The tester submits all required structured feedback. The mission becomes `in_review` and Needs You creates a requester review action.
5. `clarify` returns the claim to the tester, appends a thread message, and extends the deadline. `reject` records a reason and opens a tester dispute window; it does not silently return escrow. `dispute` freezes settlement for admin review.
6. `accept` is an atomic, idempotent settlement: `escrow -10 / tester +8 / platform sink +2`. It closes the claim and mission, resolves the review action, and updates derived reputation.
7. Admin dispute resolution either applies the same award split or posts `escrow -10 / requester +10`. Every adjustment references the dispute and records the admin actor.
8. Expired claims return the mission to discovery without moving escrow. Cancelling an unclaimed mission refunds escrow; a claimed mission must first expire or be resolved.
9. Only accepted feedback may be sent to the agent boundary. Generated tasks retain the feedback ID and exact evidence fields for traceability.

## 4. LinkedIn authentication plan

The existing implementation already uses LinkedIn OpenID Connect authorization code flow with `openid profile`, exchanges the code server-side, reads `/v2/userinfo`, and stores only a signed first-party session—not the provider access token. Keep that as the primary sign-in path.

Before production launch:

- map `(provider, subject)` to a durable internal `User` instead of embedding the provider identity as the user record;
- add OAuth nonce validation for LinkedIn in addition to the current state cookie;
- keep exact redirect URI allowlisting, short-lived attempts, server-side secret storage, and no-store responses;
- request email only if onboarding truly needs it and LinkedIn approval permits it;
- add account linking so a user may attach both LinkedIn and GitHub without receiving a second starter grant;
- use GitHub OAuth as the supported fallback and as the natural source for the optional GitHub profile field;
- provide explicit auth-unavailable and provider-cancelled recovery states; never fall back to anonymous credit-bearing accounts.

## 5. Bring Your Own Agent boundary

Define a server-owned adapter interface with three allowlisted operations:

```ts
interface PlanningAgentAdapter {
  summarize(input: AcceptedFeedbackInput): Promise<FeedbackSummaryArtifact>
  createTasks(input: AcceptedFeedbackInput): Promise<TaskSetArtifact>
  prioritize(input: AcceptedFeedbackInput & { tasks: DevelopmentTask[] }): Promise<PrioritySuggestionArtifact>
}
```

Codex, Claude Code, OpenCode, Pi, DotAgents, and future providers implement this interface through adapters. The core exchange never sends a repository token, filesystem path, shell capability, or write tool. Input is a normalized snapshot of explicitly selected accepted feedback plus product context. Output is schema-validated JSON, stored as an artifact, and shown for human review.

Enforcement belongs in three places:

- capability policy: only `feedback:read_accepted`, `artifacts:create`, and `tasks:suggest` are granted;
- transport policy: outbound provider calls receive no repository credentials and cannot call exchange mutation commands;
- product policy: an agent run requires a human click, records provider/model/policy version, and produces drafts only. Exporting or implementing a task is a separate future human action.

The first server-backed slice uses a deterministic planning adapter inside the Worker so the boundary and output schema can be exercised without pretending an external agent was contacted. A production provider adapter replaces it behind the same interface.

## 6. Smallest end-to-end implementation plan

Completed:

1. Added a framework-independent exchange domain with mission/claim/feedback transitions, double-entry credit postings, derived Needs You actions, raw reputation signals, and a deterministic planning adapter.
2. Added the exchange interface: product and mission creation, claim, structured feedback, requester acceptance, balances/ledger, Needs You, and generated task artifacts. Tribe Chat remains secondary at `/r/general`.
3. Moved every authoritative command behind `/api/exchange`, a signed-session actor boundary, and transactional `ExchangeStore` Durable Object persistence. Browser persistence was removed from the authority path.
4. Added idempotent mutations, server-enforced ownership and claim constraints, API projections, lazy claim expiry, and OAuth-only actors.
5. Added domain, storage, route, client, and rendered-flow tests. Typecheck, Worker typecheck, lint, tests, build, and a live browser-to-Worker flow pass.

Next production tranche:

1. Replace provider-derived user IDs with durable internal users and account linking; add LinkedIn nonce validation and session revocation.
2. Implement reject, clarify, dispute, admin resolution, cancellation/refund, and the corresponding append-only audit events.
3. Add direct-to-R2 signed evidence upload with content limits, checksum validation, malware handling, and retention policy.
4. Add Durable Object alarms or scheduled processing for proactive expiry plus Needs You notifications.
5. Add editable profiles, multi-mission discovery, pagination, search, and product-scoped clarification threads.
6. Add rate limits, abuse/moderation tooling, operational metrics and alerts, backup/restore drills, and load tests.
7. Split the global aggregate into mission/account shards or a normalized D1 model before volume makes one Durable Object a bottleneck.
