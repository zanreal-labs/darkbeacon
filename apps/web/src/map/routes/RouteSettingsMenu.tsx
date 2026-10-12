'use client';

import { SlidersHorizontal } from 'lucide-react';
import type {
  CharacterDto,
  RouteAvoidSpace,
  RouteMode,
  RoutePreferencesDto,
  RouteSkip,
  UpdateRoutePreferencesRequest,
} from '@darkbeacon/shared';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui';

const MODES: ReadonlyArray<{ mode: Exclude<RouteMode, 'pilot'>; label: string; short: string }> = [
  { mode: 'shortest', label: 'Shortest', short: 'Shortest' },
  { mode: 'safer', label: 'Safer: high-sec where it can', short: 'Safer' },
  { mode: 'highsec', label: 'High-sec only', short: 'High-sec only' },
  { mode: 'outlaw', label: 'No high-sec (outlaw)', short: 'No high-sec' },
];

/** Connections the route may use; unchecking one skips it. */
const HOLES: ReadonlyArray<{ skip: RouteSkip; label: string; short: string }> = [
  { skip: 'eol', label: 'End-of-life holes', short: 'EOL' },
  { skip: 'critical', label: 'Mass-critical holes', short: 'critical' },
  { skip: 'frigate', label: 'Frigate holes', short: 'frigate' },
  { skip: 'medium', label: 'Cruiser holes', short: 'cruiser' },
];

const AVOID_LINKS: ReadonlyArray<{ skip: RouteSkip; label: string; short: string }> = [
  { skip: 'dangerous', label: 'Dangerous connections and bridges', short: 'dangerous' },
  { skip: 'bubbled', label: 'Bubbled connections', short: 'bubbled' },
];

const AVOID_SPACE: ReadonlyArray<{ space: RouteAvoidSpace; label: string; short: string }> = [
  { space: 'wormholes', label: 'Wormholes (gates and bridges only)', short: 'wormholes' },
  { space: 'pochven', label: 'Pochven', short: 'Pochven' },
  { space: 'edencom', label: 'EDENCOM systems', short: 'EDENCOM' },
  { space: 'triglavian', label: 'Triglavian systems', short: 'Triglavian' },
];

/** One quiet line of what differs from the plain shortest route; null when nothing does. */
export function optionsSummary(p: RoutePreferencesDto): string | null {
  const parts: string[] = [];
  if (p.mode === 'pilot') parts.push('Safe for my security status');
  else if (p.mode !== 'shortest') parts.push(MODES.find((m) => m.mode === p.mode)!.short);
  const skipped = [...HOLES, ...AVOID_LINKS].filter((h) => p.skip.includes(h.skip)).map((h) => h.short);
  if (skipped.length > 0) parts.push(`no ${skipped.join(', ')}`);
  const avoided = AVOID_SPACE.filter((a) => p.avoidSpace.includes(a.space)).map((a) => a.short);
  if (avoided.length > 0) parts.push(`avoiding ${avoided.join(', ')}`);
  if (p.capital) parts.push('capital, no bridges');
  else if (!p.bridges) parts.push('no bridges');
  if (!p.thera) parts.push('no Thera');
  return parts.length > 0 ? parts.join(' · ') : null;
}

const toggle = <T,>(list: readonly T[], value: T, on: boolean): T[] =>
  on ? [...new Set([...list, value])] : list.filter((v) => v !== value);

/**
 * The route options, in the routes section's header: the mode, which holes and bridges count and
 * what to keep out of. They follow the viewer to every map and device.
 */
export function RouteSettingsMenu({
  preferences: p,
  characters,
  onChange,
}: {
  preferences: RoutePreferencesDto;
  characters: readonly CharacterDto[];
  onChange(patch: UpdateRoutePreferencesRequest): void;
}) {
  const keep = (e: Event) => e.preventDefault();
  const modeValue = p.mode === 'pilot' && p.characterId !== null ? `pilot:${p.characterId}` : p.mode;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="sm" label="Route options" tooltipSide="left" icon={<SlidersHorizontal />} />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Route</MenuLabel>
        <MenuRadioGroup
          value={modeValue}
          onValueChange={(value) => {
            if (value.startsWith('pilot:')) onChange({ mode: 'pilot', characterId: Number(value.slice(6)) });
            else onChange({ mode: value as RouteMode });
          }}
        >
          {MODES.map((m) => (
            <MenuRadioItem key={m.mode} value={m.mode} onSelect={keep}>
              {m.label}
            </MenuRadioItem>
          ))}
          {characters.map((c) => (
            <MenuRadioItem key={c.id} value={`pilot:${c.id}`} onSelect={keep}>
              Safe for {c.name}&apos;s security status
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Use</MenuLabel>
        {HOLES.map((h) => (
          <MenuCheckboxItem
            key={h.skip}
            checked={!p.skip.includes(h.skip)}
            onSelect={keep}
            onCheckedChange={(on) => onChange({ skip: toggle(p.skip, h.skip, on !== true) })}
          >
            {h.label}
          </MenuCheckboxItem>
        ))}
        <MenuCheckboxItem
          checked={p.thera}
          onSelect={keep}
          onCheckedChange={(on) => onChange({ thera: on === true })}
        >
          Thera and Turnur (EVE-Scout)
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={p.bridges}
          onSelect={keep}
          onCheckedChange={(on) => onChange({ bridges: on === true })}
        >
          Jump bridges of my alliance
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={p.capital}
          onSelect={keep}
          onCheckedChange={(on) => onChange({ capital: on === true })}
        >
          Flying a capital (no jump bridges)
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuLabel>Avoid</MenuLabel>
        {AVOID_LINKS.map((a) => (
          <MenuCheckboxItem
            key={a.skip}
            checked={p.skip.includes(a.skip)}
            onSelect={keep}
            onCheckedChange={(on) => onChange({ skip: toggle(p.skip, a.skip, on === true) })}
          >
            {a.label}
          </MenuCheckboxItem>
        ))}
        {AVOID_SPACE.map((a) => (
          <MenuCheckboxItem
            key={a.space}
            checked={p.avoidSpace.includes(a.space)}
            onSelect={keep}
            onCheckedChange={(on) => onChange({ avoidSpace: toggle(p.avoidSpace, a.space, on === true) })}
          >
            {a.label}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
