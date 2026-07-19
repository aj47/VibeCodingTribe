export type EntityId = string;
export type ISODateTime = string;

export type ParticipantKind = "human" | "agent" | "system" | "github";
export type PresenceState = "online" | "away" | "offline";

export interface Participant {
  id: EntityId;
  kind: ParticipantKind;
  displayName: string;
  handle: string;
  avatarUrl?: string;
  avatarFallback: string;
  avatarColor?: string;
  presence: PresenceState;
  role?: "owner" | "maintainer" | "contributor" | "member" | "bot";
  githubUsername?: string;
  agentId?: EntityId;
}

export interface UserProfile {
  id: EntityId;
  participantId: EntityId;
  githubUserId: string;
  githubUsername: string;
  matrixUserId: string;
  displayName: string;
  avatarUrl?: string;
  timezone: string;
  onboardingCompleted: boolean;
  onboarding: {
    currentFocus: string;
    repositoryIds: EntityId[];
    desiredHelp: string[];
    codingAgents: string[];
    continuousListeningDefault: boolean;
  };
}

export type RepositoryVisibility = "public" | "private" | "internal";
export type RepositoryPermission = "read" | "triage" | "write" | "maintain" | "admin";

export interface RepositoryReference {
  id: EntityId;
  owner: string;
  name: string;
  fullName: string;
  description: string;
  visibility: RepositoryVisibility;
  htmlUrl: string;
  defaultBranch: string;
  language?: string;
  permission: RepositoryPermission;
  connected: boolean;
  matrixSpaceId?: string;
}

export interface GitHubActor {
  id: string;
  login: string;
  displayName?: string;
  avatarUrl?: string;
}

export type GitHubPullRequestState = "open" | "merged" | "closed";
export type GitHubReviewState = "none" | "requested" | "changes-requested" | "approved";
export type GitHubChecksState = "queued" | "in-progress" | "success" | "failure" | "neutral";

export interface GitHubPullRequestReference {
  id: EntityId;
  repositoryId: EntityId;
  number: number;
  title: string;
  state: GitHubPullRequestState;
  isDraft: boolean;
  author: GitHubActor;
  url: string;
  baseBranch: string;
  headBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewState: GitHubReviewState;
  checksState: GitHubChecksState;
}

export interface GitHubIssueReference {
  id: EntityId;
  repositoryId: EntityId;
  number: number;
  title: string;
  state: "open" | "closed";
  author: GitHubActor;
  url: string;
  labels: string[];
}

export interface GitHubCheckRun {
  id: EntityId;
  name: string;
  status: "queued" | "in-progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed-out";
  detailsUrl?: string;
  startedAt: ISODateTime;
  completedAt?: ISODateTime;
}

export type GitHubEventType =
  | "issue"
  | "pull-request"
  | "review"
  | "check-run"
  | "comment";

export interface GitHubEvent {
  id: EntityId;
  type: GitHubEventType;
  action: string;
  repository: RepositoryReference;
  actor: GitHubActor;
  title: string;
  description: string;
  occurredAt: ISODateTime;
  url: string;
  pullRequest?: GitHubPullRequestReference;
  issue?: GitHubIssueReference;
  checkRun?: GitHubCheckRun;
}

export type AgentStatus =
  | "offline"
  | "listening"
  | "working"
  | "waiting"
  | "blocked"
  | "approval-required"
  | "completed"
  | "failed"
  | "stopped";

export type AgentPermission =
  | "read-room"
  | "read-thread"
  | "read-repository"
  | "write-repository"
  | "run-local-tools"
  | "run-remote-tools"
  | "access-secrets"
  | "create-branches"
  | "open-pull-requests"
  | "post-comments"
  | "merge-changes"
  | "continuous-listening";

export interface AgentDefinition {
  id: EntityId;
  name: string;
  handle: string;
  avatarUrl?: string;
  avatarFallback: string;
  avatarColor?: string;
  provider: string;
  runtime: string;
  ownerParticipantId: EntityId;
  description: string;
  capabilities: string[];
  defaultPermissions: AgentPermission[];
}

export interface AgentSession {
  id: EntityId;
  agentId: EntityId;
  conversationId: EntityId;
  threadId?: EntityId;
  name: string;
  avatarUrl?: string;
  avatarFallback: string;
  provider: string;
  runtime: string;
  ownerParticipantId: EntityId;
  status: AgentStatus;
  task: string;
  statusDetail?: string;
  continuousListening: boolean;
  permissions: AgentPermission[];
  startedAt: ISODateTime;
  lastActivity: ISODateTime;
  completedAt?: ISODateTime;
}

