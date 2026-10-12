'use client';

import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { useApiKeys } from '../lib/api-keys';
import { useMaps } from '../lib/maps';
import { isInstanceAdmin, useMe } from '../lib/session';
import { Button, Card, CardBody, CardFooter, CardHeader, EmptyState, ErrorState, SkeletonRows } from '../ui';
import { ApiDocsLink, KeyList, NewKeyDialog, shownToken, TokenDialog, type ShownToken } from './ApiKeyParts';
import settings from './settings.module.css';

/** Personal access tokens on the account page: list, make, rotate and revoke. */
export function ApiKeysCard() {
  const me = useMe();
  const maps = useMaps();
  const keys = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<ShownToken | null>(null);
  const any = (keys.data?.length ?? 0) > 0;
  const newKey = (variant: 'primary' | 'secondary', size?: 'sm') => (
    <Button variant={variant} size={size} icon={<Plus />} onClick={() => setCreating(true)}>
      New key
    </Button>
  );

  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Let scripts, bots and other tools use Darkbeacon as you. A key never does more than you can."
        actions={any && newKey('primary', 'sm')}
      />
      <CardBody flush>
        {keys.isPending ? (
          <SkeletonRows count={2} />
        ) : keys.isError ? (
          <ErrorState compact error={keys.error} onRetry={() => void keys.refetch()} />
        ) : !any ? (
          <EmptyState
            compact
            icon={<KeyRound />}
            title="No API keys"
            description="Make one for a script or a tool that reads or edits your maps."
            actions={newKey('primary')}
          />
        ) : (
          <KeyList keys={keys.data} scope="own" everyMap="all your maps" canRotate={() => true} />
        )}
      </CardBody>
      <CardFooter>
        <span className={settings.footerNote}>A token is shown once, when the key is made or rotated.</span>
        <ApiDocsLink />
      </CardFooter>
      <NewKeyDialog
        open={creating}
        onOpenChange={setCreating}
        kind="pat"
        maps={maps.data ?? []}
        isAdmin={isInstanceAdmin(me.data)}
        onCreated={(created) => setShown(shownToken(created))}
      />
      <TokenDialog shown={shown} onClose={() => setShown(null)} />
    </Card>
  );
}
