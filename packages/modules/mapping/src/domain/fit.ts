import type { FitMassDto, ShipTypeDto } from '@darkbeacon/shared';

/** An item that changes a fitted ship's mass (see the SDE dataset's `fitItems`). */
export interface FitItem {
  name: string;
  /** kg added (plates, subsystems; prop modules only while they run). */
  add?: number;
  /** `massBonusPercentage`: Higgs Anchor +100, mass entangler -80. */
  percent?: number;
  prop?: true;
}

export interface ParsedFit {
  shipName: string;
  fitName: string | null;
  /** Fitted items by name, once per fitted module (cargo, drones and offline modules left out). */
  items: string[];
}

/**
 * Reads a fit as the game copies it (EFT): `[Ship, Name]` on the first line, then one fitted item
 * per line, `Item, Charge` for loaded modules, `[Empty … slot]` for empty ones; cargo and drones
 * come as `Item x3` and do not count, nor do modules marked `/OFFLINE`. Null when it is not a fit.
 */
export function parseFit(text: string): ParsedFit | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const head = /^\[([^,\]]+)(?:,\s*([^\]]*))?\]$/.exec(lines[0] ?? '');
  if (!head) return null;
  const items: string[] = [];
  for (const line of lines.slice(1)) {
    if (/^\[empty .*slot\]$/i.test(line)) continue;
    if (/\sx\d+$/i.test(line)) continue;
    if (/\/offline$/i.test(line)) continue;
    const name = line.split(',')[0]!.trim();
    if (name) items.push(name);
  }
  return { shipName: head[1]!.trim(), fitName: head[2]?.trim() || null, items };
}

/**
 * The jump mass of a fitted ship, as dogma has it: hull plus every always-on addition (plates,
 * subsystems), scaled by the rigs that change mass (Higgs Anchor); hot adds the largest prop
 * module (only one runs). A mass entangler is an active module, on only when someone switches it
 * on, so it is left out here (the rolling planner and "Log a jump" offer it separately).
 */
export function weighFit(
  ship: Pick<ShipTypeDto, 'mass'>,
  items: readonly FitItem[],
): { cold: number; hot: number; prop: string | null } {
  let base = ship.mass;
  let factor = 1;
  let prop: FitItem | null = null;
  for (const item of items) {
    if (item.prop) {
      if (!prop || (item.add ?? 0) > (prop.add ?? 0)) prop = item;
      continue;
    }
    base += item.add ?? 0;
    if (item.percent && item.percent > 0) factor *= 1 + item.percent / 100;
  }
  return {
    cold: Math.round(base * factor),
    hot: Math.round((base + (prop?.add ?? 0)) * factor),
    prop: prop?.name ?? null,
  };
}

/** A pasted fit weighed with the catalog's ships and items; null when the ship is unknown. */
export function fitMass(
  text: string,
  lookup: { shipByName(name: string): ShipTypeDto | null; fitItem(name: string): FitItem | null },
): FitMassDto | null {
  const parsed = parseFit(text);
  if (!parsed) return null;
  const ship = lookup.shipByName(parsed.shipName);
  if (!ship) return null;
  const found = parsed.items.flatMap((name) => lookup.fitItem(name) ?? []);
  const { cold, hot, prop } = weighFit(ship, found);
  return {
    ship,
    name: parsed.fitName,
    cold,
    hot,
    prop,
    counted: found.map((i) => i.name),
    higgs: found.some((i) => (i.percent ?? 0) > 0),
  };
}
