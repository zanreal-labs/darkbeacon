import { Handshake } from 'lucide-react';
import { standingTone, type IntelEntityDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import type { MenuItem } from '../../components/ContextMenu';

/** The holder of a system and the viewer's standing towards it, for the system menu. */
export interface HolderStanding {
  holder: IntelEntityDto;
  standing: number | null;
  /** The viewer set it by hand (it wins over contacts). */
  overridden: boolean;
  set(standing: number | null): void;
}

const CHOICES: Array<{ value: number; label: string }> = [
  { value: 10, label: 'Excellent (+10)' },
  { value: 5, label: 'Good (+5)' },
  { value: 0, label: 'Neutral (0)' },
  { value: -5, label: 'Bad (-5)' },
  { value: -10, label: 'Terrible (-10)' },
];

/** "Holder standing ▸": set one's own standing towards the alliance holding the system. */
export function holderStandingMenu(h: HolderStanding): MenuItem {
  const name = h.holder.ticker ? `[${h.holder.ticker}]` : (h.holder.name ?? 'the holder');
  return {
    kind: 'submenu',
    label: `Standing towards ${name}`,
    icon: <Handshake />,
    hint: h.standing === null ? undefined : `${h.standing > 0 ? '+' : ''}${h.standing}`,
    hintSwatch: h.standing === null ? undefined : { color: cssVar(`standing-${standingTone(h.standing)}`) },
    items: [
      ...CHOICES.map((c): MenuItem => ({
        kind: 'radio',
        label: c.label,
        checked: h.overridden && h.standing === c.value,
        swatch: { color: cssVar(`standing-${standingTone(c.value)}`) },
        onSelect: () => h.set(c.value),
      })),
      ...(h.overridden
        ? [
            { kind: 'separator' } satisfies MenuItem,
            {
              kind: 'action',
              label: 'Use my contacts again',
              onSelect: () => h.set(null),
            } satisfies MenuItem,
          ]
        : []),
    ],
  };
}
