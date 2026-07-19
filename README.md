# VibeCodingTribe MVP

A runnable, chat-first vertical slice of the VibeCodingTribe PRD: an attention-managed developer room where humans, GitHub events, and coding agents share persistent repository context.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The seeded workspace opens directly so the core product can be evaluated immediately. Use **Profile → Sign out** to exercise GitHub sign-in and the three-step onboarding flow.

Run the one-room realtime backend in a second terminal:

```bash
npm run dev:realtime
```

The local client connects to `localhost:8787`; the production client connects to the deployed Cloudflare Worker.

The production preview is deployed to [vibecodingtribe.pages.dev](https://vibecodingtribe.pages.dev) with Cloudflare Pages. An authenticated Wrangler session can rebuild and deploy the current checkout with:

```bash
npm run deploy:cloudflare
npm run deploy:realtime
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
- Durable realtime messages, reconnecting outbox, browser identity, live presence, and persisted history for `aj47/VibeCodingTribe#general`
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

The UI consumes normalized product records from [`src/domain/types.ts`](src/domain/types.ts), never raw transport objects or GitHub payloads. [`src/services/adapters.ts`](src/services/adapters.ts) defines the broader Matrix, GitHub, and agent seams. The launch room uses a dedicated realtime client and protocol shared with the Worker.

```text
React product UI on Cloudflare Pages
  ├── RealtimeRoomClient ── WebSocket ── Cloudflare Worker
  │                                      └── Durable Object (one room)
  │                                          ├── live sockets/presence
  │                                          └── persisted message history
  ├── GitHubAdapter  → seeded events, checks, approved-write contract
  └── AgentAdapter   → deterministic sessions, streams, approvals, activity
```

The realtime room is pinned to `aj47/VibeCodingTribe#general`. Messages use optimistic local echo, are queued across disconnects, deduplicated by client message ID, broadcast over WebSockets, and replayed from the room's durable history. The rest of the workspace persists in `localStorage` so drafts, approvals, agent state, handled items, and selected context survive reloads.

## Honest MVP boundary

This is a deployable one-room MVP, not yet a multi-tenant production system. Live chat currently uses a browser-generated guest identity; GitHub OAuth/App installation, authenticated membership, webhook ingestion, realtime reactions/typing/threads, media storage, a sandboxed agent runtime, secrets management, moderation, and server-side audit/authorization enforcement remain launch work. Other rooms and GitHub/agent events are product-demo data. See [`docs/implementation-status.md`](docs/implementation-status.md) for the handoff map.
