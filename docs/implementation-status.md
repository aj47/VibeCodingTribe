# MVP implementation status

This build proves the PRD's three product claims locally:

1. Chat is the primary, fast interaction surface.
2. The attention rail points users back to actionable work.
3. Agents participate visibly in shared repository context with explicit permissions.

## Working end to end in the local slice

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

## Ready behind an adapter; requires production service wiring

| PRD area | Client/contract present | Production work |
| --- | --- | --- |
| Matrix chat | `MatrixAdapter`, normalized events, UI states | Synapse, authentication/provisioning, sync, E2EE decision, media |
| GitHub identity | Sign-in/onboarding UI and repository model | OAuth callback, GitHub App installation, encrypted token storage |
| GitHub activity | Event/check models and cards | Webhook receiver, signature verification, replay/idempotency, rate limits |
| GitHub writes | Scoped approval enforcement in adapter | Server-side authorization, branch/comment API calls, immutable audit |
| Agent runtime | Session/stream/stop/approval contract | Provider credentials, sandbox, MCP connections, queues, stream gateway |
| Attention engine | Transparent client ranking and persistence | Per-user server ranking, realtime recomputation, mute/snooze/order APIs |
| Return summaries | Structured summary contract and states | Grounded model call, privacy/retention policy, source-event validation |
| Storage | Browser persistence | PostgreSQL, Redis, object storage, migrations and backups |

## Recommended next implementation sequence

1. Stand up the API service and GitHub OAuth/App flow.
2. Connect a Synapse homeserver through the `MatrixAdapter` and provision GitHub-linked identities.
3. Move attention, visit state, permissions, approvals, and audit records to PostgreSQL.
4. Add the agent orchestration service with SSE/WebSocket streaming and repository-read MCP tool.
5. Enable one server-enforced GitHub comment or branch action behind the existing approval record.
6. Add integration/load suites for 5,000 timeline events, 100 sidebar rooms, 10 concurrent streams, reconnects, and bursts.
