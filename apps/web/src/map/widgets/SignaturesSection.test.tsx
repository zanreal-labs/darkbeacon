// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type ConnectionDto, type SignatureDto } from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import { connectionFixture, MAP_ID, signatureFixture } from '../../test/fixtures';
import { renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { useMapStore } from '../useMapStore';
import { DEFAULT_SIGNATURE_PREFS, setSignaturePrefs } from '../signatures/prefs';
import { pasteSummary, RemoveMissing, SignaturesSection, useSignaturePaste } from './SignaturesSection';

const SYSTEM = 31000001;
const OTHER = 31000002;
const pastePath = buildPath(routes.signatures.paste.path, { mapId: MAP_ID, solarSystemId: SYSTEM });
const server = setupMockServer();

const SCANNER = [
  'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.2 AU',
  'DEF-456\tCosmic Signature\tGas Site\tBarren Perimeter Reservoir\t100.0%\t9.1 AU',
].join('\n');

function Section({
  signatures,
  connections = new Map(),
  role = 'member' as const,
  onSelectSystem = () => {},
}: {
  signatures: SignatureDto[];
  connections?: Map<string, ConnectionDto>;
  role?: 'member' | 'viewer';
  onSelectSystem?: (id: number) => void;
}) {
  const store = useMapStore(MAP_ID);
  const paste = useSignaturePaste(MAP_ID, SYSTEM, store);
  return (
    <>
      <SignaturesSection
        mapId={MAP_ID}
        solarSystemId={SYSTEM}
        signatures={signatures}
        streamed
        connections={connections}
        universe={new Map([[OTHER, { id: OTHER, name: 'J100002' } as never]])}
        can={mapPermissions(role)}
        store={store}
        paste={paste}
        onSelectSystem={onSelectSystem}
      />
      <RemoveMissing paste={paste} />
      {store.notices.map((n) => (
        <p key={n.id}>{n.message}</p>
      ))}
    </>
  );
}

const render = (ui: ReactElement) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
  );

