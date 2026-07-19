import { useEffect, useState, type CSSProperties } from 'react'

interface AvatarProps {
  name: string
  src?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  status?: 'online' | 'away' | 'offline' | 'working' | 'blocked'
  tone?: string
  isAgent?: boolean
}

const palette = ['#c9f775', '#f7b267', '#7cc8ff', '#f28fad', '#a8a1ff']

function initials(name: string) {
  const parts = name
    .split(/\s|[-_]/)
    .filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function toneFor(name: string) {
  const sum = [...name].reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return palette[sum % palette.length]
}

export function Avatar({
  name,
  src,
  size = 'md',
  status,
  tone,
  isAgent = false,
}: AvatarProps) {
  const style = { '--avatar-tone': tone ?? toneFor(name) } as CSSProperties
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [src])

  return (
    <span
      className={`avatar avatar--${size}${isAgent ? ' avatar--agent' : ''}`}
      style={style}
      title={name}
    >
      {src && !imageFailed ? (
        <img src={src} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span>{initials(name)}</span>
      )}
      {isAgent && (
        <svg className="avatar__agent-mark" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 2.5h6v7H3zM6 0v2.5M1.5 5.5H3M9 5.5h1.5" />
        </svg>
      )}
      {status && <i className={`avatar__status avatar__status--${status}`} />}
    </span>
  )
}
