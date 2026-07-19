/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'

export type DocGroup = 'Start here' | 'Product' | 'Build' | 'Operate' | 'Reference'

export interface DocSection {
  id: string
  title: string
  body: ReactNode
}

export interface DocPage {
  slug: string
  group: DocGroup
  eyebrow: string
  title: string
  summary: string
  readingTime: string
  searchText: string
  sections: DocSection[]
}

export function CodeBlock({ children, label = 'shell' }: { children: string | string[]; label?: string }) {
  const code = Array.isArray(children) ? children.join('') : children
  return (
    <div className="code-block" data-code={code}>
      <div className="code-block__bar"><span>{label}</span><button type="button" data-copy-code>Copy</button></div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

export function Callout({ tone = 'note', title, children }: { tone?: 'note' | 'warning' | 'success'; title: string; children: ReactNode }) {
  return <aside className={`callout callout--${tone}`}><strong>{title}</strong><div>{children}</div></aside>
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="steps">{children}</ol>
}

export function ArchitectureDiagram() {
  return (
    <div className="architecture-diagram" role="img" aria-label="VibeCodingTribe one-room MVP architecture">
      <div className="architecture-node architecture-node--client"><span>01</span><strong>React client</strong><small>Cloudflare Pages</small></div>
      <div className="architecture-link"><span>WebSocket</span></div>
      <div className="architecture-node architecture-node--edge"><span>02</span><strong>Realtime Worker</strong><small>origin + protocol boundary</small></div>
      <div className="architecture-link"><span>binding</span></div>
      <div className="architecture-node architecture-node--room"><span>03</span><strong>Durable Object</strong><small>one named room</small></div>
      <div className="architecture-store"><strong>SQLite-backed storage</strong><small>last 200 accepted messages</small></div>
    </div>
  )
}

const overview: DocPage = {
  slug: '',
  group: 'Start here',
  eyebrow: 'Documentation / 2026.07',
  title: 'One room. Shared context. Humans and agents in the same loop.',
  summary: 'The practical guide to the VibeCodingTribe MVP: what it proves, how the realtime room works, and what remains before a public launch.',
  readingTime: '6 min overview',
  searchText: 'overview introduction one room shared context humans agents mvp current status documentation',
  sections: [
    {
      id: 'what-is-vct',
      title: 'What VibeCodingTribe is',
      body: <>
        <p>VibeCodingTribe is agent-native developer chat organized around a GitHub repository. It combines the immediacy of a chat room with repository context, visible coding-agent state, explicit approvals, and an attention system built around work—not a static list of channels.</p>
        <p>The current vertical slice is deliberately narrow: one public room, <code>aj47/VibeCodingTribe#general</code>, with real cross-browser messaging on Cloudflare. The surrounding product surfaces demonstrate the larger model without pretending the entire backend already exists.</p>
        <Callout title="The wedge"><p>High-performance chat for vibe coders where humans and coding agents participate in the same persistent context.</p></Callout>
      </>,
    },
    {
      id: 'three-claims',
      title: 'The three claims this MVP tests',
      body: <div className="claim-list">
        <article><span>01</span><h3>Chat is the product</h3><p>Sending and receiving must feel immediate. Project management is context around the conversation, not the primary canvas.</p></article>
        <article><span>02</span><h3>Attention can be managed</h3><p>Needs You, Active, and Waiting should return a developer to the right work faster than unread counts alone.</p></article>
        <article><span>03</span><h3>Agents belong in the room</h3><p>An agent needs identity, status, permissions, history, and a visible relationship to human participants.</p></article>
      </div>,
    },
    {
      id: 'current-slice',
      title: 'What is live today',
      body: <>
        <ul className="check-list">
          <li>Cross-browser WebSocket messaging with optimistic local echo</li>
          <li>Durable room history and client-message deduplication</li>
          <li>Reconnect with a browser-persisted outbox</li>
          <li>Live connection count and editable guest identity</li>
          <li>Virtualized, repository-shaped conversation timeline</li>
          <li>Attention rail, return brief, agent states, approvals, and audit presentation</li>
          <li>Cloudflare Pages frontend and SQLite-backed Durable Object room</li>
        </ul>
        <Callout tone="warning" title="Honest boundary"><p>Guest identity is not authentication. GitHub membership, webhooks, agent execution, media, moderation, and server-enforced authorization remain launch work. Demo GitHub and agent events are clearly product fixtures.</p></Callout>
      </>,
    },
    {
      id: 'choose-path',
      title: 'Choose your path',
      body: <div className="path-grid">
        <a href="/quickstart" data-doc-link><strong>Run it locally</strong><span>Install, start both surfaces, and send your first message.</span></a>
        <a href="/architecture" data-doc-link><strong>Understand the system</strong><span>Trace a message from browser to durable history.</span></a>
        <a href="/launch-status" data-doc-link><strong>Prepare the launch</strong><span>See the exact gap between this MVP and public access.</span></a>
      </div>,
    },
  ],
}

const quickstart: DocPage = {
  slug: 'quickstart', group: 'Start here', eyebrow: 'Start here', title: 'Run the complete MVP locally',
  summary: 'Start the product UI and the realtime Worker, then validate the same one-room path used in production.', readingTime: '8 min',
  searchText: 'quickstart install npm node wrangler local development dev realtime localhost setup clone',
  sections: [
    { id: 'prerequisites', title: 'Prerequisites', body: <>
      <ul><li>Node.js 20.19 or newer</li><li>npm</li><li>A modern browser with WebSocket support</li><li>Wrangler authentication only if you intend to deploy</li></ul>
      <CodeBlock label="check versions">node --version{`\n`}npm --version{`\n`}npx wrangler whoami</CodeBlock>
    </> },
    { id: 'install', title: 'Install and start both processes', body: <>
      <Steps>
        <li><strong>Install dependencies</strong><CodeBlock>npm install</CodeBlock></li>
        <li><strong>Start the React client</strong><CodeBlock>npm run dev</CodeBlock><p>The client listens on <code>http://localhost:4173</code>.</p></li>
        <li><strong>Start the realtime Worker</strong><CodeBlock>npm run dev:realtime</CodeBlock><p>Wrangler listens on <code>http://localhost:8787</code>. The client selects this origin automatically on localhost.</p></li>
      </Steps>
    </> },
    { id: 'first-message', title: 'Send the first realtime message', body: <>
      <ol><li>Open <a href="http://localhost:4173">localhost:4173</a> in two browser tabs.</li><li>Confirm the header reports at least two live connections.</li><li>Select the live identity chip to set a distinct display name.</li><li>Send a uniquely identifiable message from one tab.</li><li>Confirm it appears in the other tab, then reload and confirm history returns.</li></ol>
      <Callout tone="success" title="Expected result"><p>The message appears immediately in the sending tab, arrives in the second client over WebSocket, and is replayed after reload from Durable Object storage.</p></Callout>
    </> },
    { id: 'quality', title: 'Run the quality gate', body: <>
      <CodeBlock label="validation">npm run typecheck{`\n`}npx tsc -p tsconfig.worker.json{`\n`}npm run lint{`\n`}npm test -- --run{`\n`}npm run build{`\n`}npm run build:docs{`\n`}npm audit --audit-level=high</CodeBlock>
      <p>The app and Worker have separate TypeScript targets because the Worker uses Cloudflare runtime types while the browser client uses DOM types.</p>
    </> },
  ],
}

const productModel: DocPage = {
  slug: 'product-model', group: 'Product', eyebrow: 'Product model', title: 'Repository context is the organizing unit',
  summary: 'Learn the core entities, how repository communities map to conversations, and where agents fit.', readingTime: '10 min',
  searchText: 'product model repository conversation participant agent thread room github community entities concepts',
  sections: [
    { id: 'repository-community', title: 'Repository community', body: <><p>A repository community is the shared boundary for identity, permissions, code context, GitHub events, and conversation. In the launch slice, one repository maps to one public <code>#general</code> room.</p><p>The longer-term model can contain topic rooms, standalone threads, issue-linked discussions, pull-request discussions, and direct messages. That expansion should not leak transport-specific terms into the product model.</p></> },
    { id: 'domain-records', title: 'Core domain records', body: <div className="definition-table">
      <div><code>Conversation</code><p>A room, thread, or DM with repository context, unread state, participants, agents, and attention metadata.</p></div>
      <div><code>Participant</code><p>A human, agent, GitHub integration, or system identity rendered consistently in the timeline.</p></div>
      <div><code>AgentSession</code><p>An attached runtime with state, provider, permissions, current task, and activity history.</p></div>
      <div><code>AttentionItem</code><p>A user-specific reason to return to a conversation, grouped by actionability.</p></div>
      <div><code>ApprovalRequest</code><p>An explicit tool, scope, consequence, risk, and one-time decision bound to an agent action.</p></div>
      <div><code>ReturnSummary</code><p>A structured catch-up brief grounded in decisions, blockers, requests, GitHub events, and agent outcomes.</p></div>
    </div> },
    { id: 'transport-boundary', title: 'Transport stays behind the model', body: <><p>React components consume normalized product records. They do not render Durable Object storage records, Matrix room objects, or raw GitHub webhook payloads directly. Adapters translate external systems into stable view models.</p><CodeBlock label="typescript">{`type Conversation = {\n  id: string\n  type: 'room' | 'thread' | 'dm'\n  title: string\n  repository?: RepositoryReference\n  unreadCount: number\n  attentionReason?: string\n  agents: AgentSession[]\n  participants: Participant[]\n}`}</CodeBlock></> },
    { id: 'identity-today', title: 'Identity today and tomorrow', body: <><p>The realtime room currently creates a stable random client ID in browser storage and lets the visitor edit a display name and handle. That is sufficient for multi-client product validation, but not for trust.</p><p>The launch identity path is GitHub OAuth → GitHub App installation or membership lookup → server-issued session → authenticated room connection. The visible profile should continue to use the GitHub avatar and handle by default.</p></> },
  ],
}

const realtimeChat: DocPage = {
  slug: 'realtime-chat', group: 'Product', eyebrow: 'Product guide', title: 'Realtime chat behavior',
  summary: 'How local echo, durable history, reconnect, presence, and the one-room constraint behave from a user’s perspective.', readingTime: '9 min',
  searchText: 'realtime chat message local echo outbox retry reconnect history presence identity websocket delivery',
  sections: [
    { id: 'message-lifecycle', title: 'Message lifecycle', body: <Steps>
      <li><strong>Compose</strong><p>The client validates non-empty text and creates an ID containing the browser client ID plus time and entropy.</p></li>
      <li><strong>Echo</strong><p>A pending human message is inserted into the normalized timeline immediately.</p></li>
      <li><strong>Queue</strong><p>The outbound event is written to a local outbox before transmission.</p></li>
      <li><strong>Accept</strong><p>The room validates the payload, deduplicates by message ID, assigns server time, and persists it.</p></li>
      <li><strong>Broadcast</strong><p>Every connected socket receives the canonical message record. The sender’s pending record is replaced by the accepted record.</p></li>
    </Steps> },
    { id: 'reconnect', title: 'Reconnect and offline outbox', body: <><p>Unexpected disconnects trigger bounded exponential backoff. The outbox remains in browser storage across reloads. When the socket opens, queued messages are sent in insertion order; accepted IDs are removed only after a canonical message event returns.</p><Callout title="Delivery semantics"><p>The MVP provides at-least-once client transmission with server-side ID deduplication. It does not claim globally ordered multi-region delivery.</p></Callout></> },
    { id: 'history', title: 'Durable history', body: <><p>The room stores the most recent 200 accepted messages under one Durable Object storage key. A connecting client receives a snapshot before subsequent message and presence events.</p><p>This bounded history is appropriate for the launch experiment. Before broader use, define retention, export, deletion, moderation, backup, and pagination policies.</p></> },
    { id: 'presence', title: 'Presence and identity', body: <><p>Presence is connection-scoped. The header reports the live socket count, while the participant list deduplicates profiles by stable client ID. Changing identity reconnects the browser with a new serialized socket attachment.</p><p>A browser crash or network transition may make presence briefly stale until the runtime removes the socket and emits the next presence broadcast.</p></> },
    { id: 'limits', title: 'Current limits', body: <table><thead><tr><th>Capability</th><th>MVP behavior</th></tr></thead><tbody><tr><td>Room</td><td><code>aj47/VibeCodingTribe#general</code> only</td></tr><tr><td>Message size</td><td>4,000 trimmed characters</td></tr><tr><td>History</td><td>Last 200 accepted messages</td></tr><tr><td>Binary frames</td><td>Rejected</td></tr><tr><td>Attachments</td><td>UI affordance only; no object storage</td></tr><tr><td>Editing/deletion</td><td>Not realtime yet</td></tr></tbody></table> },
  ],
}

const attentionSystem: DocPage = {
  slug: 'attention-system', group: 'Product', eyebrow: 'Product guide', title: 'The attention system',
  summary: 'Why the sidebar is organized around actionable work and how each section should earn a user’s trust.', readingTime: '10 min',
  searchText: 'attention sidebar needs you active waiting repositories direct messages ranking reason handled snooze mute',
  sections: [
    { id: 'why', title: 'Unread is not the same as important', body: <><p>Traditional chat navigation optimizes for room hierarchy and unread volume. VibeCodingTribe instead asks: <em>what changed, who is waiting, and what requires a decision?</em></p><p>Every prioritized item must carry a plain-language reason. A ranking that cannot explain itself becomes noise.</p></> },
    { id: 'sections', title: 'Required sections', body: <div className="attention-map">
      <article><span className="status status--danger">Needs You</span><p>Mentions, review requests, approvals, direct questions, failed checks, blockers, and assigned work.</p></article>
      <article><span className="status status--active">Active</span><p>Rooms with foreground agent work, recent focused participation, or currently running tasks.</p></article>
      <article><span className="status status--warning">Waiting</span><p>Work blocked on another participant, external event, benchmark, review, or agent result.</p></article>
      <article><span className="status">Repositories</span><p>The stable repository/community hierarchy and room entry points.</p></article>
      <article><span className="status">Direct Messages</span><p>Person-to-person conversations outside the repository room hierarchy.</p></article>
    </div> },
    { id: 'ranking', title: 'Initial transparent ranking', body: <><p>Start with explicit rules rather than an opaque model. A useful scoring pass can combine hard blockers, mentions, requested approvals, active agents, recency, muted state, and user pins. Display the strongest contributing reason beside the item.</p><CodeBlock label="ranking sketch">{`score =\n  blocker * 100 +\n  approvalRequested * 80 +\n  directMention * 60 +\n  activeAgent * 35 +\n  recentActivity * 10 -\n  muted * 1000`}</CodeBlock></> },
    { id: 'controls', title: 'User control and measurement', body: <><ul><li>Mark handled without deleting history</li><li>Pin durable priorities</li><li>Mute or snooze noisy sources</li><li>Jump by keyboard between actionable items</li><li>Show why each item is ranked</li></ul><p>Measure whether users follow suggestions, dismiss them, or repeatedly navigate around the system. Ranking utility—not sidebar engagement—is the goal.</p></> },
  ],
}

const agents: DocPage = {
  slug: 'agents-and-approvals', group: 'Product', eyebrow: 'Product guide', title: 'Agents, tools, and approvals',
  summary: 'The first-class agent model, visible state machine, continuous listening, and explicit risk boundary.', readingTime: '12 min',
  searchText: 'agents approvals permissions tools mcp continuous listening state streaming blocked stop detach audit risk github write',
  sections: [
    { id: 'first-class', title: 'A participant, not a webhook', body: <><p>An agent appears in participant lists and messages with a stable name, provider, runtime, owner, status, and task. Progress events are visually compact; final output reads like a message. Tool logs and artifacts can expand without overwhelming human conversation.</p></> },
    { id: 'state-machine', title: 'Visible state machine', body: <div className="state-sequence"><span>idle</span><i>→</i><span>listening</span><i>→</i><span>working</span><i>→</i><span>waiting</span><i>→</i><span>complete</span><em>blocked and failed can branch from active work</em></div> },
    { id: 'permissions', title: 'Permission dimensions', body: <><div className="definition-table"><div><code>Context</code><p>Room, thread, repository, issue, pull request, or selected files.</p></div><div><code>Tools</code><p>Repository read, test execution, branch creation, comments, issue updates, or deployment.</p></div><div><code>Duration</code><p>Once, for this task, for this session, or continuous listening.</p></div><div><code>Scope</code><p>Exact repository, branch, environment, and allowed side effect.</p></div></div><Callout tone="warning" title="Default policy"><p>Read-only context can be low-friction. Repository writes, secrets, deployments, and destructive tools require explicit, auditable approval.</p></Callout></> },
    { id: 'approval-record', title: 'What an approval must show', body: <><ul className="check-list"><li>The exact tool or capability</li><li>The repository, branch, and resource scope</li><li>The human-readable consequence</li><li>A risk label that is not color-only</li><li>Whether approval is one-time or persistent</li><li>The resulting audit event and revocation path</li></ul><p>The current UI demonstrates allow-once and deny paths around a branch-write request. The action remains mocked until server-side identity and authorization exist.</p></> },
    { id: 'continuous-listening', title: 'Continuous listening', body: <><p>Continuous listening is a visible session capability, not a hidden background default. The room details panel shows the active agent, current task, context permissions, tools, and a persistent stop/detach control.</p><p>Before launch, add time limits, cost budgets, organization policy, revocation on membership change, and a clear record of which events the agent observed.</p></> },
  ],
}

const architecture: DocPage = {
  slug: 'architecture', group: 'Build', eyebrow: 'System design', title: 'One-room Cloudflare architecture',
  summary: 'Trace the deployed vertical slice and understand which seams are intentionally ready for later services.', readingTime: '11 min',
  searchText: 'architecture cloudflare pages worker durable object sqlite react vite websocket adapters data flow',
  sections: [
    { id: 'diagram', title: 'Deployed path', body: <><ArchitectureDiagram/><p>A static React application on Cloudflare Pages opens a WebSocket to a standalone Worker. The Worker resolves one deterministic Durable Object name, which owns connection state and message history for the room.</p></> },
    { id: 'client', title: 'React product client', body: <><p>The client owns interaction state, normalized records, virtualized rendering, optimistic messages, reconnect policy, and the browser outbox. It chooses the local Worker at <code>localhost:8787</code> during development and the public Worker in production.</p><p>Broader Matrix, GitHub, and agent behavior sits behind adapter contracts so the UI is not coupled to one infrastructure choice.</p></> },
    { id: 'edge', title: 'Realtime Worker boundary', body: <><p>The Worker exposes two routes:</p><table><thead><tr><th>Route</th><th>Purpose</th></tr></thead><tbody><tr><td><code>GET /health</code></td><td>Returns room and transport status.</td></tr><tr><td><code>GET /api/realtime</code></td><td>Validates origin and profile, then upgrades to WebSocket.</td></tr></tbody></table><p>Production Pages and preview subdomains are allowed. Local origins are supplied through Wrangler configuration.</p></> },
    { id: 'room', title: 'Durable Object room', body: <><p>The object is resolved by the exact name <code>aj47/VibeCodingTribe#general</code>. One object serializes access to that room’s history, accepts hibernatable sockets, stores identity as a socket attachment, and broadcasts presence and messages.</p><Callout title="Why a Durable Object"><p>The room needs a single coordination point for WebSockets and durable state. That maps naturally to a named object without introducing a separate database and pub/sub system for the MVP.</p></Callout></> },
    { id: 'future-services', title: 'Service seams after validation', body: <div className="future-services"><article><strong>Identity API</strong><p>GitHub OAuth, sessions, memberships, profiles.</p></article><article><strong>Webhook service</strong><p>Signatures, replay protection, GitHub event normalization.</p></article><article><strong>Agent orchestrator</strong><p>Provider runtime, sandbox, streams, MCP, approvals.</p></article><article><strong>Attention engine</strong><p>Per-user ranking, mute, snooze, visit and summary state.</p></article><article><strong>Object storage</strong><p>Media, agent artifacts, retention and scanning.</p></article><article><strong>Audit store</strong><p>Immutable authorization and side-effect records.</p></article></div> },
  ],
}

const protocol: DocPage = {
  slug: 'realtime-protocol', group: 'Build', eyebrow: 'Protocol reference', title: 'Realtime WebSocket protocol',
  summary: 'Connection parameters, event envelopes, validation, errors, and delivery semantics for the launch room.', readingTime: '12 min',
  searchText: 'websocket protocol snapshot message presence error send json client server event schema validation connection url',
  sections: [
    { id: 'connect', title: 'Connect', body: <><CodeBlock label="url">{`wss://vibecodingtribe-realtime.techfren.workers.dev/api/realtime\n  ?clientId=browser_01H...\n  &displayName=Maya%20Chen\n  &handle=mayac\n  &avatarColor=%2386d8c4`}</CodeBlock><p><code>clientId</code> must be 8–80 characters using letters, digits, underscore, or hyphen. Display names are collapsed to 40 characters. Handles remove unsupported characters and are capped at 32.</p></> },
    { id: 'client-event', title: 'Client → room', body: <><CodeBlock label="send event">{`{\n  "type": "send",\n  "message": {\n    "id": "browser_01H:1784428929143:1",\n    "text": "Ship the one-room slice.",\n    "threadId": "optional-thread-id"\n  }\n}`}</CodeBlock><p>Text is trimmed, must be non-empty, and may not exceed 4,000 characters. Binary WebSocket frames are not supported.</p></> },
    { id: 'snapshot', title: 'Room → client: snapshot', body: <><CodeBlock label="snapshot event">{`{\n  "type": "snapshot",\n  "messages": [RealtimeMessageRecord],\n  "participants": [RealtimeProfile],\n  "onlineCount": 3\n}`}</CodeBlock><p>The first event after connection contains bounded durable history plus current presence. The client merges records by ID rather than replacing seeded product context.</p></> },
    { id: 'message-presence', title: 'Room → client: message and presence', body: <><CodeBlock label="message event">{`{\n  "type": "message",\n  "message": {\n    "id": "browser_01H:1784428929143:1",\n    "clientId": "browser_01H",\n    "displayName": "Maya Chen",\n    "handle": "mayac",\n    "avatarColor": "#86d8c4",\n    "text": "Ship the one-room slice.",\n    "sentAt": "2026-07-19T02:42:09.143Z"\n  }\n}`}</CodeBlock><CodeBlock label="presence event">{`{\n  "type": "presence",\n  "participants": [RealtimeProfile],\n  "onlineCount": 3\n}`}</CodeBlock></> },
    { id: 'errors', title: 'Errors', body: <><CodeBlock label="error event">{`{\n  "type": "error",\n  "message": "Message payload was invalid",\n  "clientMessageId": "optional-id-for-retry-state"\n}`}</CodeBlock><p>Malformed JSON, invalid payloads, binary frames, and missing socket identity return an error event without terminating every connection. Invalid origins or profiles fail before upgrade with an HTTP response.</p></> },
    { id: 'semantics', title: 'Ordering and deduplication', body: <><p>The Durable Object processes room events through one object instance and writes the accepted record before broadcast. A duplicate message ID returns the existing canonical record to the sender.</p><p>The protocol version is implicit today. Introduce an explicit version before incompatible event changes or multiple client generations need to coexist.</p></> },
  ],
}

const deployment: DocPage = {
  slug: 'cloudflare-deployment', group: 'Build', eyebrow: 'Deployment', title: 'Deploy both Cloudflare surfaces',
  summary: 'Build and publish the Pages client, realtime Worker, Durable Object migration, and docs project.', readingTime: '10 min',
  searchText: 'cloudflare deploy wrangler pages worker durable object migration docs domain production scripts',
  sections: [
    { id: 'auth', title: 'Authenticate Wrangler', body: <><CodeBlock>npx wrangler login{`\n`}npx wrangler whoami</CodeBlock><p>The deployer needs Pages write access plus Workers and Durable Objects permissions in the target account.</p></> },
    { id: 'worker', title: 'Deploy the realtime Worker', body: <><CodeBlock>npm run deploy:realtime</CodeBlock><p><code>wrangler.realtime.jsonc</code> declares the Worker entry point, allowed local origins, the <code>LIVE_ROOM</code> binding, and the SQLite-backed Durable Object migration.</p><Callout tone="warning" title="Migration tags are append-only"><p>Do not rewrite a migration tag that has already reached production. Add a new tag for class renames, additions, or deletions.</p></Callout></> },
    { id: 'app', title: 'Deploy the product client', body: <><CodeBlock>{'npm run deploy:cloudflare'}</CodeBlock><p>The script runs the production build and directly uploads <code>dist</code> to the <code>vibecodingtribe</code> Pages project on its production branch.</p></> },
    { id: 'docs', title: 'Deploy this documentation site', body: <><CodeBlock>{'npm run deploy:docs'}</CodeBlock><p>The docs use their own Vite root and publish <code>dist-docs</code> to the <code>vibecodingtribe-docs</code> Pages project. A wildcard Pages redirect supports shareable client-side routes.</p></> },
    { id: 'verify', title: 'Post-deploy verification', body: <><CodeBlock label="health checks">curl -fsS https://vibecodingtribe-realtime.techfren.workers.dev/health{`\n`}curl -fsSI https://vibecodingtribe.pages.dev/{`\n`}curl -fsSI https://docs.vibecodingtribe.com/</CodeBlock><p>Also verify an actual WebSocket message across two production tabs. An HTTP 200 alone does not prove realtime delivery.</p></> },
  ],
}

const operations: DocPage = {
  slug: 'operations', group: 'Operate', eyebrow: 'Runbook', title: 'Operate the one-room service',
  summary: 'Health checks, logs, release verification, incident triage, and safe recovery for the deployed MVP.', readingTime: '11 min',
  searchText: 'operations runbook health logs tail incident troubleshooting websocket release rollback durable history outage',
  sections: [
    { id: 'signals', title: 'Primary signals', body: <table><thead><tr><th>Signal</th><th>Healthy</th><th>Investigate</th></tr></thead><tbody><tr><td>Worker health</td><td><code>status: ok</code>, expected room</td><td>Non-200, wrong binding or route</td></tr><tr><td>Socket upgrade</td><td>HTTP 101</td><td>400 profile, 403 origin, 426 upgrade</td></tr><tr><td>Client header</td><td>Live count and identity shown</td><td>Persistent reconnect banner</td></tr><tr><td>Delivery</td><td>Message appears in second client</td><td>Outbox grows or duplicate render</td></tr><tr><td>History</td><td>Accepted message returns after reload</td><td>Snapshot empty after successful send</td></tr></tbody></table> },
    { id: 'logs', title: 'Tail Worker logs', body: <><CodeBlock>npx wrangler tail vibecodingtribe-realtime</CodeBlock><p>Correlate HTTP status, WebSocket exceptions, and client retry behavior. Message text should not be copied into ad-hoc incident systems unless retention and privacy rules permit it.</p></> },
    { id: 'triage', title: 'Triage by symptom', body: <div className="troubleshooting">
      <details open><summary>Header remains offline</summary><p>Check browser console, Worker health, the chosen realtime origin, Origin allowlist, and whether the upgrade URL contains a valid profile.</p></details>
      <details><summary>Sender sees a message; peers do not</summary><p>Confirm the sender received a canonical message event, inspect Worker exceptions, and verify peers resolve the same named room and Worker deployment.</p></details>
      <details><summary>Message returns twice</summary><p>Inspect whether UI merge logic is keyed by message ID. The server returns the existing record for a duplicate ID by design.</p></details>
      <details><summary>Presence count is briefly high</summary><p>Closing sockets are removed asynchronously. Confirm the count converges after runtime cleanup before treating it as a leak.</p></details>
      <details><summary>Pages shows an older release</summary><p>Compare the immutable deployment URL and canonical asset hash. Pages aliases can take a short time to converge after direct upload.</p></details>
    </div> },
    { id: 'release', title: 'Release checklist', body: <ul className="check-list"><li>Worktree clean and intended commit on <code>main</code></li><li>Client and Worker typechecks pass</li><li>Lint, tests, builds, and dependency audit pass</li><li>Worker deployed before a client that depends on new protocol behavior</li><li>Health endpoint identifies the expected room</li><li>Canonical Pages asset matches the new build</li><li>Two-client production message and reload test passes</li><li>Browser console has no new warnings or errors</li></ul> },
    { id: 'recovery', title: 'Recovery posture', body: <><p>Deployments are immutable and can be inspected independently. For a client-only regression, redeploy the last known-good <code>dist</code> or fix forward. For a Worker regression, deploy a compatible prior source revision without rewriting Durable Object migrations.</p><Callout tone="warning" title="Do not destroy room storage during incident response"><p>Deleting or renaming the Durable Object namespace can strand history. Resolve the exact deployment and migration scope before any destructive action.</p></Callout></> },
  ],
}

const security: DocPage = {
  slug: 'security', group: 'Operate', eyebrow: 'Trust model', title: 'Security model and launch gaps',
  summary: 'Current controls, explicit non-guarantees, and the minimum trust boundary required before inviting a public community.', readingTime: '12 min',
  searchText: 'security auth guest identity origin validation permissions approval audit moderation rate limit abuse privacy retention',
  sections: [
    { id: 'current-controls', title: 'Controls in the current slice', body: <ul className="check-list"><li>Exact production and preview origin checks before WebSocket upgrade</li><li>Strict connection profile normalization and length limits</li><li>Strict JSON event parsing and 4,000-character message limit</li><li>Server-issued timestamps and message ID deduplication</li><li>No binary frames or hidden file ingestion</li><li>Visible approval UI for high-risk agent actions</li><li>Repository-scoped product context</li></ul> },
    { id: 'not-guaranteed', title: 'What is not guaranteed', body: <><Callout tone="warning" title="The current room is public guest chat"><p>A browser-generated identity can be edited and does not prove GitHub ownership. Origin validation prevents arbitrary browser origins; it is not membership authorization.</p></Callout><ul><li>No authenticated account or session binding</li><li>No rate limiting, spam defense, bans, or moderation queue</li><li>No encrypted private-repository authorization</li><li>No user-facing deletion, export, or retention controls</li><li>No server-executed GitHub write or agent tool</li><li>No end-to-end encryption</li></ul></> },
    { id: 'launch-boundary', title: 'Minimum public-launch boundary', body: <Steps><li><strong>Authenticate</strong><p>Complete GitHub OAuth on a trusted server and issue secure, expiring sessions.</p></li><li><strong>Authorize</strong><p>Verify repository membership and role on join; re-check when sensitive tools run.</p></li><li><strong>Control abuse</strong><p>Add per-account and per-IP limits, reporting, moderation, and revocation.</p></li><li><strong>Protect side effects</strong><p>Execute agent and GitHub tools server-side against immutable approval records.</p></li><li><strong>Define data policy</strong><p>Publish retention, export, deletion, backup, artifact scanning, and incident rules.</p></li></Steps> },
    { id: 'agent-trust', title: 'Agent trust rules', body: <><p>An agent must never gain authority because it appears in a room. Authority comes from a scoped server record tied to a human or organization, with an exact repository, tool set, duration, and approval policy.</p><p>Continuous listening must be opt-in, visible, revocable, time-bounded, and auditable. Repository writes, deploys, secrets, and destructive operations require action-time checks.</p></> },
  ],
}

const launchStatus: DocPage = {
  slug: 'launch-status', group: 'Operate', eyebrow: 'Launch control', title: 'MVP status and path to public launch',
  summary: 'A candid capability matrix and the shortest sequence from the working one-room slice to a trusted limited launch.', readingTime: '13 min',
  searchText: 'launch status roadmap mvp criteria github oauth webhooks agents moderation threads metrics next steps',
  sections: [
    { id: 'matrix', title: 'Capability matrix', body: <div className="launch-matrix"><div className="launch-matrix__head"><span>Capability</span><span>Status</span><span>Launch action</span></div>
      {[
        ['One-room realtime chat','Live','Observe message latency and reconnects'],
        ['Durable bounded history','Live','Define retention and pagination'],
        ['Presence + guest identity','MVP only','Replace with GitHub sessions'],
        ['Attention rail + return brief','Interactive slice','Move state and ranking server-side'],
        ['Agent state + approvals','Interactive slice','Connect one sandboxed read tool'],
        ['GitHub events','Demo data','Ingest signed webhooks'],
        ['GitHub writes','Mocked','Ship one approval-bound action'],
        ['Threads and reactions','UI slice','Synchronize realtime events'],
        ['Files and media','Affordance only','Add scanned object storage'],
        ['Moderation and abuse controls','Missing','Required before public access'],
      ].map(([cap,status,action])=><div key={cap}><span>{cap}</span><span><i className={status==='Live'?'dot dot--live':status==='Missing'?'dot dot--missing':'dot'} />{status}</span><span>{action}</span></div>)}
    </div> },
    { id: 'next-sequence', title: 'Recommended next sequence', body: <Steps>
      <li><strong>GitHub identity and membership</strong><p>OAuth, installation flow, session cookies, profile binding, and repository authorization.</p></li>
      <li><strong>Real repository events</strong><p>Signed webhook ingestion for pull requests, checks, issues, pushes, and review requests.</p></li>
      <li><strong>One useful agent</strong><p>A sandboxed, repository-reading agent that can be invoked from a message and stream a bounded result.</p></li>
      <li><strong>One approved write</strong><p>Choose a reversible action such as posting a GitHub comment before branch creation or deployment.</p></li>
      <li><strong>Trust and operations</strong><p>Rate limits, moderation, audit storage, retention, budgets, alerts, and incident ownership.</p></li>
      <li><strong>Invite-only launch</strong><p>Start with one repository community, instrument activation and delivery quality, and resist adding more rooms until the core loop repeats.</p></li>
    </Steps> },
    { id: 'success', title: 'What to measure', body: <div className="future-services"><article><strong>Activation</strong><p>Signed in, joined the repo, sent a message, invoked an agent.</p></article><article><strong>Chat quality</strong><p>Send latency, reconnect rate, failed outbox items, return frequency.</p></article><article><strong>Attention utility</strong><p>Useful suggestions followed vs. dismissed or bypassed.</p></article><article><strong>Agent utility</strong><p>Completed tasks, approvals granted, stops, failures, human follow-through.</p></article><article><strong>Community utility</strong><p>Contributor questions resolved and time to useful first contribution.</p></article></div> },
    { id: 'non-goals', title: 'Keep out of the first launch', body: <><p>Voice rooms, embedded terminals, multiple identity providers, professional reputation, generalized project management, a marketplace, full GitHub domain replacement, and broad multi-community discovery should not block validation of the core room.</p><Callout title="Launch principle"><p>Earn the second room by making the first room meaningfully better than moving between Discord, GitHub, and a coding agent.</p></Callout></> },
  ],
}

const reference: DocPage = {
  slug: 'reference', group: 'Reference', eyebrow: 'Reference', title: 'Commands, files, routes, and shortcuts',
  summary: 'A compact operator and contributor reference for the repository.', readingTime: '7 min',
  searchText: 'reference commands files routes shortcuts keyboard environment scripts config ports repository',
  sections: [
    { id: 'commands', title: 'npm commands', body: <table><thead><tr><th>Command</th><th>Purpose</th></tr></thead><tbody><tr><td><code>npm run dev</code></td><td>Product client on port 4173</td></tr><tr><td><code>npm run dev:realtime</code></td><td>Local Worker on port 8787</td></tr><tr><td><code>npm run dev:docs</code></td><td>Documentation on port 4174</td></tr><tr><td><code>npm run build</code></td><td>Typecheck and build product client</td></tr><tr><td><code>npm run build:docs</code></td><td>Typecheck and build documentation</td></tr><tr><td><code>npm run deploy:realtime</code></td><td>Publish the Worker and Durable Object binding</td></tr><tr><td><code>npm run deploy:cloudflare</code></td><td>Publish the product Pages project</td></tr><tr><td><code>npm run deploy:docs</code></td><td>Publish the docs Pages project</td></tr></tbody></table> },
    { id: 'files', title: 'Key files', body: <div className="definition-table"><div><code>src/App.tsx</code><p>Product state, realtime integration, panels, and interactions.</p></div><div><code>src/services/realtime.ts</code><p>Identity, WebSocket client, retry, and outbox.</p></div><div><code>src/realtime/protocol.ts</code><p>Shared event types, constants, normalization, and parsers.</p></div><div><code>worker/index.ts</code><p>Worker routes and Durable Object room implementation.</p></div><div><code>wrangler.realtime.jsonc</code><p>Worker binding, allowed origins, and migrations.</p></div><div><code>docs-site/src/content.tsx</code><p>Documentation information architecture and source content.</p></div></div> },
    { id: 'routes', title: 'Public routes', body: <table><thead><tr><th>URL</th><th>Role</th></tr></thead><tbody><tr><td><a href="https://vibecodingtribe.com">vibecodingtribe.com</a></td><td>Product client</td></tr><tr><td><a href="https://docs.vibecodingtribe.com">docs.vibecodingtribe.com</a></td><td>Documentation</td></tr><tr><td><code>…workers.dev/health</code></td><td>Realtime health</td></tr><tr><td><code>…workers.dev/api/realtime</code></td><td>WebSocket upgrade</td></tr></tbody></table> },
    { id: 'shortcuts', title: 'Product shortcuts', body: <table><thead><tr><th>Shortcut</th><th>Action</th></tr></thead><tbody><tr><td><kbd>⌘/Ctrl K</kbd></td><td>Quick switcher</td></tr><tr><td><kbd>⌘/Ctrl F</kbd></td><td>Search the room</td></tr><tr><td><kbd>g</kbd>, then <kbd>n</kbd></td><td>Next Needs You item</td></tr><tr><td><kbd>g</kbd>, then <kbd>a</kbd></td><td>Next Active item</td></tr><tr><td><kbd>g</kbd>, then <kbd>r</kbd></td><td>Open repository</td></tr><tr><td><kbd>c</kbd></td><td>Focus composer</td></tr><tr><td><kbd>a</kbd></td><td>Open agent actions</td></tr><tr><td><kbd>h</kbd></td><td>Mark handled</td></tr><tr><td><kbd>⌘/Ctrl .</kbd></td><td>Stop foreground agent</td></tr></tbody></table> },
    { id: 'constants', title: 'Realtime constants', body: <CodeBlock label="typescript">{`LIVE_CONVERSATION_ID = 'conversation-vct-general'\nLIVE_REPOSITORY = 'aj47/VibeCodingTribe'\nLIVE_CHANNEL = 'general'\nMAX_REALTIME_MESSAGE_LENGTH = 4_000\nHISTORY_LIMIT = 200`}</CodeBlock> },
  ],
}

export const docs: DocPage[] = [overview, quickstart, productModel, realtimeChat, attentionSystem, agents, architecture, protocol, deployment, operations, security, launchStatus, reference]

export const docGroups: DocGroup[] = ['Start here', 'Product', 'Build', 'Operate', 'Reference']

export function findDoc(pathname: string) {
  const slug = pathname.replace(/^\/+|\/+$/g, '')
  return docs.find((doc) => doc.slug === slug)
}
