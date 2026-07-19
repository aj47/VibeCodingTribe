import { describe, expect, it } from 'vitest'
import { CURRENT_USER_PARTICIPANT_ID, SELECTED_CONVERSATION_ID } from '../data/seed'
import type { AgentAdapterEvent, MatrixAdapterEvent } from './adapters'
import { createMockAdapters } from './adapters'

describe('mock adapters', () => {
  it('sends, publishes, and searches a message deterministically', async () => {
    const { matrix } = createMockAdapters()
    const events: MatrixAdapterEvent[] = []
    const unsubscribe = matrix.subscribe((event) => events.push(event))

    const message = await matrix.sendMessage({
      conversationId: SELECTED_CONVERSATION_ID,
      text: 'Unique Release Nebula',
      mentionedParticipantIds: ['participant-maya'],
    })

    expect(message).toMatchObject({
      id: 'matrix-local-event-0002',
      conversationId: SELECTED_CONVERSATION_ID,
      senderId: CURRENT_USER_PARTICIPANT_ID,
      sentAt: '2026-07-18T18:00:01.000Z',
      deliveryState: 'sent',
      kind: 'human',
      content: {
        text: 'Unique Release Nebula',
        mentionedParticipantIds: ['participant-maya'],
      },
    })
    expect(events.map((event) => event.type)).toEqual([
      'conversation-updated',
      'message',
    ])

    await expect(matrix.searchMessages(SELECTED_CONVERSATION_ID, ' release NEBULA ')).resolves.toEqual([
      message,
    ])
    await expect(matrix.searchMessages(SELECTED_CONVERSATION_ID, '   ')).resolves.toEqual([])

    const conversation = await matrix.getConversation(SELECTED_CONVERSATION_ID)
    expect(conversation?.lastMessagePreview).toBe('Unique Release Nebula')
    expect(conversation?.lastMessageAt).toBe(message.sentAt)

    unsubscribe()
  })

  it('resolves an approval, updates its agent, and permits the scoped GitHub write', async () => {
    const { agent, github } = createMockAdapters()
    const events: AgentAdapterEvent[] = []
    agent.subscribe((event) => events.push(event))

    const approval = await agent.resolveApproval(
      'approval-forge-create-branch',
      'approved',
      CURRENT_USER_PARTICIPANT_ID,
    )

    expect(approval).toMatchObject({
      status: 'approved',
      resolvedAt: '2026-07-18T18:20:01.000Z',
      resolvedByParticipantId: CURRENT_USER_PARTICIPANT_ID,
    })
    await expect(agent.getSession(approval.agentSessionId)).resolves.toMatchObject({
      status: 'working',
      statusDetail: 'Approval granted; ready to continue',
      lastActivity: approval.resolvedAt,
    })
    expect(events.map((event) => event.type)).toEqual([
      'activity',
      'approval-updated',
      'session-updated',
    ])

    await expect(
      github.performWrite(
        {
          action: 'create-branch',
          repositoryId: 'repo-vibecodingtribe',
          payload: { branch: 'fix/oauth-callback-lock' },
        },
        approval,
      ),
    ).resolves.toEqual({
      id: 'github-write-0001',
      action: 'create-branch',
      status: 'completed',
      url: 'https://github.com/vibecodingtribe/vibecodingtribe/tree/fix/oauth-callback-lock',
      completedAt: '2026-07-18T18:10:02.000Z',
    })
  })

  it('runs a deterministic agent session through completion', async () => {
    const { agent } = createMockAdapters()
    const session = await agent.invoke({
      agentId: 'agent-scout',
      conversationId: SELECTED_CONVERSATION_ID,
      task: 'Summarize the launch blockers',
      continuousListening: true,
    })

    expect(session).toMatchObject({
      id: 'agent-session-0002',
      status: 'working',
      startedAt: '2026-07-18T18:20:01.000Z',
      continuousListening: true,
    })
    expect(session.permissions).toContain('continuous-listening')

    const chunks = []
    for await (const chunk of agent.stream(session.id)) chunks.push(chunk)

    expect(chunks.map(({ id, index, kind, status }) => ({ id, index, kind, status }))).toEqual([
      { id: 'agent-stream-chunk-0006', index: 0, kind: 'status', status: 'working' },
      { id: 'agent-stream-chunk-0008', index: 1, kind: 'text', status: 'working' },
      { id: 'agent-stream-chunk-0010', index: 2, kind: 'done', status: 'completed' },
    ])
    await expect(agent.getSession(session.id)).resolves.toMatchObject({
      status: 'completed',
      statusDetail: 'The mock run completed without external side effects.',
      completedAt: '2026-07-18T18:20:09.000Z',
    })
  })
})
