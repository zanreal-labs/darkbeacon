// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import {
  buildPath,
  routes,
  type ConnectionDto,
  type MapDto,
  type MapPreferencesDto,
  type MapSystemDto,
} from '@darkbeacon/shared';
import { MAP_ID } from '../test/fixtures';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { BookmarkLabelSettings } from './BookmarkSettings';

const server = setupMockServer();

const map: MapDto = {
  id: MAP_ID,
  slug: 'chain',
  name: 'Chain',
  ownerAccountId: 'a',
  settings: { scopes: ['wormhole'] },
  labels: [],
  systemLabels: [],
  createdAt: 0,
  updatedAt: 0,
};

const prefsPath = buildPath(routes.maps.getPreferences.path, { mapId: MAP_ID });
const templatePath = buildPath(routes.maps.setBookmarkTemplate.path, { mapId: MAP_ID });

function serve(preferences: MapPreferencesDto, bodies: { path: string; body: unknown }[]) {
  server.use(
    http.get(prefsPath, () => HttpResponse.json(preferences)),
    http.patch(prefsPath, async ({ request }) => {
      const body = (await request.json()) as Partial<MapPreferencesDto>;
      bodies.push({ path: 'prefs', body });
      return HttpResponse.json({ ...preferences, ...body, updatedAt: 5 });
    }),
    http.put(templatePath, async ({ request }) => {
      const body = (await request.json()) as { template: string | null };
      bodies.push({ path: 'map', body });
      return HttpResponse.json({ ...map, settings: { ...map.settings, bookmarkTemplate: body.template } });
    }),
  );
}

describe('BookmarkLabelSettings', () => {
  it('lets a manager pick a preset with a live preview and save it for everyone', async () => {
    const bodies: { path: string; body: unknown }[] = [];
    serve({ viewport: null, bookmarkTemplate: null, updatedAt: 0 }, bodies);
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <BookmarkLabelSettings map={map} canManage />
      </ToastProvider>,
    );
    const presets = screen.getByRole('radiogroup', { name: 'Map default template' });
    await user.click(screen.getAllByRole('radio', { name: /1a ABC-123/ })[0]!);
    expect(presets.parentElement!.textContent).toContain('Preview1a ABC-1232b XYZ-777');

    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    await waitFor(() => expect(bodies).toEqual([{ path: 'map', body: { template: '{chainIndex} {sig}' } }]));
  });

  it('validates a template of your own and saves it just for you', async () => {
    const bodies: { path: string; body: unknown }[] = [];
    serve({ viewport: null, bookmarkTemplate: null, updatedAt: 0 }, bodies);
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <BookmarkLabelSettings map={map} canManage={false} />
      </ToastProvider>,
    );
    // Not a manager: the map default is read-only.
    expect(screen.queryByRole('button', { name: 'Save for everyone' })).toBeNull();

    await user.click(await screen.findByRole('radio', { name: /My own/ }));
    const own = screen.getByRole('radiogroup', { name: 'Your template' });
    await user.click(own.querySelector('[role="radio"]:last-child') as HTMLElement);
    const input = screen.getAllByLabelText('Template').at(-1)!;
    await user.clear(input);
    await user.type(input, '{{nope}');
    expect(screen.getByRole('alert').textContent).toBe('Unknown variable {nope}');
    expect(screen.getByRole('button', { name: 'Save mine' }).hasAttribute('disabled')).toBe(true);

    await user.clear(input);
    await user.type(input, 'X {{sig3}');
    await user.click(screen.getByRole('button', { name: 'Save mine' }));
    await waitFor(() => expect(bodies).toEqual([{ path: 'prefs', body: { bookmarkTemplate: 'X {sig3}' } }]));
  });
});

