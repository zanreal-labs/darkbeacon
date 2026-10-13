'use client';

import { useState } from 'react';
import { BookOpen, Columns3, Filter, Link2, Settings2, SlidersHorizontal, Undo2 } from 'lucide-react';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '../../ui';
import { openWormholeReference } from '../../reference/open';
import { GROUP_LABEL } from './facts';
import { OnLinkSettings } from './OnLinkSettings';
import {
  ALL_GROUPS,
  groupShown,
  kindShown,
  setSignaturePrefs,
  useSignaturePrefs,
  type SignatureColumn,
  type SignaturePrefs,
} from './prefs';

const COLUMN_LABEL: Record<SignatureColumn, string> = {
  description: 'Description',
  added: 'Added',
  updated: 'Updated',
  author: 'Added by',
};

const KINDS = [
  ['signature', 'Signatures'],
  ['anomaly', 'Anomalies'],
  ['other', 'Ships, structures and the rest'],
] as const;

/**
 * The signatures section's settings, in the section header: groups shown, columns, colours, lazy
 * delete, the undo window, cascades and the link prompt after a jump. Remembered in this browser.
 */
export function SignatureSettingsMenu({ can }: { can: { edit: boolean } }) {
  const prefs = useSignaturePrefs();
  const set = (patch: Partial<SignaturePrefs>) => setSignaturePrefs(patch);
  const keep = (e: Event) => e.preventDefault();
  const [onLink, setOnLink] = useState(false);
  return (
    <>
      <OnLinkSettings key={String(onLink)} open={onLink} onOpenChange={setOnLink} />
      <Menu>
        <MenuTrigger asChild>
          <IconButton size="sm" label="Signature settings" tooltipSide="left" icon={<Settings2 />} />
        </MenuTrigger>
        <MenuContent>
          <MenuSub>
            <MenuSubTrigger icon={<Filter />}>Show</MenuSubTrigger>
            <MenuSubContent>
              {KINDS.map(([kind, name]) => (
                <MenuCheckboxItem
                  key={kind}
                  checked={kindShown(prefs, kind)}
                  onSelect={keep}
                  onCheckedChange={(on) => set({ kinds: { ...prefs.kinds, [kind]: on } })}
                >
                  {name}
                </MenuCheckboxItem>
              ))}
              <MenuSeparator />
              {ALL_GROUPS.map((g) => (
                <MenuCheckboxItem
                  key={g}
                  checked={groupShown(prefs, g)}
                  onSelect={keep}
                  onCheckedChange={(on) => set({ groups: { ...prefs.groups, [g]: on } })}
                >
                  {GROUP_LABEL[g]}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger icon={<Columns3 />}>Columns</MenuSubTrigger>
            <MenuSubContent>
              {(Object.keys(COLUMN_LABEL) as SignatureColumn[]).map((c) => (
                <MenuCheckboxItem
                  key={c}
                  checked={prefs.columns[c]}
                  onSelect={keep}
                  onCheckedChange={(on) => set({ columns: { ...prefs.columns, [c]: on } })}
                >
                  {COLUMN_LABEL[c]}
                </MenuCheckboxItem>
              ))}
              <MenuSeparator />
              <MenuCheckboxItem
                checked={prefs.colorByGroup}
                onSelect={keep}
                onCheckedChange={(colorByGroup) => set({ colorByGroup })}
              >
                Colour by group
              </MenuCheckboxItem>
            </MenuSubContent>
          </MenuSub>
          {can.edit && (
            <MenuSub>
              <MenuSubTrigger icon={<SlidersHorizontal />}>Pasting and removing</MenuSubTrigger>
              <MenuSubContent>
                <MenuCheckboxItem
                  checked={prefs.lazyDelete}
                  onSelect={keep}
                  onCheckedChange={(lazyDelete) => set({ lazyDelete })}
                >
                  Remove missing on paste
                </MenuCheckboxItem>
                <MenuCheckboxItem
                  checked={prefs.keepLazyDelete}
                  onSelect={keep}
                  onCheckedChange={(keepLazyDelete) => set({ keepLazyDelete })}
                >
                  Keep “Remove missing” on after a paste
                </MenuCheckboxItem>
                <MenuSeparator />
                <MenuCheckboxItem
                  checked={prefs.deleteConnectionWithSigs}
                  onSelect={keep}
                  onCheckedChange={(deleteConnectionWithSigs) => set({ deleteConnectionWithSigs })}
                >
                  Remove connections with their signatures
                </MenuCheckboxItem>
                <MenuCheckboxItem
                  checked={prefs.backLinks}
                  onSelect={keep}
                  onCheckedChange={(backLinks) => set({ backLinks })}
                >
                  Remove the signature that leads back
                </MenuCheckboxItem>
                <MenuCheckboxItem
                  checked={prefs.linkOnSplash}
                  onSelect={keep}
                  onCheckedChange={(linkOnSplash) => set({ linkOnSplash })}
                >
                  Offer to link a signature after a jump
                </MenuCheckboxItem>
                <MenuSeparator />
                <MenuLabel>
                  <Undo2 aria-hidden /> Undo removals for
                </MenuLabel>
                <MenuRadioGroup
                  value={String(prefs.undoSeconds)}
                  onValueChange={(v) => set({ undoSeconds: Number(v) as SignaturePrefs['undoSeconds'] })}
                >
                  {[0, 10, 30].map((s) => (
                    <MenuRadioItem key={s} value={String(s)} onSelect={keep}>
                      {s === 0 ? 'No undo' : `${s} seconds`}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubContent>
            </MenuSub>
          )}
          {can.edit && (
            <MenuItem icon={<Link2 />} onSelect={() => setOnLink(true)}>
              When you link a signature…
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={<BookOpen />} onSelect={() => openWormholeReference()}>
            Wormhole types…
          </MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}
