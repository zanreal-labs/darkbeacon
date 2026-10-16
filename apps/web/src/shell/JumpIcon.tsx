import type { SVGProps } from 'react';

/**
 * The jump planner's icon: a jump drive's arc from one system to another, two systems joined
 * through space rather than by gates. Drawn on lucide's grid (24 px, 2 px round strokes, the
 * same r=2 end circles) so it sits in the rail with the other icons; not lucide's Orbit, whose
 * core and ring read as Darkbeacon's own mark at the top of the rail (and as planets elsewhere).
 */
export function JumpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-icon="jump"
      {...props}
    >
      <circle cx="5" cy="17" r="2" />
      <circle cx="19" cy="17" r="2" />
      <path d="M6.2 15.2C7.2 3.5 16.8 3.5 17.8 15.2" />
    </svg>
  );
}
