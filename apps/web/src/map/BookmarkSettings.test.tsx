// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type MapDto, type MapPreferencesDto } from '@darkbeacon/shared';
import { MAP_ID } from '../test/fixtures';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider } from '../ui';
import { BookmarkLabelSettings } from './BookmarkSettings';

const server = setupMockServer();

const map: MapDto = {
  id: MAP_ID,
  slug: 'chain',
  name: 'Chain',
  ownerAccountId: 'a',
  settings: { scopes: ['wormhole'] },
  labels: [],
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
