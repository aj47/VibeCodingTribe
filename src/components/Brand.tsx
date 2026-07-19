interface BrandProps {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className="brand" aria-label="VibeCodingTribe">
      <svg
        className="brand__mark"
        viewBox="0 0 36 36"
        aria-hidden="true"
      >
        <path d="M7 9.5 18 4l11 5.5v10.25L18 32 7 25.5Z" />
        <path d="m12 14 6 3.25L24 14M18 17.25V25" />
        <circle cx="7" cy="9.5" r="2" />
        <circle cx="29" cy="9.5" r="2" />
        <circle cx="18" cy="32" r="2" />
      </svg>
      {!compact && (
        <span className="brand__wordmark">
          VibeCoding<span>Tribe</span>
        </span>
      )}
    </div>
  )
}
