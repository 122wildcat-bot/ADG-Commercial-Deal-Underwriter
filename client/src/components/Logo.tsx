interface Props {
  size?: number;
  className?: string;
  variant?: "dark" | "light";
}

/** ADG mark — CB Blue tile with the "ADG" wordmark in Celestial. */
export function Logo({ size = 36, className, variant = "dark" }: Props) {
  const bg = variant === "dark" ? "#012169" : "#ffffff";
  const fg = variant === "dark" ? "#418FDE" : "#012169";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-label="ADG"
    >
      <rect width="64" height="64" rx="12" fill={bg} />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontWeight={700}
        fontSize={22}
        fill={fg}
      >
        ADG
      </text>
    </svg>
  );
}
