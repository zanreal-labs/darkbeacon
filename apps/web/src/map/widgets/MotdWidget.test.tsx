// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes } from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import { MAP_ID } from '../../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { emptyMapState } from '../mapState';
import { useMapStore } from '../useMapStore';
import { DOCK_ORDER, dockOrder, LAYOUT_KEY } from './layout';
import { MapWidgets } from './MapWidgets';
import { MOTD_HIDDEN_KEY, motdFingerprint, useMotd } from './MotdWidget';
import { useWidgetsLayout } from './useWidgetsLayout';
import { WidgetsMenu } from './WidgetsMenu';

// Radix measures, scrolls and captures the pointer in menus, which jsdom cannot.
installFlowMocks();
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

// jsdom lays nothing out: the widgets' layer is a 1440x848 map.
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.widgetsLayer !== undefined ? 1440 : 0;
    },
  },
  clientHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.widgetsLayer !== undefined ? 848 : 0;
    },
  },
});

const MOTD = 'Fleet comms: **Darkbeacon Ops** in game.\n\nIntel: [zkill](https://zkillboard.com)';
const puts: unknown[] = [];

setupMockServer(
  http.get(buildPath(routes.tracking.characters.path, { mapId: MAP_ID }), () => HttpResponse.json([])),
  http.put(buildPath(routes.maps.setMotd.path, { mapId: MAP_ID }), async ({ request }) => {
    const body = (await request.json()) as { motd: string };
    puts.push(body);
    return HttpResponse.json({ motd: body.motd.trim() });
  }),
);

const matchMedia = window.matchMedia;
beforeEach(() => {
  window.localStorage.clear();
  puts.length = 0;
});
afterEach(() => {
  window.matchMedia = matchMedia;
});

/** The map screen's widgets with nothing selected: the menu, and the windows over the map. */
function Harness({ initial, role = 'member' }: { initial?: string; role?: 'member' | 'manager' }) {
  const [motd, setMotd] = useState(initial);
  const can = mapPermissions(role);
  const store = useMapStore(MAP_ID);
  const controller = useWidgetsLayout();
  const state = useMotd(MAP_ID, motd, can.manage);
  return (
    <div style={{ position: 'relative', height: 900 }}>
      <WidgetsMenu controller={controller} plugins={[]} shown onShownChange={() => {}} motd={state} />
      {/* The map's stream bringing someone else's message. */}
      <button type="button" onClick={() => setMotd('Moved to **Ops 2**')}>
        Someone changes it
      </button>
      <MapWidgets
        mapId={MAP_ID}
        system={undefined}
        motd={state}
        info={undefined}
        universe={new Map()}
        labels={[]}
        state={{ ...emptyMapState(), has: { signatures: true, characters: true } }}
        can={can}
        store={store}
        myCharacters={[]}
        plugins={[]}
        controller={controller}
        shown
        onSelectSystem={() => {}}
        onCover={() => {}}
      />
    </div>
  );
}

const view = (props: Parameters<typeof Harness>[0]) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <Harness {...props} />
      </ToastProvider>
    </TooltipProvider>,
  );

const motdWindow = () => screen.queryByRole('region', { name: 'Message of the day' });

