import type { CommunityChannelId } from './channels'

export type CommunityPostIntent = 'chat' | 'showcase' | 'needs_feedback' | 'update' | 'question'

export interface CommunityPostInput {
  text: string
  channelId?: CommunityChannelId
  intent?: CommunityPostIntent
  parentId?: string
  commentKind?: 'reply' | 'feedback'
  buildName?: string
  buildUrl?: string
  imageUrl?: string
}

export const COMMUNITY_INTENTS: Array<{ value: CommunityPostIntent; label: string; description: string }> = [
  { value: 'chat', label: 'Chat', description: 'A quick thought or conversation' },
  { value: 'showcase', label: 'Showcase', description: 'Progress, launch, or build update' },
  { value: 'needs_feedback', label: 'Feedback request', description: 'A specific ask for useful input' },
]
