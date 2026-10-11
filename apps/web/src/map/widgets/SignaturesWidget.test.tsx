// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type SignatureDto } from '@wormwright/shared';
import { mapPermissions } from '../../lib/roles';
import { MAP_ID, signatureFixture } from '../../test/fixtures';
import { renderWithProviders, setupMockServer } from '../../test/setup';
import { useMapStore } from '../useMapStore';
import { SignaturesWidget } from './SignaturesWidget';

const SYSTEM = 31000001;
const pastePath = buildPath(routes.signatures.paste.path, { mapId: MAP_ID, solarSystemId: SYSTEM });
const server = setupMockServer();

const SCANNER = [
  'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.2 AU',
  'DEF-456\tCosmic Signature\tGas Site\tBarren Perimeter Reservoir\t100.0%\t9.1 AU',
].join('\n');

function Widget({
  signatures,
  role = 'member' as const,
}: {
  signatures: SignatureDto[];
  role?: 'member' | 'viewer';
}) {
  const store = useMapStore(MAP_ID);
  return (
    <SignaturesWidget
      mapId={MAP_ID}
      solarSystemId={SYSTEM}
      signatures={signatures}
      streamed
      can={mapPermissions(role)}
      store={store}
    />
  );
}

describe('SignaturesWidget', () => {
  it('sends pasted probe scanner text and reports what changed', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(pastePath, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ added: 2, updated: 0, removed: 1, skipped: ['garbage'] });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<Widget signatures={[signatureFixture('s1', SYSTEM, 'XYZ-999')]} />);

    await user.click(screen.getByRole('checkbox', { name: 'Remove missing' }));
    await user.click(screen.getByRole('textbox', { name: 'Paste probe scanner results' }));
    await user.paste(SCANNER);

    expect(await screen.findByText('2 added, 0 updated, 1 removed, 1 lines skipped')).toBeTruthy();
    expect(bodies).toEqual([{ text: SCANNER, mode: 'replace' }]);
  });

  it('shows the server error and keeps the list', async () => {
    server.use(
      http.post(pastePath, () =>
        HttpResponse.json({ error: { code: 'forbidden', message: 'Viewers cannot edit.' } }, { status: 403 }),
      ),
    );
    const user = userEvent.setup();
    function WithNotices() {
      const store = useMapStore(MAP_ID);
      return (
        <>
          <SignaturesWidget
            mapId={MAP_ID}
            solarSystemId={SYSTEM}
            signatures={[signatureFixture('s1', SYSTEM, 'XYZ-999')]}
            streamed
            can={mapPermissions('member')}
            store={store}
          />
          {store.notices.map((n) => (
            <p key={n.id}>{n.message}</p>
          ))}
        </>
      );
    }
    renderWithProviders(<WithNotices />);
    await user.click(screen.getByRole('textbox', { name: 'Paste probe scanner results' }));
    await user.paste(SCANNER);
    expect(await screen.findByText('Could not read the signatures: Viewers cannot edit.')).toBeTruthy();
    expect(screen.getByText('XYZ-999')).toBeTruthy();
  });

  it('lists signatures sorted by id, read-only for viewers', async () => {
    renderWithProviders(
      <Widget
        role="viewer"
        signatures={[
          signatureFixture('s2', SYSTEM, 'QQQ-200', { group: 'relic', name: 'Forgotten Site' }),
          signatureFixture('s1', SYSTEM, 'AAA-100', { group: 'wormhole', type: 'B274' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole<HTMLTableRowElement>('row').slice(1);
    expect(rows.map((r) => r.cells[0]?.textContent)).toEqual(['AAA-100', 'QQQ-200']);
    expect(screen.queryByRole('textbox', { name: 'Paste probe scanner results' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    await waitFor(() => expect(screen.getByText('Forgotten Site')).toBeTruthy());
  });
});
