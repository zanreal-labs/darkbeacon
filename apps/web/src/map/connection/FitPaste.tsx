'use client';

import { useEffect, useState } from 'react';
import { routes, type FitMassDto } from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { Field, Textarea } from '../../ui';
import { formatTonnes } from './format';

/**
 * A fit pasted as the game copies it (Fitting window, Copy to clipboard): weighed on the server
 * from the SDE (plates, subsystems, Higgs Anchor; hot with its largest prop module).
 */
export function FitPaste({ onWeighed }: { onWeighed(fit: { text: string; mass: FitMassDto } | null): void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<FitMassDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fit = text.trim();
    if (!fit) return;
    const timer = setTimeout(() => {
      api<FitMassDto>(routes.universe.fitMass.path, { method: 'POST', json: { fit } }).then(
        (mass) => {
          setError(null);
          setResult(mass);
          onWeighed({ text: fit, mass });
        },
        (e: unknown) => {
          setResult(null);
          setError(e instanceof ApiError ? e.message : 'Network error');
          onWeighed(null);
        },
      );
    }, 300);
    return () => clearTimeout(timer);
    // `onWeighed` is the caller's setter; the text is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <Field
      label="Fit"
      hint={
        result
          ? `${result.ship.name}${result.name ? ` (${result.name})` : ''}: ${formatTonnes(result.cold)} cold, ${formatTonnes(result.hot)} hot${result.prop ? ` with the ${result.prop}` : ''}`
          : 'Paste it as the game copies it: [Ship, Name] and one module per line'
      }
      error={error ?? undefined}
    >
      <Textarea
        rows={4}
        mono
        value={text}
        placeholder={
          '[Megathron, Roller]\n1600mm Rolled Tungsten Compact Plates\n500MN Y-T8 Compact Microwarpdrive'
        }
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setResult(null);
            setError(null);
            onWeighed(null);
          }
        }}
      />
    </Field>
  );
}
