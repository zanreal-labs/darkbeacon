'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Bot, Globe, KeyRound, Lock, Plus, X } from 'lucide-react';
import {
  routes,
  type InstanceSettingsDto,
  type McpMode,
  type UpdateInstanceSettingsRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { useAdminApiKeys } from '../lib/api-keys';
import { useMaps } from '../lib/maps';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  SkeletonRows,
  Stack,
  Switch,
  useToast,
} from '../ui';
import {
  ApiDocsLink,
  CopyValue,
  KeyList,
  NewKeyDialog,
  shownToken,
  TokenDialog,
  useOrigin,
  type ShownToken,
} from './ApiKeyParts';
import settingsStyles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** What `apiCorsOrigins` accepts (the server checks the same). */
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/**
 * Admin, API access: the MCP endpoint, public maps, browser access (CORS), service keys and every
 * key of the instance. `settingsKey` is the admin page's query key of the instance settings.
 */
export function AdminApiAccess({ settingsKey }: { settingsKey: QueryKey }) {
  return (
    <Stack>
      <McpSettings settingsKey={settingsKey} />
      <PublicMapsSettings settingsKey={settingsKey} />
      <CorsSettings settingsKey={settingsKey} />
      <ServiceKeys />
      <AllKeys />
    </Stack>
  );
}

function useSettings(settingsKey: QueryKey) {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => api<InstanceSettingsDto>(routes.admin.settings.path),
  });
}