describe('bookmark numbering', () => {
  const numberingPath = buildPath(routes.maps.setBookmarkNumbering.path, { mapId: MAP_ID });

  it('previews WH1, WH2, WH3 in the picked order and saves the numbering for everyone', async () => {
    const bodies: { path: string; body: unknown }[] = [];
    serve({ viewport: null, bookmarkTemplate: null, bookmarkOrder: null, updatedAt: 0 }, bodies);
    server.use(
      http.put(numberingPath, async ({ request }) => {
        const body = (await request.json()) as { numbering: MapDto['settings']['bookmarkNumbering'] };
        bodies.push({ path: 'numbering', body });
        return HttpResponse.json({
          ...map,
          settings: { ...map.settings, bookmarkNumbering: body.numbering },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <BookmarkLabelSettings map={map} canManage />
      </ToastProvider>,
    );
    const preview = screen.getByLabelText('Numbering preview');
    // Found order by default; a closed wormhole leaves a gap for the next new one.
    expect(preview.textContent).toContain('WH1XYZ-777 · HSWH2ABC-123 · C3WH3no signature yet · LS');
    expect(preview.textContent).toContain('When WH2 closesWH1WH3the next new one is WH2');

    const orders = screen.getByRole('radiogroup', { name: 'Numbering order' });
    await user.click(within(orders).getByRole('radio', { name: /Signature/ }));
    expect(preview.textContent).toContain('WH1ABC-123 · C3WH2XYZ-777 · HSWH3no signature yet · LS');
    await user.click(within(orders).getByRole('radio', { name: /Class/ }));
    expect(preview.textContent).toContain('WH1XYZ-777 · HSWH2no signature yet · LSWH3ABC-123 · C3');

    await user.click(screen.getByRole('switch'));
    expect(preview.textContent).toContain('When WH2 closesWH1WH2');
    expect(preview.textContent).not.toContain('the next new one');

    const card = orders.closest('section')!;
    await user.click(within(card).getByRole('button', { name: 'Save numbering' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { path: 'numbering', body: { numbering: { order: 'class', renumberOnClose: true } } },
      ]),
    );
    // Saved: nothing left to save, even before the map is read again.
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Save numbering' }).hasAttribute('disabled')).toBe(
        true,
      ),
    );
  });

  it('keeps an order of your own, says it is not shared and saves it with your preferences', async () => {
    const bodies: { path: string; body: unknown }[] = [];
    serve({ viewport: null, bookmarkTemplate: null, bookmarkOrder: null, updatedAt: 0 }, bodies);
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <BookmarkLabelSettings map={map} canManage={false} />
      </ToastProvider>,
    );
    // Read-only numbering for a viewer: no saving, no renumbering.
    const orders = screen.getByRole('radiogroup', { name: 'Numbering order' });
    expect(within(orders).getByRole('radio', { name: /Found/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Renumber now' })).toBeNull();

    const own = screen.getByRole('radiogroup', { name: 'Your numbering order' });
    await waitFor(() =>
      expect(
        within(own)
          .getByRole('radio', { name: /Same as the map/ })
          .getAttribute('aria-checked'),
      ).toBe('true'),
    );
    await user.click(within(own).getByRole('radio', { name: /Signature/ }));
    expect(screen.getByRole('note').textContent).toContain('Counted on your screen only');
    await user.click(screen.getByRole('button', { name: 'Save mine' }));
    await waitFor(() => expect(bodies).toEqual([{ path: 'prefs', body: { bookmarkOrder: 'signature' } }]));
  });

  it('moves numbers by hand when the map numbers by hand', async () => {
    const HOME = 31000001;
    const [A, B] = [31000002, 31000003];
    const sys = (id: number, status: MapSystemDto['status'] = 'unknown'): MapSystemDto => ({
      mapId: MAP_ID,
      solarSystemId: id,
      position: { x: 0, y: 0 },
      customName: null,
      temporaryName: null,
      tag: null,
      status,
      description: '',
      labelIds: [],
      systemLabelIds: [],
      customLabel: null,
      locked: false,
      visible: true,
      createdAt: id,
      updatedAt: id,
    });
    const hole = (id: string, target: number, number: number): ConnectionDto => ({
      id,
      mapId: MAP_ID,
      source: HOME,
      target,
      type: 'wormhole',
      timeStatus: 'normal',
      massStatus: 'fresh',
      shipSize: 'large',
      massSaved: false,
      dangerous: false,
      bubbled: 'none',
      eolAt: null,
      bookmarkNumber: number,
      bookmarkParent: HOME,
      createdAt: number,
      updatedAt: number,
    });
    const moves: { id: string; body: unknown }[] = [];
    serve({ viewport: null, bookmarkTemplate: null, bookmarkOrder: null, updatedAt: 0 }, []);
    server.use(
      http.get(buildPath(routes.realtime.snapshot.path, { stream: `map:${MAP_ID}` }), () =>
        HttpResponse.json({
          stream: `map:${MAP_ID}`,
          seq: 1,
          data: {
            systems: [sys(HOME, 'home'), sys(A), sys(B)],
            connections: [hole('a', A, 1), hole('b', B, 3)],
            signatures: [],
          },
        }),
      ),
      http.get(routes.universe.getSystem.path.replace(':solarSystemId', ':id'), ({ params }) => {
        const id = Number(params.id);
        return HttpResponse.json({
          id,
          name: { [HOME]: 'Home', [A]: 'J100002', [B]: 'J100003' }[id],
          regionName: '',
          constellationName: '',
          security: -1,
          whClass: id === A ? 3 : 5,
          statics: [],
          effect: null,
        });
      }),
      http.put('/api/maps/:mapId/connections/:connectionId/bookmark-number', async ({ request, params }) => {
        moves.push({ id: String(params.connectionId), body: await request.json() });
        return HttpResponse.json(hole(String(params.connectionId), B, 1));
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <TooltipProvider>
        <ToastProvider>
          <BookmarkLabelSettings
            map={{
              ...map,
              settings: { ...map.settings, bookmarkNumbering: { order: 'manual', renumberOnClose: false } },
            }}
            canManage={false}
            canEdit
          />
        </ToastProvider>
      </TooltipProvider>,
    );
    const list = await screen.findByLabelText('Numbers by hand');
    await waitFor(() => expect(list.textContent).toContain('Out of Home'));
    expect(list.textContent).toContain('1J100002 C33J100003 C5');
    expect(screen.getByRole('button', { name: 'Move J100002 up' }).hasAttribute('disabled')).toBe(true);
    // Up swaps with the one above, whatever gap lies between.
    await user.click(screen.getByRole('button', { name: 'Move J100003 up' }));
    await waitFor(() => expect(moves).toEqual([{ id: 'b', body: { number: 1 } }]));
  });
});
