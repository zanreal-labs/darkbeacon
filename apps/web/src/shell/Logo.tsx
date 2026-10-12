/** The Wormwright mark: a wormhole seen edge-on, drawn in the accent colour. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.25" stroke="var(--ww-color-accent)" strokeWidth="1.5" opacity="0.35" />
      <ellipse cx="12" cy="12" rx="9.25" ry="4" stroke="var(--ww-color-accent)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.25" fill="var(--ww-color-accent)" />
    </svg>
  );
}