describe('the message of the day', () => {
  it('shows on entering the map with nothing selected, as Markdown with links opening in a new tab', async () => {
    // A layout kept before the widget existed.
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ version: 2, visible: ['info', 'signatures'], boxes: {}, order: [] }),
    );
    view({ initial: MOTD });
    const window_ = await waitFor(() => {
      const found = motdWindow();
      expect(found).toBeTruthy();
      return found!;
    });
    // Docked in the column, nothing else showing without a selection.
    expect(window_.dataset.docked).toBe('true');
    expect(screen.queryByRole('region', { name: 'System info' })).toBeNull();
    expect(within(window_).getByText('Darkbeacon Ops').tagName).toBe('STRONG');
    const link = within(window_).getByRole('link', { name: 'zkill' });
    expect(link.getAttribute('href')).toBe('https://zkillboard.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // Members read it; nothing to edit.
    expect(within(window_).queryByRole('button', { name: 'Edit the message of the day' })).toBeNull();
  });

  it('takes no space while the map has none, and members are offered nothing to write', async () => {
    const user = userEvent.setup();
    view({});
    expect(motdWindow()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await screen.findByRole('menuitemcheckbox', { name: 'Signatures' });
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Message of the day' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Write a message of the day/ })).toBeNull();
  });

  it('hides until it changes, and comes back from the widgets menu', async () => {
    const user = userEvent.setup();
    view({ initial: MOTD });
    await user.click(within(motdWindow()!).getByRole('button', { name: 'Hide until it changes' }));
    expect(motdWindow()).toBeNull();
    // Remembered as a fingerprint per map, not as the message.
    expect(JSON.parse(window.localStorage.getItem(MOTD_HIDDEN_KEY)!)).toEqual({
      [MAP_ID]: motdFingerprint(MOTD),
    });

    // A new message shows again.
    await user.click(screen.getByRole('button', { name: 'Someone changes it' }));
    expect(within(motdWindow()!).getByText('Ops 2')).toBeTruthy();

    // Off and on again in the menu.
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Message of the day' }));
    await user.keyboard('{Escape}');
    expect(motdWindow()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Message of the day' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    await user.click(item);
    await user.keyboard('{Escape}');
    expect(motdWindow()).toBeTruthy();
  });

  it('is edited in place by managers: Save sends it, Cancel keeps what was there', async () => {
    const user = userEvent.setup();
    view({ initial: MOTD, role: 'manager' });
    const window_ = motdWindow()!;

    await user.click(within(window_).getByRole('button', { name: 'Edit the message of the day' }));
    const field = within(motdWindow()!).getByRole('textbox', { name: 'Message of the day' });
    expect((field as HTMLTextAreaElement).value).toBe(MOTD);
    await user.type(field, ' and more');
    await user.click(within(motdWindow()!).getByRole('button', { name: 'Cancel' }));
    expect(puts).toEqual([]);
    expect(within(motdWindow()!).queryByRole('textbox')).toBeNull();
    expect(motdWindow()!.textContent).not.toContain('and more');

    await user.click(within(motdWindow()!).getByRole('button', { name: 'Edit the message of the day' }));
    const again = within(motdWindow()!).getByRole('textbox', { name: 'Message of the day' });
    await user.clear(again);
    await user.paste('Comms: [Discord](https://discord.gg/x)');
    await user.click(within(motdWindow()!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toEqual([{ motd: 'Comms: [Discord](https://discord.gg/x)' }]));
    // The saved message at once, before the stream brings it.
    const link = await within(motdWindow()!).findByRole('link', { name: 'Discord' });
    expect(link.getAttribute('href')).toBe('https://discord.gg/x');
  });

  it('is written by managers from the widgets menu while the map has none; saved empty it goes', async () => {
    const user = userEvent.setup();
    view({ role: 'manager' });
    expect(motdWindow()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(await screen.findByRole('menuitem', { name: /Write a message of the day/ }));
    const field = await within(motdWindow()!).findByRole('textbox', { name: 'Message of the day' });
    await user.type(field, '   ');
    await user.click(within(motdWindow()!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toEqual([{ motd: '   ' }]));
    await waitFor(() => expect(motdWindow()).toBeNull());
  });

  it('opens in the sheet on phones, first in the dock, with nothing selected', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const user = userEvent.setup();
    view({ initial: MOTD });
    const dock = screen.getByRole('list', { name: 'Widgets' });
    expect(
      within(dock)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Message of the day']);
    expect(within(motdWindow()!).getByRole('link', { name: 'zkill' })).toBeTruthy();
    await user.click(within(motdWindow()!).getByRole('button', { name: 'Close Message of the day' }));
    expect(motdWindow()).toBeNull();
    // Closed, not hidden: the dock still has it.
    await user.click(within(dock).getByRole('button', { name: 'Message of the day' }));
    expect(motdWindow()).toBeTruthy();
  });

  it('stands at the top of the column', () => {
    expect(DOCK_ORDER[0]).toBe('motd');
    expect(dockOrder(['signatures', 'info', 'motd'])).toEqual(['motd', 'info', 'signatures']);
  });
});
