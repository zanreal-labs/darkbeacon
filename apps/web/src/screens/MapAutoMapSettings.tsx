'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  buildPath,
  DEFAULT_EXCLUDED_SYSTEMS,
  routes,
  type AutoMapRulesDto,
  type MapDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { useUniverseSystems } from '../lib/universe';
import {
  Card,
  CardBody,
  CardHeader,
  ChoiceGroup,
  Field,
  IconButton,
  SearchPicker,
  Switch,
  useToast,
  type PickerOption,
} from '../ui';
import styles from './settings.module.css';

type SystemOption = PickerOption & { system: UniverseSystemDto };

const searchSystems = async (text: string) => {
  const found = await api<UniverseSystemDto[]>(
    `${routes.universe.searchSystems.path}?${new URLSearchParams({ q: text, limit: '8' })}`,
  );
  return {
    options: found.map((system) => ({
      key: String(system.id),
      label: system.name,
      detail: system.regionName,
      system,
    })),
  };
};

/**
 * How auto-mapping treats jumps, next to its scopes in General: systems it never adds, whether a
 * known-space jump needs both ends in scope (Wanderer) or one (Darkbeacon's default), and whether
 * a jump through a known Ansiblex is drawn as a bridge. Changes apply at once.
 */
export function MapAutoMapSettings({ map }: { map: MapDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const rules = map.settings.autoMap ?? {};
  const excluded = rules.excludedSystems ?? DEFAULT_EXCLUDED_SYSTEMS;
  const names = useUniverseSystems(excluded);
  const save = useMutation({
    mutationFn: (autoMap: AutoMapRulesDto) =>
      api<MapDto>(buildPath(routes.maps.update.path, { mapId: map.id }), {
        method: 'PATCH',
        json: { settings: { autoMap } },
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['map', next.slug], next);
      toast({ title: 'Auto-mapping saved', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not save',
        description: error instanceof ApiError ? error.message : 'Network error',
        tone: 'danger',
      }),
  });
  const change = (patch: AutoMapRulesDto) => save.mutate({ ...rules, ...patch });

  return (
    <>
      <Card>
        <CardHeader
          title="Systems never added"
          description="Auto-mapping skips jumps into or out of these systems. Abyssal space is always left out."
        />
        <CardBody>
          <div className={styles.formStack}>
            {excluded.length === 0 ? (
              <p className="muted">None: every system in scope is mapped.</p>
            ) : (
              <ul className={styles.chips}>
                {excluded.map((id) => (
                  <li key={id} className={styles.chip}>
                    <span>{names.get(id)?.name ?? id}</span>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Map ${names.get(id)?.name ?? 'this system'} again`}
                      icon={<X />}
                      disabled={save.isPending}
                      onClick={() => change({ excludedSystems: excluded.filter((x) => x !== id) })}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Field label="Leave out another system">
              <SearchPicker<SystemOption>
                aria-label="Leave out a system"
                placeholder="System name…"
                minLength={2}
                value={null}
                cacheKey={['automap-exclude']}
                empty="No system by that name"
                search={searchSystems}
                disabled={save.isPending}
                onChange={(picked) =>
                  picked &&
                  !excluded.includes(picked.system.id) &&
                  change({ excludedSystems: [...excluded, picked.system.id] })
                }
              />
            </Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Jumps in known space"
          description="With wormhole space in scope, a jump between two known-space systems that no stargate links went through a wormhole and is always mapped."
        />
        <CardBody>
          <div className={styles.formStack}>
            <ChoiceGroup
              aria-label="Known-space jumps"
              value={rules.gateRule ?? 'either'}
              onValueChange={(gateRule) => change({ gateRule: gateRule as 'either' | 'both' })}
              disabled={save.isPending}
              options={[
                {
                  value: 'either',
                  label: 'Either end in scope',
                  description: 'Leaving the chain into known space shows the system you came out in.',
                },
                {
                  value: 'both',
                  label: 'Both ends in scope',
                  description: 'As in Wanderer: a stargate jump is mapped only between systems in scope.',
                },
              ]}
            />
            <Switch
              checked={rules.typeBridges ?? true}
              disabled={save.isPending}
              onCheckedChange={(typeBridges) => change({ typeBridges })}
              label="Draw jumps through known jump bridges as bridges"
              description="Uses the map's Ansiblex list (Bridges); otherwise they are drawn as wormholes, as in Wanderer."
            />
          </div>
        </CardBody>
      </Card>
    </>
  );
}
