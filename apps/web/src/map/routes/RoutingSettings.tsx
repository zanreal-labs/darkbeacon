'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudDownload, Network, Star, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import {
  buildPath,
  routes,
  type BridgeDto,
  type ImportBridgesResultDto,
  type MapDto,
  type TheraDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { useMe } from '../../lib/session';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Row,
  Rows,
  SearchPicker,
  Select,
  Switch,
  Textarea,
  useToast,
  type PickerOption,
} from '../../ui';
import { shownSecurity } from '../nodeFacts';
import { routeKeys, useHubs, useHubToggle, useMapRoutingSettings } from './api';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

interface SystemOption extends PickerOption {
  system: UniverseSystemDto;
}

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
 * Map settings, Routes: the map's hubs (everyone on the map sees the route to each from the
 * selected system) and whether EVE-Scout's Thera and Turnur holes count in its routes.
 */
export function RoutesSettings({ map, can }: { map: MapDto; can: MapPermissions }) {
  const toast = useToast();
  const hubs = useHubs(map.id);
  const toggle = useHubToggle(map.id, toast);
  const { settings, save } = useMapRoutingSettings(map.id);
  const thera = useQuery({
    queryKey: ['eve-scout'],
    queryFn: () => api<TheraDto>(routes.routing.eveScout.path),
    staleTime: 60_000,
  });
  const list = hubs.data?.map ?? [];
  const holes = thera.data?.connections ?? [];
  return (
    <>
      <Card>
        <CardHeader
          title="Map hubs"
          description="Everyone on the map sees the route from the selected system to each of these, in the Routes section of the system panel. Members may change them; each person also keeps hubs of their own."
          actions={<Badge>{`${list.length} of 20`}</Badge>}
        />
        <CardBody flush>
          {list.length === 0 ? (
            <EmptyState
              compact
              icon={<Star />}
              title="No map hubs yet"
              description="Add the staging system, your market or a home in known space."
            />
          ) : (
            <Rows>
              {list.map((hub) => (
                <Row
                  key={hub.solarSystemId}
                  title={hub.name}
                  meta={`Security ${shownSecurity(hub.security).toFixed(1)}`}
                  actions={
                    can.edit && (
                      <IconButton
                        size="sm"
                        label={`Remove ${hub.name}`}
                        icon={<X />}
                        onClick={() => void toggle('map', hub, false)}
                      />
                    )
                  }
                />
              ))}
            </Rows>
          )}
        </CardBody>
        {can.edit && list.length < 20 && (
          <CardBody>
            <Field label="Add a hub">
              <SearchPicker<SystemOption>
                aria-label="Add a map hub"
                placeholder="System name…"
                minLength={2}
                value={null}
                cacheKey={['hub-search']}
                empty="No system by that name"
                search={searchSystems}
                onChange={(picked) =>
                  picked &&
                  void toggle('map', { solarSystemId: picked.system.id, name: picked.system.name }, true)
                }
              />
            </Field>
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Thera and Turnur"
          description="Public holes from EVE-Scout, read every five minutes. People may still leave them out of their own routes."
        />
        <CardBody className={styles.stack}>
          <Switch
            checked={settings?.thera ?? true}
            disabled={!settings || save.isPending}
            onCheckedChange={(on) =>
              save.mutate(
                { thera: on },
                { onError: (e) => toast({ title: errorText(e, 'Not saved'), tone: 'danger' }) },
              )
            }
            label="Route through Thera and Turnur"
            description="In the routes of this map and in its way home."
          />
          <p className={styles.note}>
            {thera.data?.fetchedAt
              ? `${holes.filter((h) => h.hub === 'thera').length} Thera and ${holes.filter((h) => h.hub === 'turnur').length} Turnur holes, read ${relativeTime(thera.data.fetchedAt)}.`
              : 'EVE-Scout has not answered yet.'}
          </p>
        </CardBody>
      </Card>
    </>
  );
}

/**
 * Map settings, Bridges: the Ansiblex jump bridges this map routes over. Pasted from the in-game
 * structure browser or read from a corporation's structures through ESI; flagged dangerous or
 * removed by the map's managers.
 */
export function BridgesSettings({ map }: { map: MapDto }) {
  const toast = useToast();
  const client = useQueryClient();
  const me = useMe();
  const key = ['bridges', map.id] as const;
  const bridges = useQuery({
    queryKey: key,
    queryFn: () => api<BridgeDto[]>(buildPath(routes.bridges.list.path, { mapId: map.id })),
  });
  const [text, setText] = useState('');
  const [dangerous, setDangerous] = useState(false);
  const [result, setResult] = useState<ImportBridgesResultDto | null>(null);
  const [clearing, setClearing] = useState(false);
  const characters = me.data?.characters ?? [];
  const [characterId, setCharacterId] = useState<number | null>(null);
  const reader = characterId ?? characters[0]?.id ?? null;

  const done = (r: ImportBridgesResultDto) => {
    setResult(r);
    client.setQueryData(key, r.bridges);
    void client.invalidateQueries({ queryKey: routeKeys.all(map.id) });
  };
  const paste = useMutation({
    mutationFn: () =>
      api<ImportBridgesResultDto>(buildPath(routes.bridges.paste.path, { mapId: map.id }), {
        method: 'POST',
        json: { text, dangerous },
      }),
    onSuccess: (r) => {
      done(r);
      if (r.added > 0 || r.known > 0) setText('');
    },
  });
  const readEsi = useMutation({
    mutationFn: () =>
      api<ImportBridgesResultDto>(buildPath(routes.bridges.readFromEsi.path, { mapId: map.id }), {
        method: 'POST',
        json: { characterId: reader },
      }),
    onSuccess: done,
  });
  const flag = useMutation({
    mutationFn: (b: BridgeDto) =>
      api<BridgeDto>(buildPath(routes.bridges.update.path, { mapId: map.id, bridgeId: b.id }), {
        method: 'PATCH',
        json: { dangerous: !b.dangerous },
      }),
    onSuccess: (b) => {
      client.setQueryData<BridgeDto[]>(key, (list) => list?.map((x) => (x.id === b.id ? b : x)));
      void client.invalidateQueries({ queryKey: routeKeys.all(map.id) });
    },
    onError: (e) => toast({ title: errorText(e, 'Not changed'), tone: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: (b: BridgeDto) =>
      api<void>(buildPath(routes.bridges.remove.path, { mapId: map.id, bridgeId: b.id }), {
        method: 'DELETE',
      }),
    onSuccess: (_v, b) => {
      client.setQueryData<BridgeDto[]>(key, (list) => list?.filter((x) => x.id !== b.id));
      void client.invalidateQueries({ queryKey: routeKeys.all(map.id) });
    },
    onError: (e) => toast({ title: errorText(e, 'Not removed'), tone: 'danger' }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) paste.mutate();
  };
  const list = bridges.data ?? [];
  const error = paste.error ?? readEsi.error;

  return (
    <>
      <Card>
        <form onSubmit={submit} aria-label="Import jump bridges">
          <CardHeader
            title="Jump bridges"
            description="Ansiblex bridges this map routes over. Paste them from the structure browser in game (or any list like UALX-3 » 1DQ1-A, one per line), or read your corporation's from EVE."
          />
          <CardBody className={styles.stack}>
            <Field label="Paste the list">
              <Textarea
                rows={6}
                value={text}
                placeholder={'UALX-3 » 1DQ1-A - Home Bridge\nT5ZI-S -> 1DQ1-A'}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <Checkbox
              checked={dangerous}
              onCheckedChange={(on) => setDangerous(on === true)}
              label="Mark everything in this paste as dangerous"
            />
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                icon={<Upload />}
                loading={paste.isPending}
                disabled={!text.trim()}
              >
                Import
              </Button>
              {characters.length > 1 && (
                <span className={styles.reader}>
                  <Select
                    size="sm"
                    aria-label="Character to read with"
                    value={String(reader ?? '')}
                    options={characters.map((c) => ({ value: String(c.id), label: c.name }))}
                    onValueChange={(v) => setCharacterId(Number(v))}
                  />
                </span>
              )}
              <Button
                icon={<CloudDownload />}
                loading={readEsi.isPending}
                disabled={reader === null}
                onClick={() => readEsi.mutate()}
              >
                Read from EVE
              </Button>
            </div>
            {error && (
              <Callout tone="danger">{errorText(error, 'The bridges could not be imported.')}</Callout>
            )}
            {result && !error && <ImportResult result={result} />}
          </CardBody>
        </form>
      </Card>
      <Card>
        <CardHeader
          title={`On this map: ${list.length}`}
          description="Routes use a bridge only for pilots of the alliance holding sovereignty where it stands, and never for capitals. Routes that avoid dangerous connections leave dangerous bridges out."
          actions={
            list.length > 0 && (
              <Button size="sm" variant="danger-ghost" icon={<Trash2 />} onClick={() => setClearing(true)}>
                Remove all
              </Button>
            )
          }
        />
        <CardBody flush>
          {list.length === 0 ? (
            <EmptyState
              compact
              icon={<Network />}
              title="No bridges yet"
              description="Imported bridges count in every route of this map, as one jump."
            />
          ) : (
            <Rows>
              {list.map((b) => (
                <Row
                  key={b.id}
                  title={`${b.a.name} » ${b.b.name}`}
                  meta={[
                    b.a.regionName === b.b.regionName
                      ? b.a.regionName
                      : `${b.a.regionName} » ${b.b.regionName}`,
                    b.source === 'esi' ? 'read from EVE' : 'pasted',
                    b.structureName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant={b.dangerous ? 'danger-ghost' : 'ghost'}
                        icon={b.dangerous ? <TriangleAlert /> : undefined}
                        aria-pressed={b.dangerous}
                        onClick={() => flag.mutate(b)}
                      >
                        {b.dangerous ? 'Dangerous' : 'Safe'}
                      </Button>
                      <IconButton
                        size="sm"
                        label={`Remove ${b.a.name} » ${b.b.name}`}
                        icon={<X />}
                        onClick={() => remove.mutate(b)}
                      />
                    </>
                  }
                />
              ))}
            </Rows>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Remove every bridge?"
        description={`All ${list.length} bridges leave this map's routes. You can import them again.`}
        confirmLabel="Remove all"
        tone="danger"
        onConfirm={async () => {
          await api<void>(buildPath(routes.bridges.clear.path, { mapId: map.id }), { method: 'DELETE' });
          client.setQueryData(key, []);
          void client.invalidateQueries({ queryKey: routeKeys.all(map.id) });
        }}
      />
    </>
  );
}

function ImportResult({ result }: { result: ImportBridgesResultDto }) {
  const parts = [
    result.added > 0 ? `${result.added} new` : null,
    result.known > 0 ? `${result.known} already known` : null,
  ].filter(Boolean);
  return (
    <Callout tone={result.added > 0 ? 'success' : 'neutral'}>
      {parts.length > 0 ? `Imported: ${parts.join(', ')}.` : 'Nothing to import.'}
      {result.unknownSystems.length > 0 && ` Unknown systems: ${result.unknownSystems.join(', ')}.`}
      {result.unreadable.length > 0 && (
        <ul className={styles.problems}>
          {result.unreadable.slice(0, 8).map((u, i) => (
            <li key={i}>
              {u.line > 0 ? `Line ${u.line}: ` : ''}
              {u.text}: {u.reason}
            </li>
          ))}
          {result.unreadable.length > 8 && <li>and {result.unreadable.length - 8} more</li>}
        </ul>
      )}
    </Callout>
  );
}
