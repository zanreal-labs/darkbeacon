// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { DEFAULT_ROUTE_PREFERENCES, routes, type RoutePreferencesDto } from '@darkbeacon/shared';
import { MAP_ID } from '../../test/fixtures';
import { renderWithProviders, setupMockServer } from '../../test/setup';
import { useHubRoutes, useRoutePreferences, useViewerExits } from './api';

const preferences: RoutePreferencesDto = {
  ...DEFAULT_ROUTE_PREFERENCES,
  mode: 'safer',
  skip: ['eol'],
  avoid: [30002086],
  bridges: false,
};

const asked: Record<'exits' | 'hubRoutes', URLSearchParams[]> = { exits: [], hubRoutes: [] };
setupMockServer(
  http.get(routes.routing.preferences.path, () => HttpResponse.json(preferences)),
  http.get(routes.routing.exits.path, ({ request }) => {
    asked.exits.push(new URL(request.url).searchParams);
    return HttpResponse.json({ mode: 'safer', exits: [] });
  }),
  http.get(routes.routing.hubRoutes.path, ({ request }) => {
    asked.hubRoutes.push(new URL(request.url).searchParams);
    return HttpResponse.json({ from: 30002537, mode: 'safer', routes: [], limit: 20 });
  }),
);

function ExitsAndRoutes() {
  const prefs = useRoutePreferences();
  useViewerExits(MAP_ID);
  useHubRoutes(MAP_ID, 30002537, 'map', prefs.preferences, prefs.loaded);
  return null;
}

const options = (q: URLSearchParams) =>
  Object.fromEntries([...q].filter(([key]) => key !== 'from' && key !== 'hubs'));

describe('viewer exits', () => {
  it('asks for the exits with the very route options the Routes widget routes with', async () => {
    renderWithProviders(<ExitsAndRoutes />);
    await waitFor(() => expect(asked.exits).toHaveLength(1));
    await waitFor(() => expect(asked.hubRoutes.length).toBeGreaterThan(0));
    const widget = options(asked.hubRoutes.at(-1)!);
    expect(widget).toEqual({ mode: 'safer', skip: 'eol', avoid: '30002086', bridges: 'false' });
    expect(options(asked.exits[0]!)).toEqual(widget);
  });
});
