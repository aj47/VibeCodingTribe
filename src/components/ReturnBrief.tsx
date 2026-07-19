import {
  Bot,
  Check,
  ChevronDown,
  GitPullRequest,
  Lightbulb,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { ReturnSummary, ReturnSummaryBulletKind } from '../domain/types'

interface ReturnBriefProps {
  summary: ReturnSummary
  isHandled: boolean
  onDismiss: () => void
  onRegenerate: () => void
  onMarkHandled: () => void
  onShowHistory: () => void
  onJumpToEvent: (eventId: string) => void
}

const bulletMeta: Record<
  ReturnSummaryBulletKind,
  { label: string; icon: typeof Lightbulb }
> = {
  decision: { label: 'Decision', icon: Lightbulb },
  agent: { label: 'Agent', icon: Bot },
  github: { label: 'GitHub', icon: GitPullRequest },
  request: { label: 'Request', icon: MessageCircleQuestion },
  blocker: { label: 'Blocker', icon: TriangleAlert },
}

export function ReturnBrief({
  summary,
  isHandled,
  onDismiss,
  onRegenerate,
  onMarkHandled,
  onShowHistory,
  onJumpToEvent,
}: ReturnBriefProps) {
  if (summary.dismissedAt) return null

  return (
    <section className={`return-brief return-brief--${summary.status}`} aria-label="Return brief">
      <div className="return-brief__heading">
        <span className="return-brief__icon"><Sparkles size={15} /></span>
        <div>
          <h2>While you were away</h2>
          <p>{summary.timeSinceLastVisitLabel} · {summary.newMessageCount} new messages</p>
        </div>
        <span className="return-brief__generated">AI brief · grounded in this room</span>
        <button className="icon-button" type="button" onClick={onDismiss} aria-label="Dismiss return brief">
          <X size={16} />
        </button>
      </div>

      {summary.status === 'generating' ? (
        <div className="return-brief__loading">
          <span /> <span /> <span />
          Rebuilding your return brief…
        </div>
      ) : summary.status === 'error' ? (
        <div className="return-brief__error">
          <TriangleAlert size={16} />
          <span>The brief could not be refreshed. Your unread messages are still here.</span>
          <button className="button button--small button--secondary" type="button" onClick={onRegenerate}>
            Retry
          </button>
        </div>
      ) : (
        <div className="return-brief__bullets">
          {summary.bullets.map((bullet) => {
            const meta = bulletMeta[bullet.kind]
            const Icon = meta.icon
            const content = (
              <>
                <span className={`brief-kind brief-kind--${bullet.kind}`}>
                  <Icon size={12} /> {meta.label}
                </span>
                <span>{bullet.text}</span>
              </>
            )
            return bullet.sourceEventId ? (
              <button key={bullet.id} type="button" onClick={() => onJumpToEvent(bullet.sourceEventId!)}>
                {content}
              </button>
            ) : (
              <div key={bullet.id}>{content}</div>
            )
          })}
        </div>
      )}

      <div className="return-brief__actions">
        <button className="button button--small button--ghost" type="button" onClick={onShowHistory}>
          <ChevronDown size={13} /> Show full history
        </button>
        <span />
        <button
          className="button button--small button--ghost"
          type="button"
          onClick={onRegenerate}
          disabled={summary.status === 'generating'}
        >
          <RefreshCw size={12} /> Regenerate
        </button>
        <button
          className="button button--small button--secondary"
          type="button"
          onClick={onMarkHandled}
          disabled={isHandled}
        >
          <Check size={12} /> {isHandled ? 'Handled' : 'Mark handled'}
        </button>
      </div>
    </section>
  )
}
