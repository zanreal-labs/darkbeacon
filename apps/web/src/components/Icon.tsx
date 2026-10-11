const PATHS = {
  lock: 'M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z',
  note: 'M4 2h6l2 2v10H4zM6 7h4M6 10h4',
  eyeOff: 'M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4zM3 3l10 10',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM11 11l3 3',
  info: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7v4M8 5v0.5',
  signal: 'M2 12h2v2H2zM6 9h2v5H6zM10 6h2v8h-2zM14 3v11',
  users:
    'M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 3.5a2.5 2.5 0 0 1 0 4.5M12.5 10c1.3.6 2 1.9 2 4',
  puzzle: 'M3 5h3V3.5a1.5 1.5 0 0 1 3 0V5h3v3h-1.5a1.5 1.5 0 0 0 0 3H12v3H3z',
  settings:
    'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  paste: 'M5 3H3v11h10V3h-2M6 2h4v2H6z',
  chevron: 'M5 6l3 3 3-3',
} as const;

export type IconName = keyof typeof PATHS;

/** Small stroke icons drawn in the current text colour. */
export function Icon({ name, size = 14, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
