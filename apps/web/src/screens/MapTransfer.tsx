'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Crown, Download, Upload } from 'lucide-react';
import {
  buildPath,
  MAP_SETTINGS_EXPORT_FORMAT,
  routes,
  type ImportMapResultDto,
  type MapDto,
  type MapSettingsExportDocument,
} from '@darkbeacon/shared';
import { AccountPicker, type AccountOption } from '../components/pickers';
import { api, ApiError } from '../lib/api';
import { readJsonFile } from '../lib/map-files';
import type { MapPermissions } from '../lib/roles';
import { useMe } from '../lib/session';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Stack,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Taking the map elsewhere: its file (Darkbeacon's own format, the way out and between instances),
 * its settings as a file, a duplicate, and handing it to another owner.
 */
export function MapTransferSection({ map, can }: { map: MapDto; can: MapPermissions }) {
  const me = useMe();
  const owner = me.data?.account.id === map.ownerAccountId;
  return (
    <Stack>
      <MapFileCard map={map} can={can} />
      <SettingsFileCard map={map} can={can} />
      {can.admin && <DuplicateCard map={map} />}
      {owner && <OwnerCard map={map} />}
    </Stack>
  );
}

function MapFileCard({ map, can }: { map: MapDto; can: MapPermissions }) {
  const [rules, setRules] = useState(can.admin);
  const href = `${buildPath(routes.mapFiles.export.path, { mapId: map.id })}${rules ? '?accessRules=true' : ''}`;
  return (
    <Card>
      <CardHeader
        title="Map file"
        description="Everything on the map in one file: systems, hidden ones and their notes too, connections, signatures, settings and labels. Import it on the maps page here or on another Darkbeacon."
      />
      {can.admin && (
        <CardBody>
          <Checkbox
            checked={rules}
            onCheckedChange={setRules}
            label="With the access rules"
            description="Who may open the map. Leave them out for a file you hand around."
          />
        </CardBody>
      )}
      <CardFooter>
        <Button asChild icon={<Download />}>
          <a href={href} download>
            Download map file
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

function SettingsFileCard({ map, can }: { map: MapDto; can: MapPermissions }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [labels, setLabels] = useState(true);
  const apply = useMutation({
    mutationFn: async (file: File) => {
      const document = await readJsonFile<MapSettingsExportDocument>(file);
      if (document?.format !== MAP_SETTINGS_EXPORT_FORMAT)
        throw new Error('This is not a Darkbeacon settings file.');
      return api<MapDto>(buildPath(routes.mapFiles.importSettings.path, { mapId: map.id }), {
        method: 'POST',
        json: { document, labels },
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['map', next.slug], next);
      toast({ title: 'Settings applied', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not apply the settings',
        description: error instanceof ApiError || error instanceof Error ? error.message : 'Try again.',
        tone: 'danger',
      }),
  });
  return (
    <Card>
      <CardHeader
        title="Settings file"
        description="The map's settings, Tags and Labels alone, to give another map the same setup."
      />
      {can.admin && (
        <CardBody>
          <Checkbox
            checked={labels}
            onCheckedChange={setLabels}
            label="Replace Tags and Labels too"
            description="Systems lose the ones the file does not have."
          />
        </CardBody>
      )}
      <CardFooter>
        <Button asChild variant="ghost" icon={<Download />}>
          <a href={buildPath(routes.mapFiles.exportSettings.path, { mapId: map.id })} download>
            Download settings
          </a>
        </Button>
        {can.admin && (
          <>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) apply.mutate(file);
                e.target.value = '';
              }}
            />
            <Button icon={<Upload />} loading={apply.isPending} onClick={() => input.current?.click()}>
              Apply a settings file…
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function DuplicateCard({ map }: { map: MapDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(`${map.name} copy`.slice(0, 64));
  const [signatures, setSignatures] = useState(true);
  const [rules, setRules] = useState(true);
  const duplicate = useMutation({
    mutationFn: () =>
      api<ImportMapResultDto>(buildPath(routes.mapLifecycle.duplicate.path, { mapId: map.id }), {
        method: 'POST',
        json: { name: name.trim(), signatures, accessRules: rules },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      toast({
        title: `${result.map.name} is ready`,
        description: `${result.systems} systems, ${result.connections} connections`,
        tone: 'success',
      });
      router.push(`/m/${result.map.slug}`);
    },
  });
  return (
    <Card>
      <CardHeader
        title="Duplicate"
        description="A new map of your own with this chain, its settings, Tags and Labels. The two go their own ways from then on."
      />
      <CardBody>
        <div className={styles.formStack}>
          <Field
            label="Name of the copy"
            error={duplicate.error ? errorText(duplicate.error, 'Could not duplicate the map.') : undefined}
          >
            <Input maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Checkbox checked={signatures} onCheckedChange={setSignatures} label="With signatures" />
          <Checkbox checked={rules} onCheckedChange={setRules} label="With the access rules" />
        </div>
      </CardBody>
      <CardFooter>
        <Button
          icon={<Copy />}
          loading={duplicate.isPending}
          disabled={!name.trim()}
          onClick={() => duplicate.mutate()}
        >
          Duplicate map
        </Button>
      </CardFooter>
    </Card>
  );
}

function OwnerCard({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<AccountOption | null>(null);
  const [confirming, setConfirming] = useState(false);
  const transfer = useMutation({
    mutationFn: (accountId: string) =>
      api<MapDto>(buildPath(routes.mapLifecycle.transferOwner.path, { mapId: map.id }), {
        method: 'PUT',
        json: { accountId },
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['map', next.slug], next);
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      toast({ title: `${picked?.account.name ?? 'They'} own the map now`, tone: 'success' });
      setPicked(null);
    },
    onError: (error) =>
      toast({
        title: 'Could not hand the map over',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });
  return (
    <Card>
      <CardHeader
        title="Owner"
        description="The owner is always admin of the map. Hand it to someone else when you step down; you keep only what the access rules give you."
      />
      <CardBody>
        <Field label="New owner">
          <AccountPicker value={picked} onChange={setPicked} />
        </Field>
      </CardBody>
      <CardFooter>
        <Button icon={<Crown />} disabled={!picked} onClick={() => setConfirming(true)}>
          Hand over…
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Make ${picked?.account.name ?? 'them'} the owner of ${map.name}?`}
        description="Only the new owner, or an instance admin, can hand it back."
        confirmLabel="Hand over"
        tone="danger"
        onConfirm={() => picked && transfer.mutateAsync(picked.account.id)}
      />
    </Card>
  );
}
