'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, LayoutList, Plus, Star, StarOff } from 'lucide-react';
import type { MapSummaryDto, MeDto } from '@darkbeacon/shared';
import { orderedMaps, useCachedData, useEnsureMaps, useSetDefaultMap } from '../lib/maps';
import { mapsKey, meKey } from '../lib/session-keys';
import { CreateMapDialog } from '../screens/HomePage';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  useToast,
} from '../ui';
import styles from './AppShell.module.css';

/** How many maps the switcher lists before "All maps". */
const LISTED = 8;

/**
 * The map name in the top bar, as a menu: the maps opened recently, a star for the map `/` opens,
 * All maps and New map. The maps list itself is only shown through All maps.
 */
export function MapSwitcher({ slug }: { slug: string }) {
  const router = useRouter();
  const toast = useToast();
  // The shell sits outside the page's HydrationBoundary: read what the page put in the cache.
  const maps = useCachedData<MapSummaryDto[]>(mapsKey);
  const me = useCachedData<MeDto | null>(meKey);
  const ensureMaps = useEnsureMaps();
  const star = useSetDefaultMap();
  const [creating, setCreating] = useState(false);
  const current = maps?.find((m) => m.slug === slug);
  const defaultId = me?.account.defaultMapId ?? null;
  const listed = orderedMaps(maps ?? [], me?.account.recentMapIds).slice(0, LISTED);
  const starred = current !== undefined && defaultId === current.id;

  return (
    <>
      <Menu onOpenChange={(open) => open && !maps && ensureMaps()}>
        <MenuTrigger className={styles.switcher} aria-label={`Map: ${current?.name ?? slug}. Switch map`}>
          <span className={styles.switcherName}>{current?.name ?? <Skeleton width={96} height={12} />}</span>
          {starred && <Star className={styles.switcherStar} aria-label="Your default map" />}
          <ChevronDown className={styles.switcherChevron} aria-hidden />
        </MenuTrigger>
        <MenuContent align="start" className={styles.switcherMenu}>
          <MenuLabel>Maps</MenuLabel>
          {listed.map((m) => (
            <MenuItem
              key={m.id}
              icon={m.id === current?.id ? <Check /> : <span className={styles.menuIconSpace} />}
              onSelect={() => m.id !== current?.id && router.push(`/m/${m.slug}`)}
            >
              <span className={styles.switcherItem}>
                <span>{m.name}</span>
                {m.id === defaultId && <Star className={styles.switcherStar} aria-label="default" />}
              </span>
            </MenuItem>
          ))}
          {current && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={starred ? <StarOff /> : <Star />}
                onSelect={() =>
                  star.mutate(starred ? null : current.id, {
                    onSuccess: () =>
                      toast({
                        title: starred ? 'No default map' : `${current.name} opens first`,
                        tone: 'success',
                      }),
                    onError: () => toast({ title: 'Could not change the default map', tone: 'danger' }),
                  })
                }
              >
                {starred ? 'Stop opening this map first' : 'Open this map first'}
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          <MenuItem icon={<LayoutList />} onSelect={() => router.push('/maps')}>
            All maps
          </MenuItem>
          <MenuItem icon={<Plus />} onSelect={() => setCreating(true)}>
            New map
          </MenuItem>
        </MenuContent>
      </Menu>
      <CreateMapDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
