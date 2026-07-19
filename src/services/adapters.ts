import { seedData } from "../data/seed";
import type {
  ActivityLogEntry,
  AgentDefinition,
  AgentSession,
  AgentStatus,
  AppSeedData,
  ApprovalRequest,
  ApprovalStatus,
  Conversation,
  EntityId,
  GitHubCheckRun,
  GitHubEvent,
  GitHubPullRequestReference,
  HumanMessage,
  Message,
  RepositoryReference,
  UserProfile,
} from "../domain/types";

export type Unsubscribe = () => void;

function clone<T>(value: T): T {
  return structuredClone(value);
}

class DeterministicSequence {
  private sequence = 0;
  private readonly epoch: number;

  constructor(epoch = "2026-07-18T18:00:00.000Z") {
    this.epoch = Date.parse(epoch);
  }

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(4, "0")}`;
  }

  nextTimestamp(): string {
    this.sequence += 1;
    return new Date(this.epoch + this.sequence * 1_000).toISOString();
  }
}

export interface MessagePage {
  items: Message[];
  hasMore: boolean;
  nextCursor?: EntityId;
}

export interface MessageQuery {
  conversationId: EntityId;
  threadId?: EntityId;
  before?: EntityId;
  limit?: number;
}

export interface SendMessageInput {
  conversationId: EntityId;
  threadId?: EntityId;
  replyToId?: EntityId;
  text: string;
  mentionedParticipantIds?: EntityId[];
}

export type MatrixAdapterEvent =
  | { type: "message"; message: Message }
  | { type: "message-updated"; message: Message }
  | { type: "conversation-updated"; conversation: Conversation }
  | { type: "typing"; conversationId: EntityId; participantId: EntityId; isTyping: boolean };

export interface MatrixAdapter {
  getCurrentUser(): Promise<UserProfile>;
  listConversations(): Promise<Conversation[]>;
  getConversation(conversationId: EntityId): Promise<Conversation | undefined>;
  getMessages(query: MessageQuery): Promise<MessagePage>;
  searchMessages(conversationId: EntityId, query: string): Promise<Message[]>;
  sendMessage(input: SendMessageInput): Promise<HumanMessage>;
  editMessage(messageId: EntityId, text: string): Promise<HumanMessage>;
  deleteMessage(messageId: EntityId): Promise<Message>;
  markRead(conversationId: EntityId, eventId: EntityId): Promise<Conversation>;
  setTyping(conversationId: EntityId, isTyping: boolean): Promise<void>;
  subscribe(listener: (event: MatrixAdapterEvent) => void): Unsubscribe;
}

export class MockMatrixAdapter implements MatrixAdapter {
  private readonly sequence = new DeterministicSequence();
  private readonly listeners = new Set<(event: MatrixAdapterEvent) => void>();
  private readonly currentUser: UserProfile;
  private conversations: Conversation[];
  private messages: Message[];

  constructor(initial: AppSeedData = seedData) {
    this.currentUser = clone(initial.currentUser);
    this.conversations = clone(initial.conversations);
    this.messages = clone(initial.messages);
  }

  async getCurrentUser(): Promise<UserProfile> {
    return clone(this.currentUser);
  }

  async listConversations(): Promise<Conversation[]> {
    return clone(
      [...this.conversations].sort(
        (left, right) => right.attentionScore - left.attentionScore || left.userOrder - right.userOrder,
      ),
    );
  }

  async getConversation(conversationId: EntityId): Promise<Conversation | undefined> {
    const conversation = this.conversations.find((candidate) => candidate.id === conversationId);
    return conversation ? clone(conversation) : undefined;
  }

  async getMessages(query: MessageQuery): Promise<MessagePage> {
    const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
    const matching = this.messages
      .filter(
        (message) =>
          message.conversationId === query.conversationId &&
          (query.threadId === undefined || message.threadId === query.threadId),
      )
      .sort((left, right) => left.sentAt.localeCompare(right.sentAt));

    const cursorIndex = query.before
      ? matching.findIndex((message) => message.id === query.before)
      : matching.length;
    const pageEnd = cursorIndex >= 0 ? cursorIndex : matching.length;
    const pageStart = Math.max(0, pageEnd - limit);
    const items = matching.slice(pageStart, pageEnd);

    return {
      items: clone(items),
      hasMore: pageStart > 0,
      nextCursor: pageStart > 0 ? items[0]?.id : undefined,
    };
  }

  async searchMessages(conversationId: EntityId, query: string): Promise<Message[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];

    return clone(
      this.messages.filter((message) => {
        if (message.conversationId !== conversationId) return false;
        return this.messageText(message).toLocaleLowerCase().includes(normalizedQuery);
      }),
    );
  }

  async sendMessage(input: SendMessageInput): Promise<HumanMessage> {
    const sentAt = this.sequence.nextTimestamp();
    const message: HumanMessage = {
      id: this.sequence.nextId("matrix-local-event"),
      conversationId: input.conversationId,
      senderId: this.currentUser.participantId,
      sentAt,
      threadId: input.threadId,
      replyToId: input.replyToId,
      deliveryState: "sent",
      reactions: [],
      kind: "human",
      content: {
        text: input.text,
        format: "markdown",
        mentionedParticipantIds: input.mentionedParticipantIds,
      },
    };

    this.messages.push(message);
    this.updateConversationPreview(message);
    this.emit({ type: "message", message: clone(message) });
    return clone(message);
  }

  async editMessage(messageId: EntityId, text: string): Promise<HumanMessage> {
    const message = this.messages.find((candidate) => candidate.id === messageId);
    if (!message || message.kind !== "human") {
      throw new Error(`Editable human message not found: ${messageId}`);
    }

    message.content.text = text;
    message.editedAt = this.sequence.nextTimestamp();
    this.emit({ type: "message-updated", message: clone(message) });
    return clone(message);
  }

  async deleteMessage(messageId: EntityId): Promise<Message> {
    const message = this.messages.find((candidate) => candidate.id === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);

    message.deletedAt = this.sequence.nextTimestamp();
    this.emit({ type: "message-updated", message: clone(message) });
    return clone(message);
  }

  async markRead(conversationId: EntityId, eventId: EntityId): Promise<Conversation> {
    const conversation = this.conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    conversation.lastReadEventId = eventId;
    conversation.unreadCount = 0;
    conversation.unreadMentionCount = 0;
    const snapshot = clone(conversation);
    this.emit({ type: "conversation-updated", conversation: snapshot });
    return snapshot;
  }

  async setTyping(conversationId: EntityId, isTyping: boolean): Promise<void> {
    if (!this.conversations.some((candidate) => candidate.id === conversationId)) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    this.emit({
      type: "typing",
      conversationId,
      participantId: this.currentUser.participantId,
      isTyping,
    });
  }

  subscribe(listener: (event: MatrixAdapterEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: MatrixAdapterEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private updateConversationPreview(message: HumanMessage): void {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === message.conversationId,
    );
    if (!conversation) return;

    conversation.lastMessageAt = message.sentAt;
    conversation.lastMessagePreview = message.content.text;
    this.emit({ type: "conversation-updated", conversation: clone(conversation) });
  }

  private messageText(message: Message): string {
    switch (message.kind) {
      case "human":
      case "agent-response":
        return message.content.text;
      case "agent-progress":
        return `${message.content.label} ${message.content.detail ?? ""}`;
      case "agent-tool":
        return `${message.content.toolCall.displayName} ${message.content.toolCall.resultSummary ?? ""}`;
      case "approval":
        return `${message.content.title} ${message.content.description}`;
      case "github-event":
        return `${message.content.event.title} ${message.content.event.description}`;
      case "system":
        return message.content.text;
      case "artifact":
        return `${message.content.text} ${message.content.artifacts.map((artifact) => artifact.name).join(" ")}`;
    }
  }
}

export interface GitHubWriteActionInput {
  action: "post-comment" | "create-branch" | "open-pull-request";
  repositoryId: EntityId;
  payload: Record<string, unknown>;
}

export interface GitHubWriteResult {
  id: EntityId;
  action: GitHubWriteActionInput["action"];
  status: "completed";
  url: string;
  completedAt: string;
}

export type GitHubAdapterEvent = { type: "github-event"; event: GitHubEvent };

export interface GitHubAdapter {
  listRepositories(): Promise<RepositoryReference[]>;
  getRepository(repositoryId: EntityId): Promise<RepositoryReference | undefined>;
  getPullRequest(pullRequestId: EntityId): Promise<GitHubPullRequestReference | undefined>;
  listEvents(repositoryId?: EntityId): Promise<GitHubEvent[]>;
  listCheckRuns(pullRequestId: EntityId): Promise<GitHubCheckRun[]>;
  performWrite(
    input: GitHubWriteActionInput,
    approval: ApprovalRequest,
  ): Promise<GitHubWriteResult>;
  subscribe(listener: (event: GitHubAdapterEvent) => void): Unsubscribe;
}

export class MockGitHubAdapter implements GitHubAdapter {
  private readonly sequence = new DeterministicSequence("2026-07-18T18:10:00.000Z");
  private readonly listeners = new Set<(event: GitHubAdapterEvent) => void>();
  private readonly repositories: RepositoryReference[];
  private readonly pullRequests: GitHubPullRequestReference[];
  private events: GitHubEvent[];

  constructor(initial: AppSeedData = seedData) {
    this.repositories = clone(initial.repositories);
    this.pullRequests = clone(initial.pullRequests);
    this.events = clone(initial.githubEvents);
  }

  async listRepositories(): Promise<RepositoryReference[]> {
    return clone(this.repositories);
  }

  async getRepository(repositoryId: EntityId): Promise<RepositoryReference | undefined> {
    const repository = this.repositories.find((candidate) => candidate.id === repositoryId);
    return repository ? clone(repository) : undefined;
  }

  async getPullRequest(
    pullRequestId: EntityId,
  ): Promise<GitHubPullRequestReference | undefined> {
    const pullRequest = this.pullRequests.find((candidate) => candidate.id === pullRequestId);
    return pullRequest ? clone(pullRequest) : undefined;
  }

  async listEvents(repositoryId?: EntityId): Promise<GitHubEvent[]> {
    const events = repositoryId
      ? this.events.filter((event) => event.repository.id === repositoryId)
      : this.events;
    return clone([...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)));
  }

  async listCheckRuns(pullRequestId: EntityId): Promise<GitHubCheckRun[]> {
    return clone(
      this.events
        .filter((event) => event.pullRequest?.id === pullRequestId && event.checkRun)
        .map((event) => event.checkRun as GitHubCheckRun),
    );
  }

  async performWrite(
    input: GitHubWriteActionInput,
    approval: ApprovalRequest,
  ): Promise<GitHubWriteResult> {
    if (approval.status !== "approved") {
      throw new Error(`GitHub write requires approved request: ${approval.id}`);
    }
    if (approval.scope && !approval.scope.includes(this.repositoryName(input.repositoryId))) {
      throw new Error(`Approval ${approval.id} does not cover repository ${input.repositoryId}`);
    }

    return {
      id: this.sequence.nextId("github-write"),
      action: input.action,
      status: "completed",
      url: this.writeResultUrl(input),
      completedAt: this.sequence.nextTimestamp(),
    };
  }

  subscribe(listener: (event: GitHubAdapterEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Injects a deterministic webhook event into the local adapter. */
  receiveWebhook(event: GitHubEvent): void {
    this.events = [...this.events.filter((candidate) => candidate.id !== event.id), clone(event)];
    const snapshot = clone(event);
    this.listeners.forEach((listener) => listener({ type: "github-event", event: snapshot }));
  }

  private repositoryName(repositoryId: EntityId): string {
    const repository = this.repositories.find((candidate) => candidate.id === repositoryId);
    if (!repository) throw new Error(`Repository not found: ${repositoryId}`);
    return repository.fullName;
  }

  private writeResultUrl(input: GitHubWriteActionInput): string {
    const repository = this.repositories.find((candidate) => candidate.id === input.repositoryId);
    if (!repository) throw new Error(`Repository not found: ${input.repositoryId}`);

    switch (input.action) {
      case "post-comment":
        return `${repository.htmlUrl}/issues/214#issuecomment-mock`;
      case "create-branch":
        return `${repository.htmlUrl}/tree/${String(input.payload.branch ?? "mock-branch")}`;
      case "open-pull-request":
        return `${repository.htmlUrl}/pull/220`;
    }
  }
}