export interface AgentPermissionGrant {
  id: EntityId;
  agentSessionId: EntityId;
  permission: AgentPermission;
  scope: "session" | "thread" | "room" | "repository";
  scopeId: EntityId;
  grantedByParticipantId: EntityId;
  grantedAt: ISODateTime;
  expiresAt?: ISODateTime;
}

export type ConversationType = "room" | "thread" | "dm";
export type SidebarSectionId =
  | "needs-you"
  | "active"
  | "waiting"
  | "repositories"
  | "direct-messages";
export type AttentionSectionId = Extract<SidebarSectionId, "needs-you" | "active" | "waiting">;

export interface Conversation {
  id: EntityId;
  matrixRoomId: string;
  type: ConversationType;
  title: string;
  subtitle?: string;
  slug?: string;
  repo?: RepositoryReference;
  issue?: GitHubIssueReference;
  pullRequest?: GitHubPullRequestReference;
  unreadCount: number;
  unreadMentionCount: number;
  lastReadEventId?: EntityId;
  lastMessageAt: ISODateTime;
  lastMessagePreview: string;
  participants: Participant[];
  agents: AgentSession[];
  summary?: ReturnSummary;
  sidebarSection: SidebarSectionId;
  attentionScore: number;
  attentionReason?: string;
  isMuted: boolean;
  isPinned: boolean;
  activeNow: boolean;
  userOrder: number;
}

export interface Thread {
  id: EntityId;
  conversationId: EntityId;
  rootMessageId: EntityId;
  title?: string;
  participantIds: EntityId[];
  agentSessionIds: EntityId[];
  replyCount: number;
  unreadCount: number;
  lastReplyAt: ISODateTime;
  isResolved: boolean;
}

export interface ReactionSummary {
  emoji: string;
  label: string;
  count: number;
  participantIds: EntityId[];
  reactedByCurrentUser: boolean;
}

export type MessageDeliveryState = "sent" | "local-echo" | "failed";

export interface MessageBase {
  id: EntityId;
  conversationId: EntityId;
  senderId: EntityId;
  sentAt: ISODateTime;
  threadId?: EntityId;
  replyToId?: EntityId;
  editedAt?: ISODateTime;
  deletedAt?: ISODateTime;
  deliveryState: MessageDeliveryState;
  reactions: ReactionSummary[];
}

export interface CodeBlock {
  id: EntityId;
  language: string;
  code: string;
  filename?: string;
}

export interface HumanMessage extends MessageBase {
  kind: "human";
  content: {
    text: string;
    format: "plain" | "markdown";
    codeBlocks?: CodeBlock[];
    mentionedParticipantIds?: EntityId[];
  };
}

export interface AgentResponseMessage extends MessageBase {
  kind: "agent-response";
  content: {
    text: string;
    isStreaming: boolean;
    agentSessionId: EntityId;
    citations?: Array<{ label: string; url: string }>;
  };
}

export interface AgentProgressMessage extends MessageBase {
  kind: "agent-progress";
  content: {
    agentSessionId: EntityId;
    label: string;
    detail?: string;
    progress?: number;
    state: "running" | "waiting" | "blocked" | "complete" | "failed";
  };
}

export interface ToolCallSnapshot {
  id: EntityId;
  toolName: string;
  displayName: string;
  arguments: Record<string, unknown>;
  status: "queued" | "running" | "approval-required" | "succeeded" | "failed" | "cancelled";
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  resultSummary?: string;
}

export interface AgentToolMessage extends MessageBase {
  kind: "agent-tool";
  content: {
    agentSessionId: EntityId;
    toolCall: ToolCallSnapshot;
  };
}

export type ApprovalRisk = "low" | "medium" | "high" | "critical";
export type ApprovalStatus = "pending" | "approved" | "denied" | "cancelled" | "expired";

export interface ApprovalRequest {
  id: EntityId;
  agentSessionId: EntityId;
  conversationId: EntityId;
  eventId: EntityId;
  requestedByAgentId: EntityId;
  requestedAt: ISODateTime;
  resolvedAt?: ISODateTime;
  resolvedByParticipantId?: EntityId;
  status: ApprovalStatus;
  risk: ApprovalRisk;
  title: string;
  consequence: string;
  scope: string;
  tool: string;
  args: Record<string, unknown>;
  detail: string;
}

