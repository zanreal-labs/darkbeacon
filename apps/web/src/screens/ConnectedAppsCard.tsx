'use client';

import { useState } from 'react';
import { AppWindow, Trash2 } from 'lucide-react';
import type { OAuthGrantDto } from '@darkbeacon/shared';
import { ApiError } from '../lib/api';
import { useOAuthGrants, useRevokeOAuthGrant } from '../lib/oauth';
import { describeScopes } from '../lib/scope-builder';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Row,
  Rows,
  SkeletonRows,
  useToast,
} from '../ui';
import styles from './apiKeys.module.css';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Try again.');

/** The host of a client's home page, when it gave one that parses. */
function hostOf(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

function GrantRow({ grant: g, onRevoke }: { grant: OAuthGrantDto; onRevoke(): void }) {
  const host = hostOf(g.clientUri);
  const scopes = describeScopes(g.scopes, g.maps);
  const used = g.lastUsedAt
    ? `Last used ${relativeTime(g.lastUsedAt)}${g.lastUsedIp ? ` from ${g.lastUsedIp}` : ''}`
    : 'Never used';
  return (
    <Row
      leading={
        <span className={styles.keyIcon} aria-hidden>
          <AppWindow />
        </span>
      }
      title={
        <>
          <span>{g.clientName}</span>
          {g.readOnly && <Badge variant="outline">Read only</Badge>}
        </>
      }
      meta={
        <span className={styles.metaLines}>
          {scopes.length > 0 && <span className={styles.metaLine}>{scopes.join(' · ')}</span>}
          <span className={styles.metaLine}>
            {[host, `Allowed ${relativeTime(g.createdAt)}`, used].filter(Boolean).join(' · ')}
          </span>
        </span>
      }
      actions={
        <IconButton size="sm" label={`Disconnect ${g.clientName}`} icon={<Trash2 />} onClick={onRevoke} />
      }
    />
  );
}

/** Account page: MCP clients the account let act for it, each with a way to cut it off. */
export function ConnectedAppsCard() {
  const toast = useToast();
  const grants = useOAuthGrants();
  const revoke = useRevokeOAuthGrant();
  const [revoking, setRevoking] = useState<OAuthGrantDto | null>(null);
  return (
    <Card>
      <CardHeader
        title="Connected apps"
        description="Apps you allowed to use Darkbeacon as you, through its MCP endpoint."
      />
      <CardBody flush>
        {grants.isPending ? (
          <SkeletonRows count={1} />
        ) : grants.isError ? (
          <ErrorState compact error={grants.error} onRetry={() => void grants.refetch()} />
        ) : grants.data.length === 0 ? (
          <EmptyState
            compact
            icon={<AppWindow />}
            title="No connected apps"
            description="MCP clients that sign in with Darkbeacon show up here."
          />
        ) : (
          <Rows>
            {grants.data.map((g) => (
              <GrantRow key={g.id} grant={g} onRevoke={() => setRevoking(g)} />
            ))}
          </Rows>
        )}
      </CardBody>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Disconnect ${revoking?.clientName ?? 'this app'}?`}
        description="It loses access at once and every token it got stops working. It can ask you again later."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() =>
          revoking &&
          revoke
            .mutateAsync(revoking)
            .then(() => toast({ title: `${revoking.clientName} disconnected`, tone: 'success' }))
            .catch((error: unknown) =>
              toast({ title: 'Could not disconnect', description: errorText(error), tone: 'danger' }),
            )
        }
      />
    </Card>
  );
}
