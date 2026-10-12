'use client';

import { Link2, Unlink } from 'lucide-react';
import type { ConnectionDto, SignatureDto, UniverseSystemDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui';
import { systemClass } from '../../lib/universe';
import { leadsToChoices } from './facts';
import styles from './signatures.module.css';

/**
 * "Leads to" in a signature row: the systems connected to this one that the hole can lead to
 * (by its type or destination). Picking one links the signature to that connection, which also
 * fills the `{sig}` bookmark label of that system.
 */
export function LeadsToMenu({
  signature,
  connections,
  universe,
  systemName,
  onLink,
  linkedTo,
}: {
  signature: SignatureDto;
  connections: Map<string, ConnectionDto>;
  universe: Map<number, UniverseSystemDto>;
  systemName(solarSystemId: number): string;
  onLink(connectionId: string | null): void;
  /** The system it leads to now, if linked. */
  linkedTo: number | null;
}) {
  const choices = leadsToChoices(signature, connections.values(), universe);
  const fitting = choices.filter((c) => c.fits);
  const others = choices.filter((c) => !c.fits);
  const item = (c: (typeof choices)[number]) => {
    const pill = systemClass(universe.get(c.systemId));
    return (
      <MenuItem
        key={c.connection.id}
        disabled={c.connection.id === signature.connectionId}
        onSelect={() => onLink(c.connection.id)}
      >
        <span className={styles.leadsOption}>
          <span style={{ color: cssVar(pill.token) }}>{pill.label}</span>
          {systemName(c.systemId)}
        </span>
      </MenuItem>
    );
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={styles.linkButton}
          data-linked={linkedTo !== null || undefined}
          aria-label={`Link ${signature.eveId} to a connection`}
          title={linkedTo === null ? 'Link to the connection it leads through' : 'Change the link'}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Link2 aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Leads to</MenuLabel>
        {choices.length === 0 && <MenuItem disabled>No connection from this system yet</MenuItem>}
        {fitting.map(item)}
        {others.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Other classes</MenuLabel>
            {others.map(item)}
          </>
        )}
        {signature.connectionId && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Unlink />} onSelect={() => onLink(null)}>
              Unlink
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