export interface ApprovalMessage extends MessageBase {
  kind: "approval";
  content: {
    approvalRequestId: EntityId;
    title: string;
    description: string;
  };
}

export interface GitHubEventMessage extends MessageBase {
  kind: "github-event";
  content: {
    event: GitHubEvent;
  };
}

export interface SystemMessage extends MessageBase {
  kind: "system";
  content: {
    text: string;
    tone: "neutral" | "success" | "warning" | "error";
  };
}

export interface ArtifactReference {
  id: EntityId;
  name: string;
  kind: "file" | "diff" | "report" | "image" | "link";
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  preview?: string;
}

export interface ArtifactMessage extends MessageBase {
  kind: "artifact";
  content: {
    agentSessionId?: EntityId;
    text: string;
    artifacts: ArtifactReference[];
  };
}

export type Message =
  | HumanMessage
  | AgentResponseMessage
  | AgentProgressMessage
  | AgentToolMessage
  | ApprovalMessage
  | GitHubEventMessage
  | SystemMessage
  | ArtifactMessage;

export type AttentionReason =
  | "mention"
  | "reply"
  | "approval"
  | "agent-blocked"
  | "ci-failed"
  | "review-request"
  | "activity"
  | "agent-working"
  | "awaiting-user"
  | "awaiting-ci";

export interface AttentionItem {
  id: EntityId;
  conversationId: EntityId;
  section: AttentionSectionId;
  reason: AttentionReason;
  reasonLabel: string;
  score: number;
  isUnread: boolean;
  handledAt?: ISODateTime;
  pinned?: boolean;
  updatedAt: ISODateTime;
  agentSessionId?: EntityId;
}

export interface SidebarSection {
  id: SidebarSectionId;
  label: string;
  conversationIds: EntityId[];
  attentionItemIds: EntityId[];
  isCollapsed: boolean;
  unreadCount: number;
}

export type ReturnSummaryBulletKind = "decision" | "agent" | "github" | "request" | "blocker";

export interface ReturnSummaryBullet {
  id: EntityId;
  kind: ReturnSummaryBulletKind;
  text: string;
  sourceEventId?: EntityId;
}

export interface ReturnSummary {
  id: EntityId;
  conversationId: EntityId;
  from: ISODateTime;
  to: ISODateTime;
  timeSinceLastVisitLabel: string;
  newMessageCount: number;
  status: "ready" | "generating" | "error";
  bullets: ReturnSummaryBullet[];
  generatedAt?: ISODateTime;
  dismissedAt?: ISODateTime;
}

export type ActivityLogType =
  | "status"
  | "progress"
  | "tool-call"
  | "approval"
  | "result"
  | "error"
  | "github-action"
  | "summary";

export interface ActivityLogEntry {
  id: EntityId;
  agentSessionId: EntityId;
  conversationId: EntityId;
  type: ActivityLogType;
  timestamp: ISODateTime;
  title: string;
  detail: string;
  status?: "info" | "running" | "success" | "warning" | "error";
  toolCall?: ToolCallSnapshot;
  approvalRequestId?: EntityId;
  githubEventId?: EntityId;
}

export interface Draft {
  id: EntityId;
  conversationId: EntityId;
  threadId?: EntityId;
  text: string;
  updatedAt: ISODateTime;
  attachmentIds: EntityId[];
}

export type OpenConversationPanel = "none" | "thread" | "artifact" | "agent" | "details";

export interface VisitState {
  id: EntityId;
  conversationId: EntityId;
  lastVisitedAt: ISODateTime;
  lastReadEventId?: EntityId;
  scrollAnchorEventId?: EntityId;
  scrollOffsetPx: number;
  selectedThreadId?: EntityId;
  openPanel: OpenConversationPanel;
  openArtifactId?: EntityId;
  hasMeaningfulChanges: boolean;
}

export interface AppSeedData {
  currentUser: UserProfile;
  participants: Participant[];
  repositories: RepositoryReference[];
  pullRequests: GitHubPullRequestReference[];
  githubEvents: GitHubEvent[];
  agentDefinitions: AgentDefinition[];
  agentSessions: AgentSession[];
  permissionGrants: AgentPermissionGrant[];
  conversations: Conversation[];
  threads: Thread[];
  messages: Message[];
  attentionItems: AttentionItem[];
  sidebarSections: SidebarSection[];
  returnSummaries: ReturnSummary[];
  approvalRequests: ApprovalRequest[];
  activityLog: ActivityLogEntry[];
  drafts: Draft[];
  visitStates: VisitState[];
  selectedConversationId: EntityId;
}