export interface InvokeAgentInput {
  agentId: EntityId;
  conversationId: EntityId;
  threadId?: EntityId;
  task: string;
  continuousListening?: boolean;
}

export interface AgentStreamChunk {
  id: EntityId;
  agentSessionId: EntityId;
  index: number;
  kind: "status" | "text" | "done";
  text: string;
  status: AgentStatus;
}

export type AgentAdapterEvent =
  | { type: "session-updated"; session: AgentSession }
  | { type: "activity"; entry: ActivityLogEntry }
  | { type: "approval-updated"; approval: ApprovalRequest };

export interface AgentAdapter {
  listDefinitions(): Promise<AgentDefinition[]>;
  listSessions(conversationId?: EntityId): Promise<AgentSession[]>;
  getSession(sessionId: EntityId): Promise<AgentSession | undefined>;
  getActivityLog(sessionId: EntityId): Promise<ActivityLogEntry[]>;
  listApprovalRequests(conversationId?: EntityId): Promise<ApprovalRequest[]>;
  invoke(input: InvokeAgentInput): Promise<AgentSession>;
  stream(sessionId: EntityId): AsyncIterable<AgentStreamChunk>;
  stop(sessionId: EntityId): Promise<AgentSession>;
  resolveApproval(
    approvalId: EntityId,
    decision: Extract<ApprovalStatus, "approved" | "denied">,
    participantId: EntityId,
  ): Promise<ApprovalRequest>;
  subscribe(listener: (event: AgentAdapterEvent) => void): Unsubscribe;
}

