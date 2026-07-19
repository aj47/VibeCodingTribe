# VibeCodingTribe MVP

A runnable, chat-first vertical slice of the VibeCodingTribe PRD: an attention-managed developer room where humans, GitHub events, and coding agents share persistent repository context.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The seeded workspace opens directly so the core product can be evaluated immediately. Use **Profile → Sign out** to exercise GitHub sign-in and the three-step onboarding flow.

The production preview is deployed to [vibecodingtribe.pages.dev](https://vibecodingtribe.pages.dev) with Cloudflare Pages. An authenticated Wrangler session can rebuild and deploy the current checkout with:

```bash
npm run deploy:cloudflare
```

The command targets the `vibecodingtribe` Pages project and its `main` production branch. Local Cloudflare credentials and development variables are ignored by Git.

Quality commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Implemented in this slice

- Five-section attention rail: Needs You, Active, Waiting, Repositories, and DMs
- Transparent attention reasons, handled state, unread state, active-agent beacons, and persisted room switching
- Virtualized Matrix-shaped timeline with human messages, code, reactions, agent work, tool logs, artifacts, GitHub events, and system events
- Return Brief at the last-read boundary with decision, agent, GitHub, request, and blocker sources
- Thread pane with a separate persisted draft
- First-class agent states, scoped run permissions, continuous-listening control, stop/detach actions, and activity log
- Repository-write approval with exact tool, scope, consequence, risk, audit details, allow-once, and deny paths
- Deterministic local agent streaming and a gated mock GitHub branch-write result
- Fast local echo, retry state, file attachment affordance, mentions, reactions, and per-room drafts
- Room search, global quick switcher, URL-backed room/thread/panel location, and keyboard shortcuts
- GitHub sign-in presentation, guided onboarding, repository connection, profile, and safety defaults
- Desktop, tablet, and narrow responsive layouts with mobile drawer navigation

Useful shortcuts:

| Shortcut | Action |
| --- | --- |
| `⌘/Ctrl K` | Quick switcher |
| `⌘/Ctrl F` | Search current room |
| `g`, then `n` | Next Needs You item |
| `g`, then `a` | Next Active item |
| `g`, then `r` | Open current repository |
| `c` | Focus composer |
| `a` | Open agent actions |
| `h` | Mark current item handled |
| `⌘/Ctrl .` | Stop foreground agent |

## Architecture

The UI consumes normalized product records from [`src/domain/types.ts`](src/domain/types.ts), never Matrix room objects or raw GitHub payloads. [`src/services/adapters.ts`](src/services/adapters.ts) defines the transport seams for Matrix, GitHub, and agent orchestration and ships deterministic in-browser implementations for this vertical slice.

```text
React product UI
  ├── MatrixAdapter  → rooms, messages, typing, read state, search
  ├── GitHubAdapter  → repositories, events, checks, approved writes
  └── AgentAdapter   → sessions, streams, approvals, activity
```

Production wiring can replace each mock independently while preserving the attention, conversation, approval, and agent view models. The local workspace persists in `localStorage` so drafts, approvals, agent state, handled items, and selected context survive reloads.

## Honest MVP boundary

This repository implements the complete interactive client slice and backend contracts, not deployed infrastructure. Production still requires GitHub OAuth/App credentials and callbacks, a Matrix/Synapse deployment and provisioning service, PostgreSQL/Redis/object storage, webhook ingestion, a sandboxed agent runtime, secrets management, and server-side audit/authorization enforcement. See [`docs/implementation-status.md`](docs/implementation-status.md) for the handoff map.
