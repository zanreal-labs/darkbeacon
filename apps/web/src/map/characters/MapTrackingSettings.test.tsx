// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type MapDto, type MyTrackingDto } from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import { MAP_ID, meFixture } from '../../test/fixtures';
import { renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { CharacterBar, ownOnMap } from './CharacterBar';
import { MapTrackingSettings } from './MapTrackingSettings';

const me = meFixture();
const AYLA = me.characters[0]!.id;
let tracked = false;
let problem: MyTrackingDto['characters'][number]['problem'];
const changes: unknown[] = [];

setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(me)),
  http.get(routes.characters.myTracking.path, () =>
    HttpResponse.json({
      characters: [
        {
          characterId: AYLA,
          solarSystemId: null,
          shipTypeId: null,
          shipName: null,
          online: true,
          docked: null,
          updatedAt: 1,
          trackedOn: tracked ? [MAP_ID] : [],
          ...(problem ? { problem } : {}),
        },
      ],
      maps: [{ id: MAP_ID, name: 'Home', slug: 'home', canTrack: true }],
    } satisfies MyTrackingDto),
  ),
  http.put(buildPath(routes.tracking.set.path, { mapId: MAP_ID }), async ({ request }) => {
    const body = (await request.json()) as { tracked: boolean };
    changes.push(body);
    tracked = body.tracked;
    return new HttpResponse(null, { status: 204 });
  }),
);

const MAP = { id: MAP_ID, slug: 'home', name: 'Home' } as MapDto;

const wrap = (ui: React.ReactElement) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
  );

describe('tracking in the map settings', () => {
  it('has a clearly labelled switch per character that tracks it on this map', async () => {
    wrap(<MapTrackingSettings map={MAP} can={mapPermissions('member')} />);
    expect(await screen.findByText('Tracking on this map')).toBeTruthy();
    const toggle = await screen.findByRole('switch', { name: 'Track Ayla Vex on this map' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(changes).toEqual([{ characterId: AYLA, tracked: true }]));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Track Ayla Vex on this map' }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
  });
});

describe('the top bar', () => {
  const presence = new Map([
    [
      AYLA,
      {
        characterId: AYLA,
        accountId: me.account.id,
        name: 'Ayla Vex',
        solarSystemId: null,
        shipTypeId: null,
        shipName: null,
        online: true,
        updatedAt: 1,
      },
    ],
  ]);
  const bar = (tokenValid: boolean) => {
    const characters = me.characters.map((c) => ({ ...c, tokenValid }));
    let opened = 0;
    wrap(
      <CharacterBar
        mapId={MAP_ID}
        own={ownOnMap(characters, presence, AYLA, null)}
        hasCharacters
        characters={presence}
        universe={new Map()}
        shipName={() => undefined}
        canSeeAll={false}
        onCenter={() => {}}
        onOpenTracking={() => (opened += 1)}
      >
        <span>views</span>
      </CharacterBar>,
    );
    return () => opened;
  };
  const READ_REFUSED = {
    kind: 'refused' as const,
    message: 'ESI refused the location (HTTP 403): link the character again.',
    since: 1,
  };

  it('has no Track button any more, the views in its place', () => {
    bar(true);
    expect(screen.queryByRole('button', { name: /^Track/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tracking needs a look/ })).toBeNull();
    expect(screen.getByText('views')).toBeTruthy();
  });

  it('shows a mark only while tracking needs a look, opening tracking in the settings', () => {
    const opened = bar(false);
    fireEvent.click(screen.getByRole('button', { name: /Tracking needs a look: 1 sign-in expired/ }));
    expect(opened()).toBe(1);
  });

  it('marks a character whose location tracking cannot read, with ESI’s answer', () => {
    const characters = me.characters.map((c) => ({ ...c, tokenValid: true }));
    let opened = 0;
    wrap(
      <CharacterBar
        mapId={MAP_ID}
        own={ownOnMap(characters, presence, AYLA, null, new Map([[AYLA, READ_REFUSED]]))}
        hasCharacters
        characters={presence}
        universe={new Map()}
        shipName={() => undefined}
        canSeeAll={false}
        onCenter={() => {}}
        onOpenTracking={() => (opened += 1)}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Tracking needs a look: cannot read where Ayla Vex is' }),
    );
    expect(opened).toBe(1);
    expect(screen.getByRole('button', { name: /HTTP 403/ }).getAttribute('data-problem')).toBe('true');
  });
});

describe('a character tracking cannot read', () => {
  it('says why in its row in the settings', async () => {
    tracked = true;
    problem = {
      kind: 'refused',
      message: 'ESI refused the location (HTTP 403): link the character again.',
      since: 1,
    };
    wrap(<MapTrackingSettings map={MAP} can={mapPermissions('member')} />);
    expect(await screen.findByText(/ESI refused the location \(HTTP 403\)/)).toBeTruthy();
    problem = undefined;
  });
});
