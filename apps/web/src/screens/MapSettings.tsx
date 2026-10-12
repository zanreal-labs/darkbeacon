'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Bookmark,
  Building2,
  Copy,
  Flag,
  Globe,
  Hash,
  KeyRound,
  Lock,
  Network,
  Plus,
  Radar,
  Send,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  TriangleAlert,
  Type,
  UserRound,
  Webhook,
  X,
} from 'lucide-react';
import {
  AccountPicker,
  BotHint,
  EvePicker,
  GuildSelect,
  RoleSelect,
  type AccountOption,
  type EveOption,
} from '../components/pickers';
import { useInstance } from '../lib/maps';
import { useMe } from '../lib/session';
import { DiscordNotifications } from './MapNotifications';
import { MapPublicLinkSettings } from './MapPublicLink';
import { MapSharing } from './MapSharing';
import {
  AccessSubjectKind,
  buildPath,
  MapRole,
  MapScope,
  routes,
  type AccessRuleDto,
  type CreateAccessRuleRequest,
  type CreatedWebhookDto,
  type LabelDto,
  type MapDto,
  type SystemLabelDto,
  type UpdateMapRequest,
  type WebhookDeliveryDto,
  type WebhookDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { mapSettingsHref, mapSettingsSections, type MapSettingsSection } from '../lib/map-settings';
import { mapPermissions, type MapPermissions } from '../lib/roles';
import { relativeTime } from '../lib/time';
import { track } from '../lib/telemetry';
import { useMapSettings } from '../lib/useMapSettings';
import { BookmarkLabelSettings } from '../map/BookmarkSettings';
import { PluginSlot } from '../plugins/PluginSlot';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogSheet,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  SkeletonRows,
  Stack,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  useToast,
} from '../ui';
import { SignatureRetention } from './SignatureRetention';
import dialog from './MapSettings.module.css';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

interface Section {
  id: MapSettingsSection;
  title: string;
  icon: ReactNode;
  render(map: MapDto, can: MapPermissions): ReactNode;
}

const SECTIONS: readonly Section[] = [
  {
    id: 'general',
    title: 'General',
    icon: <Settings2 />,
    render: (map) => <GeneralSettings map={map} />,
  },
  {
    id: 'access',
    title: 'Access',
    icon: <ShieldCheck />,
    render: (map) => (
      <Pane>
        <AccessRules map={map} />
      </Pane>
    ),
  },
  {
    id: 'sharing',
    title: 'Sharing',
    icon: <Network />,
    render: (map) => (
      <Pane>
        <MapSharing map={map} />
      </Pane>
    ),
  },
  {
    id: 'public',
    title: 'Public link',
    icon: <Globe />,
    render: (map) => (
      <Pane>
        <MapPublicLinkSettings map={map} />
      </Pane>
    ),
  },
  {
    id: 'labels',
    title: 'Labels',
    icon: <Type />,
    render: (map) => <SystemLabelSettings key={map.id} map={map} />,
  },
  {
    id: 'tags',
    title: 'Tags',
    icon: <Tags />,
    render: (map) => <TagSettings key={map.id} map={map} />,
  },
  {
    id: 'bookmarks',
    title: 'Bookmark labels',
    icon: <Bookmark />,
    render: (map, can) => (
      <Pane>
        <BookmarkLabelSettings key={map.id} map={map} canManage={can.manage} canEdit={can.edit} />
      </Pane>
    ),
  },
  {
    id: 'signatures',
    title: 'Signatures',
    icon: <Radar />,
    render: (map) => (
      <Pane>
        <SignatureRetention key={map.id} map={map} />
      </Pane>
    ),
  },
  {
    id: 'discord',
    title: 'Discord',
    icon: <Bell />,
    render: (map) => (
      <Pane>
        <DiscordNotifications map={map} />
      </Pane>
    ),
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    icon: <Webhook />,
    render: (map) => (
      <Pane>
        <Webhooks map={map} />
      </Pane>
    ),
  },
  {
    id: 'danger',
    title: 'Danger zone',
    icon: <TriangleAlert />,
    render: (map) => (
      <Pane>
        <DeleteMap map={map} />
      </Pane>
    ),
  },
];

/**
 * Settings of a map, in a dialog over the live map (managers and up). It is open while the
 * address has `?settings=<section>`: the rail's settings button sets it, old links to
 * `/m/<slug>/settings` arrive with it, and closing the dialog drops it again. Nothing navigates,
 * so the map behind keeps its view, its selection and its live updates.
 */