function useSave(settingsKey: QueryKey, success?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: UpdateInstanceSettingsRequest) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, { method: 'PATCH', json: body }),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKey, data);
      if (success) toast({ title: success, tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
}

function McpSettings({ settingsKey }: { settingsKey: QueryKey }) {
  const settings = useSettings(settingsKey);
  const save = useSave(settingsKey, 'AI agent access saved');
  const origin = useOrigin();
  const mode: McpMode = settings.data?.mcpMode ?? 'off';
  return (
    <Card>
      <CardHeader
        title="AI agents (MCP)"
        description="Agents that speak the Model Context Protocol reach maps through one endpoint. Each map can narrow this further."
      />
      <CardBody>
        <div className={settingsStyles.formStack}>
          <ChoiceGroup
            aria-label="AI agent access"
            value={settings.data ? mode : undefined}
            disabled={!settings.data || save.isPending}
            onValueChange={(value) => save.mutate({ mcpMode: value as McpMode })}
            options={[
              { value: 'off', label: 'Off', icon: <Lock />, description: 'The endpoint answers nobody.' },
              {
                value: 'authenticated',
                label: 'API keys only',
                icon: <KeyRound />,
                description:
                  'Agents connect with a personal or service key and do what its permissions allow.',
              },
              {
                value: 'public',
                label: 'Public maps too',
                icon: <Globe />,
                description: 'Without a key, agents may also read public maps whose admins allow it.',
              },
            ]}
          />
          {mode !== 'off' && origin && (
            <CopyValue
              label="Endpoint for the agent's MCP settings"
              value={`${origin}/mcp`}
              copyLabel="Copy endpoint"
              copied="Endpoint copied"
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function PublicMapsSettings({ settingsKey }: { settingsKey: QueryKey }) {
  const settings = useSettings(settingsKey);
  const save = useSave(settingsKey);
  return (
    <Card>
      <CardHeader title="Public maps" description="Read-only links to a map that work without signing in." />
      <CardBody>
        <Switch
          checked={settings.data?.publicMaps ?? true}
          disabled={!settings.data || save.isPending}
          onCheckedChange={(publicMaps) => save.mutate({ publicMaps })}
          label="Map admins may make maps public"
          description="Anyone with a map's link then sees it live, without signing in. Off: every public link stops working until you switch this back on."
        />
      </CardBody>
    </Card>
  );
}

function CorsSettings({ settingsKey }: { settingsKey: QueryKey }) {
  const settings = useSettings(settingsKey);
  const save = useSave(settingsKey, 'Browser access saved');
  const [draft, setDraft] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const origins = draft ?? settings.data?.apiCorsOrigins ?? [];

  const add = (e: FormEvent) => {
    e.preventDefault();
    const origin = text.trim().replace(/\/+$/, '');
    if (!origin) return;
    if (!ORIGIN.test(origin)) {
      setError('An origin is the scheme and host only, such as https://tools.example.com.');
      return;
    }
    if (origins.length >= 20) {
      setError('At most 20 origins.');
      return;
    }
    setError(null);
    setText('');
    if (!origins.includes(origin)) setDraft([...origins, origin]);
  };

  return (
    <Card>
      <form onSubmit={add} aria-label="Add an origin">
        <CardHeader
          title="Browser access (CORS)"
          description="Web pages on these origins may call the API from the browser with an API key. Cookies never work across origins."
        />
        <CardBody>
          <div className={settingsStyles.formStack}>
            <div className={settingsStyles.inline}>
              <Field label="Add an origin" error={error ?? undefined}>
                <Input
                  mono
                  value={text}
                  disabled={!settings.data}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  placeholder="https://tools.example.com"
                />
              </Field>
              <Button type="submit" icon={<Plus />} disabled={!text.trim()}>
                Add
              </Button>
            </div>
            {settings.isPending ? (
              <Skeleton width={240} height={20} />
            ) : origins.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--dbk-font-size-small)' }}>
                No origin may call the API from a browser.
              </p>
            ) : (
              <div className={settingsStyles.chips} aria-label="Allowed origins">
                {origins.map((o) => (
                  <Badge key={o} variant="outline">
                    <span className="mono">{o}</span>
                    <button
                      type="button"
                      className={settingsStyles.chipRemove}
                      aria-label={`Remove ${o}`}
                      onClick={() => setDraft(origins.filter((x) => x !== o))}
                    >
                      <X />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardBody>
      </form>
      <CardFooter>
        {draft && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
        )}
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!draft}
          onClick={() => save.mutate({ apiCorsOrigins: origins }, { onSuccess: () => setDraft(null) })}
        >
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function ServiceKeys() {
  const keys = useAdminApiKeys();
  const maps = useMaps();
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<ShownToken | null>(null);
  const service = keys.data?.filter((k) => k.kind === 'svc') ?? [];
  const newKey = (size?: 'sm') => (
    <Button variant="primary" size={size} icon={<Plus />} onClick={() => setCreating(true)}>
      New service key
    </Button>
  );
  return (
    <Card>
      <CardHeader
        title="Service keys"
        description="Keys for bots and integrations that act as themselves, not as a person, with the roles you give them."
        actions={service.length > 0 && newKey('sm')}
      />
      <CardBody flush>
        {keys.isPending ? (
          <SkeletonRows count={2} />
        ) : keys.isError ? (
          <ErrorState compact error={keys.error} onRetry={() => void keys.refetch()} />
        ) : service.length === 0 ? (
          <EmptyState
            compact
            icon={<Bot />}
            title="No service keys"
            description="Make one for an alliance bot or a tool that should keep working when people come and go."
            actions={newKey()}
          />
        ) : (
          <KeyList
            keys={service}
            scope="admin"
            everyMap="every map the key can reach"
            canRotate={() => true}
          />
        )}
      </CardBody>
      <CardFooter>
        <span className={settingsStyles.footerNote}>
          A token is shown once, when the key is made or rotated.
        </span>
        <ApiDocsLink />
      </CardFooter>
      <NewKeyDialog
        open={creating}
        onOpenChange={setCreating}
        kind="svc"
        maps={maps.data ?? []}
        isAdmin
        onCreated={(created) => setShown(shownToken(created))}
      />
      <TokenDialog shown={shown} onClose={() => setShown(null)} />
    </Card>
  );
}

function AllKeys() {
  const keys = useAdminApiKeys();
  return (
    <Card>
      <CardHeader
        title="All keys"
        description="Every personal and service key on this instance. Revoke any that should stop working."
      />
      <CardBody flush>
        {keys.isPending ? (
          <SkeletonRows count={3} />
        ) : keys.isError ? (
          <ErrorState compact error={keys.error} onRetry={() => void keys.refetch()} />
        ) : keys.data.length === 0 ? (
          <EmptyState
            compact
            icon={<KeyRound />}
            title="No keys yet"
            description="People make personal keys on their account page; service keys are made above."
          />
        ) : (
          <KeyList
            keys={keys.data}
            scope="admin"
            showOwner
            everyMap="every map it can reach"
            canRotate={(k) => k.kind === 'svc'}
          />
        )}
      </CardBody>
    </Card>
  );
}
