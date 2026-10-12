'use client';

import type { ShipTypeDto } from '@darkbeacon/shared';
import { SearchPicker, type PickerOption } from '../../ui';
import { searchShips } from './data';
import { formatTonnes as tonnes } from './format';
import styles from './connection.module.css';

export type ShipOption = PickerOption & { ship: ShipTypeDto };

export const shipIcon = (typeId: number, size: 32 | 64 = 32) =>
  `https://images.evetech.net/types/${typeId}/icon?size=${size}`;

export function shipOption(ship: ShipTypeDto): ShipOption {
  return {
    key: String(ship.id),
    label: ship.name,
    detail: `${ship.group} · ${tonnes(ship.mass)}`,
    imageUrl: shipIcon(ship.id, 64),
    shape: 'rounded',
    ship,
  };
}

/**
 * Ships by name from the SDE (never an id), with the ships rollers use one click away before
 * anything is typed.
 */
export function ShipPicker({
  value,
  onChange,
  suggested,
  'aria-label': label,
}: {
  value: ShipOption | null;
  onChange(value: ShipOption | null): void;
  suggested?: readonly ShipTypeDto[];
  'aria-label'?: string;
}) {
  return (
    <div className={styles.shipPicker}>
      <SearchPicker<ShipOption>
        value={value}
        onChange={onChange}
        cacheKey={['ships']}
        placeholder="Search a ship: Megathron, Orca, Onyx…"
        aria-label={label ?? 'Ship'}
        search={async (q) => ({ options: (await searchShips(q)).map(shipOption) })}
        empty="No ship with that name"
      />
      {!value && suggested && suggested.length > 0 && (
        <div className={styles.suggested} role="group" aria-label="Ships rollers use">
          {suggested.map((ship) => (
            <button
              key={ship.id}
              type="button"
              className={styles.suggestion}
              onClick={() => onChange(shipOption(ship))}
            >
              <img src={shipIcon(ship.id)} alt="" width={16} height={16} />
              {ship.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
