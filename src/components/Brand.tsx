interface BrandProps {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <a className="brand" href="/" aria-label="VibeCodingTribe home">
      <svg
        className="brand__mark"
        viewBox="0 0 36 36"
        aria-hidden="true"
      >
        <path d="M8 9 18 25 28 9" />
        <circle cx="8" cy="9" r="4.2" />
        <circle cx="28" cy="9" r="4.2" />
        <circle cx="18" cy="25" r="4.2" />
      </svg>
      {!compact && (
        <span className="brand__wordmark">
          VibeCoding<span>Tribe</span>
        </span>
      )}
    </a>
  )
}
