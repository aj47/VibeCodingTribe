# MVP implementation status

This build proves the PRD's three product claims with one deployed realtime room:

1. Chat is the primary, fast interaction surface.
2. The attention rail points users back to actionable work.
3. Agents participate visibly in shared repository context with explicit permissions.

## Working end to end

- Room switching with cached state, local echo, drafts, reactions, search, code, artifacts, threads, and virtualized rendering
- Rules-based attention ranking and reason labels across all five required sections
- Return-summary display, source jumps, dismissal, regeneration, and handled state
- Agent invoke → working → streaming → completed state machine
- Continuous-listening indicator and session permission display
- Approval request → allow once/deny → agent state transition → scoped mock GitHub write → result/audit trail
- GitHub PR/check event cards and repository context
- Sign-in, onboarding, repository selection, and agent-default setup presentation
- Responsive navigation/details/thread behavior and keyboard navigation
- Browser persistence for the selected room, messages, drafts, attention, approvals, agents, summaries, and audit state
- Cross-browser WebSocket chat for `aj47/VibeCodingTribe#general`, including local echo, reconnecting outbox, deduplication, live presence, and durable history
- Cloudflare Pages frontend plus a Cloudflare Worker and SQLite-backed Durable Object room

## Ready behind an adapter; requires production service wiring

| PRD area | Client/contract present | Production work |
| --- | --- | --- |
| Realtime chat | One deployed Durable Object room, shared protocol, reconnecting client | Authenticated membership, moderation, multi-room routing, realtime threads/reactions/typing, media |
| Matrix migration | `MatrixAdapter`, normalized events, UI states | Optional Synapse deployment, authentication/provisioning, sync, E2EE decision |
| GitHub identity | Sign-in/onboarding UI and repository model | OAuth callback, GitHub App installation, encrypted token storage |
| GitHub activity | Event/check models and cards | Webhook receiver, signature verification, replay/idempotency, rate limits |
| GitHub writes | Scoped approval enforcement in adapter | Server-side authorization, branch/comment API calls, immutable audit |
| Agent runtime | Session/stream/stop/approval contract | Provider credentials, sandbox, MCP connections, queues, stream gateway |
| Attention engine | Transparent client ranking and persistence | Per-user server ranking, realtime recomputation, mute/snooze/order APIs |
| Return summaries | Structured summary contract and states | Grounded model call, privacy/retention policy, source-event validation |
| Storage | Durable room history plus browser workspace persistence | Account/profile storage, object storage, retention policy, exports and backups |

## Recommended next implementation sequence

1. Add GitHub OAuth/App installation and require an authenticated repository member before joining the room.
2. Add Cloudflare webhook ingestion for real pull request, check, issue, and push events from `aj47/VibeCodingTribe`.
3. Move profiles, attention, visit state, permissions, approvals, and audit records to server-side storage.
4. Add the agent orchestration service with WebSocket streaming and a repository-read MCP tool.
5. Enable one server-enforced GitHub comment or branch action behind the existing approval record.
6. Add moderation/retention controls and integration/load suites for reconnects, history, and message bursts before adding more rooms.
