'use client';

import { useState } from 'react';
import {
  BOOKMARK_PREVIEW_VARS,
  bookmarkTemplateVariables,
  BOOKMARK_VARIABLES,
  renderBookmarkTemplate,
} from '@darkbeacon/shared';
import { Button, Dialog, DialogClose, DialogContent, Field, Input, Switch } from '../../ui';
import { setSignaturePrefs, signaturePrefs, type SignaturePrefs } from './prefs';
import styles from './signatures.module.css';

const preview = (template: string) =>
  template.trim() ? renderBookmarkTemplate(template, { ...BOOKMARK_PREVIEW_VARS, tempName: '' }) : '';

function unknownVariables(template: string): string | undefined {
  const unknown = bookmarkTemplateVariables(template).filter((v) => !(v in BOOKMARK_VARIABLES));
  return unknown.length ? `Unknown ${unknown.map((v) => `{${v}}`).join(', ')}` : undefined;
}

/**
 * What linking a signature does for the system it leads to, in this browser (Wanderer's auto temp
 * name, custom label and tag on link; a Label here): copy its bookmark label, and templates with
 * the bookmark variables for its temporary name, custom label and the Label to give it.
 */
export function OnLinkSettings({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [draft, setDraft] = useState<SignaturePrefs['onLink']>(() => signaturePrefs().onLink);
  const set = (patch: Partial<SignaturePrefs['onLink']>) => setDraft((d) => ({ ...d, ...patch }));
  const field = (
    key: 'tempName' | 'customLabel' | 'label',
    label: string,
    hint: string,
    placeholder: string,
  ) => (
    <Field
      label={label}
      hint={draft[key].trim() ? `Example: ${preview(draft[key]) || '(nothing)'}` : hint}
      error={unknownVariables(draft[key])}
    >
      <Input
        mono
        maxLength={64}
        placeholder={placeholder}
        value={draft[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(signaturePrefs().onLink);
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="When you link a signature"
        description="For the system it leads to. Templates take the bookmark variables, e.g. {sig3}, WH{n}, {destClass}."
        width={480}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={[draft.tempName, draft.customLabel, draft.label].some((t) => unknownVariables(t))}
              onClick={() => {
                setSignaturePrefs({ onLink: draft });
                onOpenChange(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className={styles.editor}>
          <Switch
            checked={draft.copyLabel}
            onCheckedChange={(copyLabel) => set({ copyLabel })}
            label="Copy its bookmark label"
            description="Ready to paste into the in-game bookmark."
          />
          {field(
            'tempName',
            'Temporary name',
            'Off. Only when the signature has no temporary name of its own.',
            '{sig3} {destClass}',
          )}
          {field('customLabel', 'Custom label', 'Off.', '{destClass}{destClassIndex}')}
          {field(
            'label',
            'Label',
            'Off. When the text is the name of one of the map’s Labels, it gets that Label.',
            'WH{n}',
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