export function MapSettingsDialog({ map, role }: { map: MapDto; role: MapRole | null | undefined }) {
  const can = mapPermissions(role);
  const { section, show, hide } = useMapSettings();
  const body = useRef<HTMLDivElement>(null);
  const allowed = mapSettingsSections(can);
  const sections = SECTIONS.filter((s) => allowed.includes(s.id));
  const first = sections[0];
  // An unknown or forbidden section (an old link, a role that changed) opens the first one.
  const current = sections.find((s) => s.id === section) ?? first;
  const viewed = section !== null ? current?.id : undefined;
  useEffect(() => {
    if (viewed) track('page_viewed', { page: 'map_settings', section: viewed });
  }, [viewed]);
  if (!first || !current) return null;

  return (
    <Dialog open={section !== null} onOpenChange={(open) => !open && hide()}>
      <DialogSheet
        width={960}
        height={720}
        // The map's own keys (F, C, L, /, Escape for the legend) stay with the map.
        onKeyDown={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          // The open section, so the arrow keys move between sections at once. On touch screens
          // the sheet itself, so no focus ring greets a tap and no keyboard pops up.
          e.preventDefault();
          const touch = window.matchMedia?.('(pointer: coarse)').matches;
          const target = touch
            ? body.current?.closest<HTMLElement>('[role="dialog"]')
            : body.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
          target?.focus();
        }}
      >
        <Tabs
          ref={body}
          value={current.id}
          onValueChange={show}
          orientation="vertical"
          className={dialog.layout}
        >
          <header className={dialog.header}>
            <div className={dialog.heading}>
              <DialogTitle className={dialog.title}>Map settings</DialogTitle>
              <DialogDescription className={dialog.subtitle}>{map.name}</DialogDescription>
            </div>
            <DialogClose asChild>
              <IconButton label="Close" icon={<X />} size="sm" tooltip={false} />
            </DialogClose>
          </header>
          <TabsList className={dialog.nav} aria-label="Map settings sections">
            {sections.map((s) => (
              <TabsTrigger key={s.id} value={s.id} icon={s.icon} data-section={s.id}>
                {s.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map((s) => (
            <TabsContent key={s.id} value={s.id} className={dialog.panel}>
              {s.render(map, can)}
            </TabsContent>
          ))}
        </Tabs>
      </DialogSheet>
    </Dialog>
  );
}

/**
 * One section of the dialog: its cards scroll on their own; `footer` (the buttons of the
 * section's form) stays at the bottom, always in reach.
 */
function Pane({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={dialog.pane}>
      <div className={dialog.scroll}>{children}</div>
      {footer && <div className={dialog.footer}>{footer}</div>}
    </div>
  );
}

function useMapUpdated() {
  const queryClient = useQueryClient();
  return (map: MapDto) => {
    queryClient.setQueryData(['map', map.slug], map);
    void queryClient.invalidateQueries({ queryKey: ['maps'] });
  };
}

// ---- General ----------------------------------------------------------------------------------

const SCOPES: Record<MapScope, { label: string; hint: string }> = {
  wormhole: { label: 'Wormhole space', hint: 'J-space, Thera and the shattered systems' },
  high: { label: 'High-sec', hint: 'Security 0.5 and above' },
  low: { label: 'Low-sec', hint: 'Security 0.1 to 0.4' },
  null: { label: 'Null-sec', hint: 'Security 0.0 and below' },
  pochven: { label: 'Pochven', hint: 'Triglavian space' },
};

function GeneralSettings({ map }: { map: MapDto }) {
  const router = useRouter();
  const formId = useId();
  const toast = useToast();
  const updated = useMapUpdated();
  const [name, setName] = useState(map.name);
  const [slug, setSlug] = useState(map.slug);
  const [scopes, setScopes] = useState<MapScope[]>(map.settings.scopes);
  const dirty =
    name.trim() !== map.name ||
    slug !== map.slug ||
    scopes.length !== map.settings.scopes.length ||
    scopes.some((s) => !map.settings.scopes.includes(s));
  const save = useMutation({
    mutationFn: (body: UpdateMapRequest) =>
      api<MapDto>(buildPath(routes.maps.update.path, { mapId: map.id }), { method: 'PATCH', json: body }),
    onSuccess: (next) => {
      updated(next);
      toast({ title: 'Map settings saved', tone: 'success' });
      if (next.slug !== map.slug) router.replace(mapSettingsHref(next.slug));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name: name.trim(), slug, settings: { scopes } });
  };

  return (
    <Pane
      footer={
        <>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setName(map.name);
                setSlug(map.slug);
                setScopes(map.settings.scopes);
              }}
            >
              Discard
            </Button>
          )}
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </>
      }
    >
      <Card>
        <form id={formId} onSubmit={submit} aria-label="General">
          <CardHeader title="General" description="The map's name, its address and what auto-mapping adds." />
          <CardBody>
            <div className={styles.formStack}>
              <div className={styles.grid}>
                <Field label="Name">
                  <Input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field
                  label="Address"
                  hint="Changing it breaks old links."
                  error={save.error ? errorText(save.error, 'Could not save.') : undefined}
                >
                  <Input
                    mono
                    required
                    minLength={2}
                    maxLength={48}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    icon={
                      <span className="mono subtle" style={{ paddingLeft: 4 }}>
                        /m/
                      </span>
                    }
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </Field>
              </div>
              <fieldset
                style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--dbk-space-2)' }}
              >
                <legend
                  className="muted"
                  style={{
                    fontSize: 'var(--dbk-font-size-small)',
                    fontWeight: 500,
                    marginBottom: 'var(--dbk-space-2)',
                  }}
                >
                  Auto-mapping adds systems in
                </legend>
                <div className={styles.grid} style={{ gap: 'var(--dbk-space-3)' }}>
                  {MapScope.options.map((s) => (
                    <Checkbox
                      key={s}
                      checked={scopes.includes(s)}
                      onCheckedChange={(on) => setScopes(on ? [...scopes, s] : scopes.filter((x) => x !== s))}
                      label={SCOPES[s].label}
                      description={SCOPES[s].hint}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          </CardBody>
        </form>
      </Card>
      <PluginSlot slot="settingsPage" props={{ mapId: map.id }} />
    </Pane>
  );
}

function DeleteMap({ map }: { map: MapDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: () => api<void>(buildPath(routes.maps.remove.path, { mapId: map.id }), { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      router.replace('/');
    },
  });
  return (
    <Card className={styles.danger}>
      <CardHeader
        title="Delete this map"
        description="Removes the map with its systems, connections, signatures, access rules and webhooks, for everyone. This cannot be undone."
        actions={
          <Button variant="danger" icon={<Trash2 />} onClick={() => setOpen(true)}>
            Delete map…
          </Button>
        }
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped('');
        }}
      >
        <DialogContent
          title={`Delete ${map.name}?`}
          description="Everyone loses this map at once. Type its name to confirm."
          width={440}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                disabled={typed !== map.name}
                onClick={() => remove.mutate()}
              >
                Delete map
              </Button>
            </>
          }
        >
          <Field
            label="Map name"
            error={remove.error ? errorText(remove.error, 'Could not delete the map.') : undefined}
          >
            <Input
              autoFocus
              placeholder={map.name}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---- Labels -----------------------------------------------------------------------------------

