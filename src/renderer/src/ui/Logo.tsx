// 标志：圆环里一个 π（oh-my-pi），只用强调色描线。临时版，正式名定了再画正式版（direction-2.6 §5.5）。
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      stroke="var(--accent)"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="logo"
    >
      <circle cx="11" cy="11" r="8.5" strokeWidth="2" />
      <path d="M7 8.8h8M9 8.8v6M13 8.8v5.2q0 1.2 1.2 1.2" strokeWidth="1.5" />
    </svg>
  );
}
