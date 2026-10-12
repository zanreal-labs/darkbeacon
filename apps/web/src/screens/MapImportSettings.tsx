'use client';

import Link from 'next/link';
import { Import, RefreshCw } from 'lucide-react';
import type { MapDto } from '@darkbeacon/shared';
import { useImportSync, useStopSync } from '../lib/imports';
import { relativeTime } from '../lib/time';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Stack, useToast } from '../ui';

/**
 * Map settings, Import: bring a Wanderer map into this one (the import screen, merging), and the
 * map's sync from Wanderer while it runs, with a way to stop it.
 */
export function MapImportSettings({ map }: { map: MapDto }) {
  const sync = useImportSync(map.id);
  const stop = useStopSync(map.id);
  const toast = useToast();
  const running = sync.data?.enabled ? sync.data : null;
  return (
    <Stack>
      <Card>
        <CardHeader
          icon={<Import />}
          title="Import from Wanderer"
          description="Merge a Wanderer map into this one, field by field: newer wins, nothing here is deleted unless you ask."
          actions={
            <Button asChild size="sm">
              <Link href={`/import?into=${encodeURIComponent(map.slug)}`}>Import into this map</Link>
            </Button>
          }
        />
      </Card>
      {running && (
        <Card aria-label="Sync from Wanderer">
          <CardHeader
            icon={<RefreshCw />}
            title="Syncing from Wanderer"
            description={`Pulls ${running.source.host}/${running.source.slug} every ${running.intervalMinutes} minutes${running.removeMissing ? ' and removes what Wanderer removed' : ''}.`}
            actions={
              <Badge tone={running.lastError ? 'warning' : 'success'}>
                {running.lastError ? 'Failing' : 'On'}
              </Badge>
            }
          />
          <CardBody>
            <p className="muted">
              {running.lastRunAt ? `Last pulled ${relativeTime(running.lastRunAt)}.` : 'Not pulled yet.'}
              {running.lastError ? ` ${running.lastError}` : ''}
            </p>
          </CardBody>
          <CardFooter>
            <Button
              loading={stop.isPending}
              onClick={() =>
                stop.mutate(undefined, {
                  onSuccess: () => toast({ title: 'Stopped syncing from Wanderer', tone: 'success' }),
                })
              }
            >
              Stop syncing
            </Button>
          </CardFooter>
        </Card>
      )}
    </Stack>
  );
}