/** `crypto.randomUUID` exists only on HTTPS and localhost; an instance on plain HTTP gets random hex. */
const randomId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The next free "WH<n>" name: WH4 after WH1 to WH3. */
export function nextSystemLabelName(labels: readonly SystemLabelDto[]): string {
  const taken = new Set(labels.map((l) => l.name.trim().toLowerCase()));
  for (let n = labels.length + 1; ; n++) if (!taken.has(`wh${n}`)) return `WH${n}`;
}

/**
 * The map's Labels (WH1, WH2... as in Wanderer): short text markers anyone who edits the map turns
 * on for a system, plus a custom label of its own. Managers keep the list: names up to 8
 * characters, an optional description of what a name stands for, in the order systems show them.
 */
function SystemLabelSettings({ map }: { map: MapDto }) {
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const initial = map.systemLabels ?? [];
  const [labels, setLabels] = useState<SystemLabelDto[]>(initial);
  const [saved, setSaved] = useState<SystemLabelDto[]>(initial);
  const dirty = JSON.stringify(labels) !== JSON.stringify(saved);
  const save = useMutation({
    mutationFn: (list: SystemLabelDto[]) =>
      api<SystemLabelDto[]>(buildPath(routes.maps.setSystemLabels.path, { mapId: map.id }), {
        method: 'PUT',
        json: { systemLabels: list },
      }),
    onSuccess: (list) => {
      setLabels(list);
      setSaved(list);
      queryClient.setQueryData(['map', map.slug], { ...map, systemLabels: list });
      toast({ title: 'Labels saved', tone: 'success' });
    },
  });
  const change = (id: string, patch: Partial<SystemLabelDto>) =>
    setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const move = (index: number, by: -1 | 1) =>
    setLabels((ls) => {
      const next = [...ls];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      labels
        .map((l) => ({ ...l, name: l.name.trim(), description: l.description.trim() }))
        .filter((l) => l.name),
    );
  };
  const named = labels.filter((l) => l.name.trim());

  return (
    <Pane
      footer={
        <>
          {named.length > 0 && (
            <span className={`${styles.footerNote} ${dialog.footerNote}`}>
              <span className={styles.preview}>
                {named.map((l) => (
                  <span key={l.id} className={styles.systemLabelPreview}>
                    {l.name}
                  </span>
                ))}
              </span>
            </span>
          )}
          {save.error && <span className="error">{errorText(save.error, 'Could not save the labels.')}</span>}
          {dirty && (
            <Button variant="ghost" onClick={() => setLabels(saved)}>
              Discard
            </Button>
          )}
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!dirty}>
            Save labels
          </Button>
        </>
      }
    >
      <Card>
        <form id={formId} onSubmit={submit} aria-label="Labels">
          <CardHeader
            title="Labels"
            description="Short markers like WH1 or A, shown first above a system. Anyone who edits the map turns them on from a system's menu or sidebar, and can give a system a custom label of its own."
            actions={
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() =>
                  setLabels((ls) => [
                    ...ls,
                    { id: randomId(), name: nextSystemLabelName(ls), description: '' },
                  ])
                }
                disabled={labels.length >= 32}
              >
                Add label
              </Button>
            }
          />
          <CardBody flush>
            {labels.length === 0 ? (
              <EmptyState
                compact
                icon={<Type />}
                title="No labels"
                description="Add WH1, WH2 and so on to mark the holes out of a system, or letters for anything else."
              />
            ) : (
              <div>
                {labels.map((l, i) => (
                  <div key={l.id} className={styles.systemLabelRow}>
                    <Input
                      aria-label="Label name"
                      placeholder="Name"
                      maxLength={8}
                      value={l.name}
                      onChange={(e) => change(l.id, { name: e.target.value })}
                    />
                    <Input
                      aria-label={`Description of ${l.name || 'the new label'}`}
                      placeholder="What it stands for (optional)"
                      maxLength={120}
                      value={l.description}
                      onChange={(e) => change(l.id, { description: e.target.value })}
                    />
                    <span className={styles.rowButtons}>
                      <IconButton
                        size="sm"
                        label={`Move ${l.name || 'the new label'} up`}
                        icon={<ArrowUp />}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      />
                      <IconButton
                        size="sm"
                        label={`Move ${l.name || 'the new label'} down`}
                        icon={<ArrowDown />}
                        disabled={i === labels.length - 1}
                        onClick={() => move(i, 1)}
                      />
                      <IconButton
                        size="sm"
                        label={`Remove label ${l.name || 'new label'}`}
                        icon={<X />}
                        onClick={() => setLabels((ls) => ls.filter((x) => x.id !== l.id))}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </form>
      </Card>
    </Pane>
  );
}

// ---- Tags -------------------------------------------------------------------------------------

const PALETTE = ['#38c6d6', '#3fbf7f', '#eba23b', '#f05252', '#7b93ff', '#b98cf5', '#f472b6', '#94a3b8'];
const newTag = (n: number): LabelDto => ({
  id: randomId(),
  name: '',
  color: PALETTE[n % PALETTE.length]!,
  description: '',
});

/** The map's Tags (`labels` in the data): coloured markers like Staging or Sites. */
function TagSettings({ map }: { map: MapDto }) {
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [labels, setLabels] = useState<LabelDto[]>(map.labels);
  const [saved, setSaved] = useState<LabelDto[]>(map.labels);
  const dirty = JSON.stringify(labels) !== JSON.stringify(saved);
  const save = useMutation({
    mutationFn: (list: LabelDto[]) =>
      api<LabelDto[]>(buildPath(routes.maps.setLabels.path, { mapId: map.id }), {
        method: 'PUT',
        json: { labels: list },
      }),
    onSuccess: (list) => {
      setLabels(list);
      setSaved(list);
      queryClient.setQueryData(['map', map.slug], { ...map, labels: list });
      toast({ title: 'Tags saved', tone: 'success' });
    },
  });
  const change = (id: string, patch: Partial<LabelDto>) =>
    setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(labels.map((l) => ({ ...l, name: l.name.trim() })).filter((l) => l.name));
  };

  return (
    <Pane
      footer={
        <>
          {labels.some((l) => l.name.trim()) && (
            <span className={`${styles.footerNote} ${dialog.footerNote}`}>
              <span className={styles.preview}>
                {labels
                  .filter((l) => l.name.trim())
                  .map((l) => (
                    <span
                      key={l.id}
                      className={styles.labelPreview}
                      style={{ '--label-color': l.color } as CSSProperties}
                    >
                      {l.name}
                    </span>
                  ))}
              </span>
            </span>
          )}
          {save.error && <span className="error">{errorText(save.error, 'Could not save the tags.')}</span>}
          {dirty && (
            <Button variant="ghost" onClick={() => setLabels(saved)}>
              Discard
            </Button>
          )}
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!dirty}>
            Save tags
          </Button>
        </>
      }
    >
      <Card>
        <form id={formId} onSubmit={submit} aria-label="Tags">
          <CardHeader
            title="Tags"
            description="Coloured markers for systems, like Staging or Sites, shown last above a system. The description shows when someone hovers the tag."
            actions={
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() => setLabels((ls) => [...ls, newTag(ls.length)])}
                disabled={labels.length >= 64}
              >
                Add tag
              </Button>
            }
          />
          <CardBody flush>
            {labels.length === 0 ? (
              <EmptyState
                compact
                icon={<Tags />}
                title="No tags yet"
                description="Add a few to mark staging systems, sites or exits on the map."
              />
            ) : (
              <div>
                {labels.map((l) => (
                  <div key={l.id} className={styles.labelRow}>
                    <Tooltip content="Colour">
                      <label className={styles.swatch} style={{ background: l.color }}>
                        <input
                          type="color"
                          aria-label={`Colour of ${l.name || 'new tag'}`}
                          value={l.color}
                          onChange={(e) => change(l.id, { color: e.target.value })}
                          style={{ opacity: 0 }}
                        />
                      </label>
                    </Tooltip>
                    <Input
                      aria-label="Tag name"
                      placeholder="Name"
                      maxLength={32}
                      value={l.name}
                      onChange={(e) => change(l.id, { name: e.target.value })}
                    />
                    <Input
                      aria-label="Description"
                      placeholder="Description (optional)"
                      maxLength={500}
                      value={l.description}
                      onChange={(e) => change(l.id, { description: e.target.value })}
                    />
                    <IconButton
                      size="sm"
                      label={`Remove tag ${l.name || 'new tag'}`}
                      icon={<X />}
                      onClick={() => setLabels((ls) => ls.filter((x) => x.id !== l.id))}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </form>
      </Card>
    </Pane>
  );
}

// ---- Access -----------------------------------------------------------------------------------

const SUBJECT: Record<AccessSubjectKind, { label: string; icon: ReactNode; unknown: string }> = {
  corporation: { label: 'Corporation', icon: <Building2 />, unknown: 'A corporation ESI does not know' },
  alliance: { label: 'Alliance', icon: <Flag />, unknown: 'An alliance ESI does not know' },
  character: { label: 'Character', icon: <UserRound />, unknown: 'A character ESI does not know' },
  discordRole: { label: 'Discord role', icon: <Hash />, unknown: 'A Discord role the bot cannot see' },
  account: { label: 'Person', icon: <KeyRound />, unknown: 'An account that was removed' },
};

const ROLE_LABEL: Record<MapRole, string> = {
  viewer: 'Viewer',
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
  blocked: 'Blocked',
};

const ROLE_HINT: Record<MapRole, string> = {
  viewer: 'Sees the map',
  member: 'Maps systems and signatures',
  manager: 'Also locks systems and edits labels and tags',
  admin: 'Also settings, access and notifications',
  blocked: 'Refused, whatever else matches',
};

type Subject =
  | { kind: 'character' | 'corporation' | 'alliance'; picked: EveOption | null }
  | { kind: 'account'; picked: AccountOption | null }
  | { kind: 'discordRole'; guildId: string | null; roleId: string | null };

function emptySubject(kind: AccessSubjectKind): Subject {
  if (kind === 'account') return { kind, picked: null };
  if (kind === 'discordRole') return { kind, guildId: null, roleId: null };
  return { kind, picked: null };
}

function subjectRequest(
  subject: Subject,
): Pick<CreateAccessRuleRequest, 'subjectKind' | 'subjectId' | 'guildId'> | null {
  switch (subject.kind) {
    case 'account':
      return subject.picked
        ? { subjectKind: 'account', subjectId: subject.picked.account.id, guildId: null }
        : null;
    case 'discordRole':
      return subject.guildId && subject.roleId
        ? { subjectKind: 'discordRole', subjectId: subject.roleId, guildId: subject.guildId }
        : null;
    default:
      return subject.picked
        ? { subjectKind: subject.kind, subjectId: String(subject.picked.entity.id), guildId: null }
        : null;
  }
}

function AccessRules({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const instance = useInstance();
  const key = ['access-rules', map.id];
  const rules = useQuery({
    queryKey: key,
    queryFn: () => api<AccessRuleDto[]>(buildPath(routes.access.list.path, { mapId: map.id })),
  });
  const discordRoles = instance.data?.discordRoles ?? false;
  const bot = instance.data?.discordBot ?? false;
  const kinds = AccessSubjectKind.options.filter((k) => k !== 'discordRole' || discordRoles);
  const [subject, setSubject] = useState<Subject>(emptySubject('corporation'));
  const [role, setRole] = useState<MapRole>('member');
  const [removing, setRemoving] = useState<AccessRuleDto | null>(null);
  const add = useMutation({
    mutationFn: (body: CreateAccessRuleRequest) =>
      api<AccessRuleDto>(buildPath(routes.access.add.path, { mapId: map.id }), {
        method: 'POST',
        json: body,
      }),
    onSuccess: (rule) => {
      setSubject(emptySubject(subject.kind));
      void queryClient.invalidateQueries({ queryKey: key });
      toast({
        title: `${rule.subject?.name ?? 'Rule'} added as ${ROLE_LABEL[rule.role].toLowerCase()}`,
        tone: 'success',
      });
    },
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      api<void>(buildPath(routes.access.remove.path, { mapId: map.id, ruleId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) =>
      toast({
        title: 'Could not remove the rule',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });

  const request = subjectRequest(subject);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (request) add.mutate({ ...request, role });
  };
  const admin = me.data?.account.instanceRole === 'owner' || me.data?.account.instanceRole === 'admin';

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Who can open this map"
          description="The highest matching rule wins. A blocked character or person is refused whatever else matches."
        />
        <CardBody flush>
          {rules.isPending ? (
            <SkeletonRows count={2} />
          ) : rules.isError ? (
            <ErrorState compact error={rules.error} onRetry={() => void rules.refetch()} />
          ) : rules.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Lock />}
              title="Only you can see this map"
              description={
                discordRoles
                  ? 'Add a rule below to let your corporation, alliance or a Discord role in.'
                  : 'Add a rule below to let your corporation, your alliance or a pilot in.'
              }
            />
          ) : (
            <ul className={styles.list}>
              {rules.data.map((r) => (
                <li key={r.id} className={`${styles.item} ${styles.itemCenter}`}>
                  {r.subject?.imageUrl ? (
                    <Avatar
                      src={r.subject.imageUrl}
                      name={r.subject.name}
                      size={32}
                      shape={
                        r.subjectKind === 'character' || r.subjectKind === 'account' ? 'circle' : 'rounded'
                      }
                    />
                  ) : (
                    <span className={styles.subjectIcon} aria-hidden>
                      {SUBJECT[r.subjectKind].icon}
                    </span>
                  )}
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {r.subject?.name ?? <span className="muted">{SUBJECT[r.subjectKind].unknown}</span>}
                      {r.subject?.detail && <span className={styles.version}>{r.subject.detail}</span>}
                    </div>
                    <div className={styles.rowMeta}>{SUBJECT[r.subjectKind].label}</div>
                  </div>
                  <div className={styles.rowActions}>
                    <Badge
                      tone={
                        r.role === 'blocked'
                          ? 'danger'
                          : r.role === 'admin' || r.role === 'manager'
                            ? 'accent'
                            : 'neutral'
                      }
                    >
                      {ROLE_LABEL[r.role]}
                    </Badge>
                    <IconButton
                      size="sm"
                      label={`Remove the rule for ${r.subject?.name ?? SUBJECT[r.subjectKind].label.toLowerCase()}`}
                      icon={<Trash2 />}
                      onClick={() => setRemoving(r)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <form onSubmit={submit} aria-label="Add access rule">
          <CardHeader title="Add a rule" description="Find them by name." />
          <CardBody>
            <div className={styles.ruleGrid}>
              <Field label="Who">
                <Select
                  value={subject.kind}
                  options={kinds.map((k) => ({ value: k, label: SUBJECT[k].label, icon: SUBJECT[k].icon }))}
                  onValueChange={(k) => {
                    add.reset();
                    setSubject(emptySubject(k as AccessSubjectKind));
                  }}
                />
              </Field>
              {subject.kind === 'account' ? (
                <Field
                  label="Person"
                  error={add.error ? errorText(add.error, 'Could not add the rule.') : undefined}
                >
                  <AccountPicker
                    value={subject.picked}
                    onChange={(picked) => setSubject({ kind: 'account', picked })}
                  />
                </Field>
              ) : subject.kind === 'discordRole' ? (
                bot ? (
                  <>
                    <Field label="Discord server">
                      <GuildSelect
                        value={subject.guildId}
                        onChange={(guildId) => setSubject({ kind: 'discordRole', guildId, roleId: null })}
                      />
                    </Field>
                    <Field
                      label="Role"
                      error={add.error ? errorText(add.error, 'Could not add the rule.') : undefined}
                    >
                      <RoleSelect
                        guildId={subject.guildId}
                        value={subject.roleId}
                        onChange={(roleId) => setSubject({ ...subject, roleId })}
                      />
                    </Field>
                  </>
                ) : (
                  <div className={styles.ruleWide}>
                    <Callout tone="neutral" title="Discord roles need the bot">
                      <BotHint admin={admin} />
                    </Callout>
                  </div>
                )
              ) : (
                <Field
                  label={SUBJECT[subject.kind].label}
                  error={add.error ? errorText(add.error, 'Could not add the rule.') : undefined}
                >
                  <EvePicker
                    category={subject.kind}
                    value={subject.picked}
                    onChange={(picked) => setSubject({ kind: subject.kind, picked } as Subject)}
                  />
                </Field>
              )}
              <Field label="Map role" hint={ROLE_HINT[role]}>
                <Select
                  value={role}
                  options={MapRole.options.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  onValueChange={(r) => setRole(r as MapRole)}
                />
              </Field>
            </div>
          </CardBody>
          <CardFooter>
            <Button
              type="submit"
              variant="primary"
              icon={<Plus />}
              loading={add.isPending}
              disabled={!request}
            >
              Add rule
            </Button>
          </CardFooter>
        </form>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove the rule for ${removing?.subject?.name ?? 'them'}?`}
        description="People who got in only through it lose access at once."
        confirmLabel="Remove rule"
        tone="danger"
        onConfirm={() => removing && remove.mutateAsync(removing.id)}
      />
    </Stack>
  );
}

// ---- Webhooks ---------------------------------------------------------------------------------

const EVENT_GROUPS = [
  { value: 'system.*', label: 'Systems', hint: 'Added, changed, removed' },
  { value: 'connection.*', label: 'Connections', hint: 'Added, changed, removed, passages' },
  { value: 'signature.*', label: 'Signatures', hint: 'Added, changed, removed' },
  { value: 'character.*', label: 'Characters', hint: 'Jumps, ships, online' },
  { value: 'system_labels.changed', label: 'Labels', hint: 'The list of labels changed' },
  { value: 'labels.changed', label: 'Tags', hint: 'The list of tags changed' },
  { value: 'map.*', label: 'Map', hint: 'Settings changed' },
  { value: 'access.*', label: 'Access', hint: 'Rules and roles' },
  { value: 'ping.*', label: 'Pings', hint: 'Created and removed' },
] as const;

function eventsLabel(events: readonly string[]): string[] {
  if (events.includes('*')) return ['All events'];
  return events.map((e) => EVENT_GROUPS.find((g) => g.value === e)?.label ?? e);
}

function Webhooks({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['webhooks', map.id];
  const hooks = useQuery({
    queryKey: key,
    queryFn: () => api<WebhookDto[]>(buildPath(routes.webhooks.list.path, { mapId: map.id })),
  });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhookDto | null>(null);
  const [removing, setRemoving] = useState<WebhookDto | null>(null);
  const failed = (title: string) => (error: unknown) =>
    toast({ title, description: errorText(error, 'Try again.'), tone: 'danger' });
  const toggle = useMutation({
    mutationFn: (w: WebhookDto) =>
      api<WebhookDto>(buildPath(routes.webhooks.update.path, { mapId: map.id, webhookId: w.id }), {
        method: 'PATCH',
        json: { enabled: !w.enabled },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: failed('Could not switch the webhook'),
  });
  const remove = useMutation({
    mutationFn: (w: WebhookDto) =>
      api<void>(buildPath(routes.webhooks.remove.path, { mapId: map.id, webhookId: w.id }), {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: failed('Could not delete the webhook'),
  });

  return (
    <Stack>
      {created && (
        <Callout tone="success" title="Webhook created. Copy its signing secret now">
          <div style={{ display: 'grid', gap: 'var(--dbk-space-2)', marginTop: 'var(--dbk-space-1)' }}>
            It is shown only once. Use it to check the <code>x-darkbeacon-signature</code> header.
            <SecretValue value={created.secret} />
            <div>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                I saved it
              </Button>
            </div>
          </div>
        </Callout>
      )}
      <Card>
        <CardHeader
          title="Webhooks"
          description="Send chosen map events to another service as signed JSON, with retries."
          actions={
            hooks.data &&
            hooks.data.length > 0 && (
              <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
                Add webhook
              </Button>
            )
          }
        />
        <CardBody flush>
          {hooks.isPending ? (
            <SkeletonRows count={2} avatar={false} />
          ) : hooks.isError ? (
            <ErrorState compact error={hooks.error} onRetry={() => void hooks.refetch()} />
          ) : hooks.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Webhook />}
              title="No webhooks"
              description="Post map events to your own service: a bot, an alert pipeline, a spreadsheet."
              actions={
                <Button icon={<Plus />} onClick={() => setCreating(true)}>
                  Add webhook
                </Button>
              }
            />
          ) : (
            <ul className={styles.list}>
              {hooks.data.map((w) => (
                <WebhookRow
                  key={w.id}
                  map={map}
                  hook={w}
                  onToggle={() => toggle.mutate(w)}
                  onRemove={() => setRemoving(w)}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <CreateWebhookDialog
        map={map}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(hook) => {
          setCreated(hook);
          void queryClient.invalidateQueries({ queryKey: key });
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this webhook?"
        description="Deliveries stop at once and its delivery log is removed."
        confirmLabel="Delete webhook"
        tone="danger"
        onConfirm={() => removing && remove.mutateAsync(removing)}
      />
    </Stack>
  );
}

function SecretValue({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className={styles.secret}>
      <code className="mono">{value}</code>
      <IconButton
        size="sm"
        label="Copy secret"
        icon={<Copy />}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast({ title: 'Secret copied', tone: 'success' }))
            .catch(() => {})
        }
      />
    </div>
  );
}

const DELIVERY_TONE = { delivered: 'success', failed: 'danger', pending: 'warning' } as const;

function WebhookRow({
  map,
  hook,
  onToggle,
  onRemove,
}: {
  map: MapDto;
  hook: WebhookDto;
  onToggle(): void;
  onRemove(): void;
}) {
  const toast = useToast();
  const [showLog, setShowLog] = useState(false);
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', hook.id],
    queryFn: () =>
      api<WebhookDeliveryDto[]>(
        buildPath(routes.webhooks.deliveries.path, { mapId: map.id, webhookId: hook.id }),
      ),
    enabled: showLog,
  });
  const test = useMutation({
    mutationFn: () =>
      api<WebhookDeliveryDto>(buildPath(routes.webhooks.test.path, { mapId: map.id, webhookId: hook.id }), {
        method: 'POST',
      }),
    onSuccess: (d) => {
      toast(
        d.status === 'delivered'
          ? {
              title: 'Test delivered',
              description: `The endpoint answered ${d.responseCode}.`,
              tone: 'success',
            }
          : {
              title: 'Test failed',
              description: d.error ?? `The endpoint answered ${d.responseCode}.`,
              tone: 'danger',
            },
      );
      if (showLog) void deliveries.refetch();
    },
    onError: (error) =>
      toast({ title: 'Test failed', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  return (
    <li className={styles.item}>
      <span className={styles.subjectIcon} aria-hidden>
        <Webhook />
      </span>
      <div className={styles.rowBody}>
        <div className={styles.url} title={hook.url}>
          {hook.url}
        </div>
        <div className={styles.chips}>
          {eventsLabel(hook.events).map((e) => (
            <Badge key={e} variant="outline">
              {e}
            </Badge>
          ))}
        </div>
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowLog((s) => !s)} style={{ marginLeft: -8 }}>
            {showLog ? 'Hide deliveries' : 'Recent deliveries'}
          </Button>
        </div>
        {showLog &&
          (deliveries.isPending ? (
            <Skeleton width="80%" height={12} />
          ) : deliveries.data && deliveries.data.length > 0 ? (
            <ul className={styles.deliveries}>
              {deliveries.data.slice(0, 10).map((d) => (
                <li key={d.id} className={styles.delivery}>
                  <Badge tone={DELIVERY_TONE[d.status]} dot>
                    {d.status}
                  </Badge>
                  <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.eventType}
                  </span>
                  <span className="mono muted">{d.responseCode ?? '—'}</span>
                  <span className="subtle">{relativeTime(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: 'var(--dbk-font-size-small)' }}>
              Nothing sent yet.
            </p>
          ))}
      </div>
      <div className={styles.rowActions}>
        <Button size="sm" icon={<Send />} loading={test.isPending} onClick={() => test.mutate()}>
          Test
        </Button>
        <Switch
          checked={hook.enabled}
          onCheckedChange={onToggle}
          label={<span className="sr-only">Deliver to {hook.url}</span>}
        />
        <IconButton size="sm" label="Delete webhook" icon={<Trash2 />} onClick={onRemove} />
      </div>
    </li>
  );
}

function CreateWebhookDialog({
  map,
  open,
  onOpenChange,
  onCreated,
}: {
  map: MapDto;
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(hook: CreatedWebhookDto): void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['system.*', 'connection.*']);
  const create = useMutation({
    mutationFn: () =>
      api<CreatedWebhookDto>(buildPath(routes.webhooks.create.path, { mapId: map.id }), {
        method: 'POST',
        json: { url: url.trim(), events },
      }),
    onSuccess: (hook) => {
      onCreated(hook);
      change(false);
    },
  });
  const change = (next: boolean) => {
    if (!next) {
      setUrl('');
      setEvents(['system.*', 'connection.*']);
      create.reset();
    }
    onOpenChange(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        title="Add webhook"
        description="Events are posted as JSON and signed with a secret you get next."
        width={520}
      >
        <form id="new-webhook" onSubmit={submit} className={styles.formStack}>
          <Field
            label="Endpoint URL"
            error={create.error ? errorText(create.error, 'Could not add the webhook.') : undefined}
          >
            <Input
              mono
              required
              type="url"
              autoFocus
              placeholder="https://example.com/hooks/darkbeacon"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend
              className="muted"
              style={{
                fontSize: 'var(--dbk-font-size-small)',
                fontWeight: 500,
                marginBottom: 'var(--dbk-space-2)',
              }}
            >
              Events
            </legend>
            <div className={styles.eventPicker}>
              {EVENT_GROUPS.map((g) => (
                <Checkbox
                  key={g.value}
                  checked={events.includes(g.value)}
                  onCheckedChange={(on) =>
                    setEvents((list) => (on ? [...list, g.value] : list.filter((x) => x !== g.value)))
                  }
                  label={g.label}
                  description={g.hint}
                />
              ))}
            </div>
          </fieldset>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--dbk-space-2)' }}>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!url.trim() || events.length === 0}
            >
              Add webhook
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