export class MockAgentAdapter implements AgentAdapter {
  private readonly sequence = new DeterministicSequence("2026-07-18T18:20:00.000Z");
  private readonly listeners = new Set<(event: AgentAdapterEvent) => void>();
  private readonly definitions: AgentDefinition[];
  private sessions: AgentSession[];
  private activityLog: ActivityLogEntry[];
  private approvals: ApprovalRequest[];

  constructor(initial: AppSeedData = seedData) {
    this.definitions = clone(initial.agentDefinitions);
    this.sessions = clone(initial.agentSessions);
    this.activityLog = clone(initial.activityLog);
    this.approvals = clone(initial.approvalRequests);
  }

  async listDefinitions(): Promise<AgentDefinition[]> {
    return clone(this.definitions);
  }

  async listSessions(conversationId?: EntityId): Promise<AgentSession[]> {
    const sessions = conversationId
      ? this.sessions.filter((session) => session.conversationId === conversationId)
      : this.sessions;
    return clone(sessions);
  }

  async getSession(sessionId: EntityId): Promise<AgentSession | undefined> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    return session ? clone(session) : undefined;
  }

  async getActivityLog(sessionId: EntityId): Promise<ActivityLogEntry[]> {
    return clone(
      this.activityLog
        .filter((entry) => entry.agentSessionId === sessionId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    );
  }

  async listApprovalRequests(conversationId?: EntityId): Promise<ApprovalRequest[]> {
    const approvals = conversationId
      ? this.approvals.filter((approval) => approval.conversationId === conversationId)
      : this.approvals;
    return clone(approvals);
  }

  async invoke(input: InvokeAgentInput): Promise<AgentSession> {
    const definition = this.definitions.find((candidate) => candidate.id === input.agentId);
    if (!definition) throw new Error(`Agent definition not found: ${input.agentId}`);

    const now = this.sequence.nextTimestamp();
    const session: AgentSession = {
      id: this.sequence.nextId("agent-session"),
      agentId: definition.id,
      conversationId: input.conversationId,
      threadId: input.threadId,
      name: definition.name,
      avatarUrl: definition.avatarUrl,
      avatarFallback: definition.avatarFallback,
      provider: definition.provider,
      runtime: definition.runtime,
      ownerParticipantId: definition.ownerParticipantId,
      status: "working",
      task: input.task,
      statusDetail: "Reading permitted context",
      continuousListening: input.continuousListening ?? false,
      permissions: [
        ...definition.defaultPermissions,
        ...(input.continuousListening ? (["continuous-listening"] as const) : []),
      ],
      startedAt: now,
      lastActivity: now,
    };

    this.sessions.push(session);
    this.appendActivity(session, "status", "Agent started", input.task, "running");
    this.emit({ type: "session-updated", session: clone(session) });
    return clone(session);
  }

  async *stream(sessionId: EntityId): AsyncIterable<AgentStreamChunk> {
    const session = this.requireSession(sessionId);
    const chunks: Array<Omit<AgentStreamChunk, "id" | "agentSessionId">> = [
      {
        index: 0,
        kind: "status",
        text: "Reading permitted room and repository context…",
        status: "working",
      },
      {
        index: 1,
        kind: "text",
        text: "I found the relevant conversation and repository context.",
        status: "working",
      },
      {
        index: 2,
        kind: "done",
        text: "The mock run completed without external side effects.",
        status: "completed",
      },
    ];

    for (const chunk of chunks) {
      session.status = chunk.status;
      session.statusDetail = chunk.text;
      session.lastActivity = this.sequence.nextTimestamp();
      if (chunk.status === "completed") session.completedAt = session.lastActivity;
      this.emit({ type: "session-updated", session: clone(session) });
      yield {
        ...chunk,
        id: this.sequence.nextId("agent-stream-chunk"),
        agentSessionId: session.id,
      };
    }

    this.appendActivity(
      session,
      "result",
      "Agent run complete",
      "The deterministic mock stream completed.",
      "success",
    );
  }

  async stop(sessionId: EntityId): Promise<AgentSession> {
    const session = this.requireSession(sessionId);
    session.status = "stopped";
    session.statusDetail = "Stopped by user";
    session.lastActivity = this.sequence.nextTimestamp();
    session.completedAt = session.lastActivity;
    this.appendActivity(session, "status", "Agent stopped", "Stopped by user.", "warning");
    const snapshot = clone(session);
    this.emit({ type: "session-updated", session: snapshot });
    return snapshot;
  }

  async resolveApproval(
    approvalId: EntityId,
    decision: Extract<ApprovalStatus, "approved" | "denied">,
    participantId: EntityId,
  ): Promise<ApprovalRequest> {
    const approval = this.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) throw new Error(`Approval request not found: ${approvalId}`);
    if (approval.status !== "pending") {
      throw new Error(`Approval request is already resolved: ${approvalId}`);
    }

    approval.status = decision;
    approval.resolvedAt = this.sequence.nextTimestamp();
    approval.resolvedByParticipantId = participantId;

    const session = this.requireSession(approval.agentSessionId);
    session.status = decision === "approved" ? "working" : "blocked";
    session.statusDetail =
      decision === "approved" ? "Approval granted; ready to continue" : "Requested action was denied";
    session.lastActivity = approval.resolvedAt;

    this.appendActivity(
      session,
      "approval",
      decision === "approved" ? "Approval granted" : "Approval denied",
      approval.title,
      decision === "approved" ? "success" : "warning",
      approval.id,
    );

    const approvalSnapshot = clone(approval);
    this.emit({ type: "approval-updated", approval: approvalSnapshot });
    this.emit({ type: "session-updated", session: clone(session) });
    return approvalSnapshot;
  }

  subscribe(listener: (event: AgentAdapterEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireSession(sessionId: EntityId): AgentSession {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`Agent session not found: ${sessionId}`);
    return session;
  }

  private appendActivity(
    session: AgentSession,
    type: ActivityLogEntry["type"],
    title: string,
    detail: string,
    status: NonNullable<ActivityLogEntry["status"]>,
    approvalRequestId?: EntityId,
  ): void {
    const entry: ActivityLogEntry = {
      id: this.sequence.nextId("agent-activity"),
      agentSessionId: session.id,
      conversationId: session.conversationId,
      type,
      timestamp: this.sequence.nextTimestamp(),
      title,
      detail,
      status,
      approvalRequestId,
    };
    this.activityLog.push(entry);
    this.emit({ type: "activity", entry: clone(entry) });
  }

  private emit(event: AgentAdapterEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export interface AppAdapters {
  matrix: MatrixAdapter;
  github: GitHubAdapter;
  agent: AgentAdapter;
}

export function createMockAdapters(initial: AppSeedData = seedData): AppAdapters {
  return {
    matrix: new MockMatrixAdapter(initial),
    github: new MockGitHubAdapter(initial),
    agent: new MockAgentAdapter(initial),
  };
}

export const mockMatrixAdapter = new MockMatrixAdapter();
export const mockGitHubAdapter = new MockGitHubAdapter();
export const mockAgentAdapter = new MockAgentAdapter();

export const mockAdapters: AppAdapters = {
  matrix: mockMatrixAdapter,
  github: mockGitHubAdapter,
  agent: mockAgentAdapter,
};
