'use client';

import { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import type { MapSummaryDto, OAuthAuthorizeQuery, OAuthAuthorizeRequestDto } from '@darkbeacon/shared';
import { ApiError } from '../lib/api';
import { decideAuthorization } from '../lib/oauth';
import { describeScopes } from '../lib/scope-builder';
import { LogoMark } from '../shell/Logo';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChoiceGroup,
  EmptyState,
  Field,
  Switch,
} from '../ui';
import { MapPicker } from './ApiKeyParts';
import styles from './apiKeys.module.css';
import settings from './settings.module.css';

const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : 'The server did not answer. Try again in a moment.';

const page = {
  display: 'grid',
  placeItems: 'center',
  minHeight: '100dvh',
  padding: 'var(--dbk-space-4)',
  background: 'var(--dbk-color-bg)',
} as const;

/** The request cannot be answered (unknown client, a redirect it did not register...). Nothing is sent. */
export function OAuthConsentError({ message }: { message: string }) {
  return (
    <main style={page}>
      <EmptyState
        tone="danger"
        icon={<ShieldAlert />}
        title="This sign-in request does not work"
        description={`${message} Nothing was shared; go back to the app and start again.`}
      />
    </main>
  );
}

/**
 * `/oauth/authorize`: an MCP client asks to use Darkbeacon as the signed-in person. They see who
 * asks, where they go back to and what it may do, may narrow it to some maps or to reading, and
 * allow or cancel. Either answer goes to the API, which says where the browser goes next.
 */
export function OAuthConsent({
  query,
  request,
  maps,
  accountName,
}: {
  query: OAuthAuthorizeQuery;
  request: OAuthAuthorizeRequestDto;
  maps: readonly MapSummaryDto[];
  accountName: string;
}) {
  const [which, setWhich] = useState<'all' | 'picked'>('all');
  const [mapIds, setMapIds] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = mapIds.flatMap((id) => maps.find((m) => m.id === id) ?? []);
  const asks = describeScopes(request.scopes, maps);

  const answer = async (approve: boolean) => {
    setBusy(approve ? 'allow' : 'cancel');
    setError(null);
    try {
      const { redirectTo } = await decideAuthorization({
        ...query,
        approve,
        maps: approve && which === 'picked' ? mapIds : null,
        readOnly: approve && readOnly,
      });
      window.location.assign(redirectTo);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <main style={page}>
      <Card style={{ width: 'min(100%, 560px)' }}>
        <CardHeader
          icon={<LogoMark size={28} />}
          title={`${request.client.name} wants to use Darkbeacon as you`}
          description={`You are signed in as ${accountName}. After you answer you will be sent back to ${request.redirectHost}.`}
        />
        <CardBody>
          <div className={settings.formStack}>
            {asks.length > 0 && (
              <ul className={styles.summary} aria-label="What it asks for">
                <li className={styles.summaryTitle}>It asks to</li>
                {asks.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <fieldset className={settings.fieldset} disabled={busy !== null}>
              <legend className={settings.legend}>Which maps</legend>
              <ChoiceGroup
                aria-label="Which maps"
                value={which}
                onValueChange={(v) => setWhich(v as 'all' | 'picked')}
                options={[
                  { value: 'all', label: 'All maps I can see', description: 'Maps you get later count too.' },
                  { value: 'picked', label: 'Only these maps', description: 'Search them by name below.' },
                ]}
              />
              {which === 'picked' && (
                <>
                  <Field label="Add a map">
                    <MapPicker
                      maps={maps}
                      exclude={mapIds}
                      onPick={(m) => setMapIds((ids) => [...ids, m.id])}
                    />
                  </Field>
                  {picked.length > 0 && (
                    <div className={settings.chips} aria-label="Picked maps">
                      {picked.map((m) => (
                        <Badge key={m.id} variant="outline">
                          {m.name}
                          <button
                            type="button"
                            className={settings.chipRemove}
                            aria-label={`Remove ${m.name}`}
                            onClick={() => setMapIds((ids) => ids.filter((id) => id !== m.id))}
                          >
                            <X />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </fieldset>
            <Switch
              checked={readOnly}
              disabled={busy !== null}
              onCheckedChange={setReadOnly}
              label="Read only"
              description="It may look, but never change anything."
            />
            {error && (
              <Callout tone="danger" title="That did not go through">
                {error}
              </Callout>
            )}
          </div>
        </CardBody>
        <CardFooter>
          <Button
            variant="ghost"
            loading={busy === 'cancel'}
            disabled={busy === 'allow'}
            onClick={() => void answer(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy === 'allow'}
            disabled={busy === 'cancel' || (which === 'picked' && mapIds.length === 0)}
            onClick={() => void answer(true)}
          >
            Allow
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