describe('SignaturesSection', () => {
  it('sends pasted probe scanner text and says what changed in a toast', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(pastePath, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ added: 2, updated: 0, removed: 1, skipped: ['garbage'] });
      }),
    );
    const user = userEvent.setup();
    render(<Section signatures={[signatureFixture('s1', SYSTEM, 'XYZ-999')]} />);

    // "Remove missing" starts on and turns itself off after a paste (Wanderer's lazy delete).
    const lazy = screen.getByRole('checkbox', { name: 'Remove missing' });
    expect(lazy.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('textbox', { name: 'Paste probe scanner results' }));
    await user.paste(SCANNER);

    expect(await screen.findByText('2 new / 0 updated / 1 removed')).toBeTruthy();
    expect(screen.getByText(/1 line not understood/)).toBeTruthy();
    expect(bodies).toEqual([{ text: SCANNER, mode: 'replace' }]);
    await waitFor(() => expect(lazy.getAttribute('aria-checked')).toBe('false'));
  });

  it('shows the server error and keeps the list', async () => {
    server.use(
      http.post(pastePath, () =>
        HttpResponse.json({ error: { code: 'forbidden', message: 'Viewers cannot edit.' } }, { status: 403 }),
      ),
    );
    const user = userEvent.setup();
    render(<Section signatures={[signatureFixture('s1', SYSTEM, 'XYZ-999')]} />);
    await user.click(screen.getByRole('textbox', { name: 'Paste probe scanner results' }));
    await user.paste(SCANNER);
    expect(await screen.findByText('Could not read the signatures: Viewers cannot edit.')).toBeTruthy();
    expect(screen.getByText('XYZ-999')).toBeTruthy();
  });

  it('lists signatures newest first, sorts by a column, read-only for viewers', async () => {
    const user = userEvent.setup();
    render(
      <Section
        role="viewer"
        signatures={[
          signatureFixture('s2', SYSTEM, 'QQQ-200', { group: 'relic', name: 'Forgotten Site', createdAt: 2 }),
          signatureFixture('s1', SYSTEM, 'AAA-100', { group: 'wormhole', type: 'B274', createdAt: 1 }),
        ]}
      />,
    );
    const ids = () =>
      screen
        .getAllByRole<HTMLTableRowElement>('row')
        .slice(1)
        .map((r) => r.cells[0]?.textContent);
    expect(ids()).toEqual(['QQQ-200', 'AAA-100']);
    await user.click(screen.getByRole('button', { name: 'ID' }));
    expect(ids()).toEqual(['AAA-100', 'QQQ-200']);
    expect(screen.queryByRole('textbox', { name: 'Paste probe scanner results' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    await waitFor(() => expect(screen.getByText('Forgotten Site')).toBeTruthy());
  });

  it('links a wormhole to where it leads and selects that system', async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch(
        buildPath(routes.signatures.update.path, { mapId: MAP_ID, signatureId: 's1' }),
        async ({ request }) => {
          patches.push(await request.json());
          return HttpResponse.json(
            signatureFixture('s1', SYSTEM, 'AAA-100', {
              group: 'wormhole',
              type: 'H296',
              connectionId: 'c1',
            }),
          );
        },
      ),
    );
    const onSelectSystem = vi.fn();
    const user = userEvent.setup();
    const connection = connectionFixture('c1', SYSTEM, OTHER);
    render(
      <Section
        onSelectSystem={onSelectSystem}
        connections={new Map([[connection.id, connection]])}
        signatures={[signatureFixture('s1', SYSTEM, 'AAA-100', { group: 'wormhole', type: 'H296' })]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Link AAA-100 to a connection' }));
    await user.click(await screen.findByRole('menuitem', { name: /J100002/ }));
    await waitFor(() => expect(patches).toEqual([{ connectionId: 'c1' }]));
  });

  it('shows where a linked wormhole leads and selects it', async () => {
    const onSelectSystem = vi.fn();
    const user = userEvent.setup();
    const connection = connectionFixture('c1', SYSTEM, OTHER);
    render(
      <Section
        onSelectSystem={onSelectSystem}
        connections={new Map([[connection.id, connection]])}
        signatures={[
          signatureFixture('s1', SYSTEM, 'AAA-100', { group: 'wormhole', type: 'H296', connectionId: 'c1' }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'J100002' }));
    expect(onSelectSystem).toHaveBeenCalledWith(OTHER);
  });

  it('summarises a paste as new and updated', () => {
    expect(pasteSummary({ added: 3, updated: 1, removed: 0, skipped: [] })).toEqual({
      title: '3 new / 1 updated',
      description: undefined,
    });
  });

  it('marks each row with its scan state in the game colours, neutral when colour is off', async () => {
    const { container } = render(
      <Section
        signatures={[
          signatureFixture('s1', SYSTEM, 'AAA-100'),
          signatureFixture('s2', SYSTEM, 'BBB-200', { group: 'gas' }),
          signatureFixture('s3', SYSTEM, 'CCC-300', { group: 'wormhole', type: 'D845' }),
          signatureFixture('s4', SYSTEM, 'DDD-400', { kind: 'anomaly', group: 'combat', name: 'Solar Cell' }),
        ]}
      />,
    );
    const root = container.querySelector<HTMLElement>('[data-signatures]')!;
    expect(root.style.getPropertyValue('--scan-red')).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    const row = (id: string) => screen.getByText(id).closest('tr')!;
    expect(row('AAA-100').dataset).toMatchObject({ kind: 'signature', scan: 'red' });
    expect(row('BBB-200').dataset).toMatchObject({ kind: 'signature', scan: 'orange' });
    expect(row('CCC-300').dataset).toMatchObject({ kind: 'signature', scan: 'green', wormhole: 'true' });
    expect(row('CCC-300').querySelector('svg[data-kind="signature"]')).toBeTruthy();
    // Only the identified wormhole stands out; sites and unscanned results do not.
    expect(row('AAA-100').dataset.wormhole).toBeUndefined();
    expect(row('BBB-200').dataset.wormhole).toBeUndefined();
    expect(root.style.getPropertyValue('--scan-wormhole')).toMatch(
      /^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/,
    );
    expect(row('AAA-100').querySelector('td[data-group]')?.getAttribute('title')).toMatch(/not scanned yet/);
    await userEvent.click(screen.getByRole('button', { name: /Anomalies and other results/ }));
    expect(row('DDD-400').dataset).toMatchObject({ kind: 'anomaly', scan: 'green' });
    expect(row('DDD-400').querySelector('svg[data-kind="anomaly"]')).toBeTruthy();
    expect(root.dataset.color).toBe('true');
    act(() => setSignaturePrefs({ colorByGroup: false }));
    expect(root.dataset.color).toBeUndefined();
    setSignaturePrefs(DEFAULT_SIGNATURE_PREFS);
  });

  it('folds anomalies and other scanner results away, filterable, and marks custom entries', async () => {
    render(
      <Section
        signatures={[
          signatureFixture('s1', SYSTEM, 'ABC-123', { group: 'wormhole' }),
          signatureFixture('s2', SYSTEM, 'Tower 3', { custom: true, name: 'Our Raitaru' }),
          signatureFixture('s3', SYSTEM, 'JKL-012', { kind: 'anomaly', group: 'combat', name: 'Sansha Hub' }),
          signatureFixture('s4', SYSTEM, 'MNO-345', {
            kind: 'anomaly',
            group: 'ore',
            name: 'Ordinary Deposit',
          }),
          signatureFixture('s5', SYSTEM, 'PQR-678', { kind: 'other', type: 'Ship · Frigate', name: 'Heron' }),
        ]}
      />,
    );
    const signatures = screen.getByRole('table', { name: 'Signatures' });
    expect(signatures.textContent).toContain('ABC-123');
    expect(signatures.textContent).toContain('Tower 3Unknowncustom');
    expect(signatures.textContent).not.toContain('JKL-012');
    // Collapsed by default.
    const fold = screen.getByRole('button', { name: /Anomalies and other results/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table', { name: 'Anomalies and other results' })).toBeNull();
    await userEvent.click(fold);
    const others = () => screen.getByRole('table', { name: 'Anomalies and other results' }).textContent;
    expect(others()).toContain('JKL-012');
    expect(others()).toContain('PQR-678');
    // The chips show or hide a group (the same filters as the signature settings).
    await userEvent.click(screen.getByRole('button', { name: 'Combat' }));
    expect(screen.getByRole('button', { name: 'Combat' }).getAttribute('aria-pressed')).toBe('false');
    expect(others()).toContain('MNO-345');
    expect(others()).not.toContain('JKL-012');
    await userEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(others()).not.toContain('PQR-678');
    expect(others()).toContain('MNO-345');
    setSignaturePrefs(DEFAULT_SIGNATURE_PREFS);
  });
});
