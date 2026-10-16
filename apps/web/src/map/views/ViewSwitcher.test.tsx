// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { buildPath, routes, type MapViewDto, type UserPreferencesDto } from '@darkbeacon/shared';
import { MAP_ID } from '../../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { CANVAS_PREFS_KEY, canvasPrefs, setCanvasPrefs, DEFAULT_CANVAS_PREFS } from '../canvas/prefs';
import { LAYOUT_KEY, type WidgetsLayout } from '../widgets/layout';
import { useWidgetsLayout } from '../widgets/useWidgetsLayout';
import { toMapView, VIEWS_AREA } from './format';
import { useViews } from './useViews';
import { slotKey, ViewSwitcher } from './ViewSwitcher';

// Radix measures, scrolls and captures the pointer in menus and selects, which jsdom cannot.
installFlowMocks();
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

let stored: Record<string, unknown> = {};
const puts: { preferences: unknown[]; views: MapViewDto[][] } = { preferences: [], views: [] };

setupMockServer(
  http.get(routes.characters.preferences.path, () =>
    HttpResponse.json({ preferences: stored, updatedAt: 1 } satisfies UserPreferencesDto),
  ),
  http.put(routes.characters.updatePreferences.path, async ({ request }) => {
    const body = (await request.json()) as { preferences: Record<string, unknown> };
    puts.preferences.push(body.preferences);
    stored = { ...stored, ...body.preferences };
    return HttpResponse.json({ preferences: stored, updatedAt: 2 });
  }),
  http.put(buildPath(routes.maps.setViews.path, { mapId: MAP_ID }), async ({ request }) => {
    const body = (await request.json()) as { views: MapViewDto[] };
    puts.views.push(body.views);
    return HttpResponse.json(body.views);
  }),
);

beforeEach(() => {
  window.localStorage.clear();
  setCanvasPrefs(DEFAULT_CANVAS_PREFS);
  stored = {};
  puts.preferences = [];
  puts.views = [];
});

function Harness({ views, canPublish = false }: { views?: MapViewDto[]; canPublish?: boolean }) {
  const widgets = useWidgetsLayout();
  const controller = useViews({ mapId: MAP_ID, views, canPublish, widgets });
  return (
    <>
      <ViewSwitcher views={controller} />
      <output data-testid="visible">{widgets.visible.join(',')}</output>
      <input aria-label="Notes" />
      <button type="button" onClick={() => widgets.setShown('history', true)}>
        Show history
      </button>
    </>
  );
}

const render = (ui = <Harness />) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
  );

const visible = () => screen.getByTestId('visible').textContent;
const slot = (n: number) => screen.getByRole('button', { name: new RegExp(`^View ${n}:`) });
const alt = (code: string, extra: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code, key: '¡', altKey: true, bubbles: true, ...extra }),
    );
  });

describe('quick view slots', () => {
  it('show the built-in views on 1, 2, 3 and put one on the screen with a click, highlighted', async () => {
    render();
    expect(slot(1).getAttribute('aria-label')).toBe('View 1: Scan');
    expect(slot(2).getAttribute('aria-label')).toBe('View 2: PvP');
    expect(slot(3).getAttribute('aria-label')).toBe('View 3: Roll');
    expect(slot(1).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(slot(3));
    expect(visible()).toBe('info,connections,local');
    expect(slot(3).getAttribute('aria-pressed')).toBe('true');
    expect((JSON.parse(window.localStorage.getItem(LAYOUT_KEY)!) as WidgetsLayout).visible).toEqual([
      'info',
      'connections',
      'local',
    ]);

    fireEvent.click(slot(1));
    expect(visible()).toBe('info,signatures,routes');
    expect(slot(1).getAttribute('aria-pressed')).toBe('true');
    expect(slot(3).getAttribute('aria-pressed')).toBe('false');
  });

  it('answer Alt+1, Alt+2, Alt+3 by the key’s place, but not while typing or with other modifiers', () => {
    render();
    alt('Digit2');
    expect(visible()).toBe('info,local,kills,comments');
    alt('Numpad3');
    expect(visible()).toBe('info,connections,local');
    alt('Digit1', { shiftKey: true });
    alt('Digit1', { ctrlKey: true });
    expect(visible()).toBe('info,connections,local');
    // In a text field Alt+1 is text.
    const field = screen.getByRole('textbox', { name: 'Notes' });
    field.focus();
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', altKey: true, bubbles: true }));
    });
    expect(visible()).toBe('info,connections,local');
    expect(
      slotKey({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit4' }),
    ).toBeNull();
    expect(
      slotKey({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit1' }),
    ).toBeNull();
  });

  it('take the map’s published default over the built-in view, and my pin over both', async () => {
    const fleet = toMapView(
      'fleet',
      'Fleet',
      {
        version: 1,
        layout: { version: 2, visible: ['local'], boxes: {}, order: [] },
        canvas: { minimap: 'off', background: 'lines' },
      },
      1,
      1,
    );
    stored = {
      [VIEWS_AREA]: {
        version: 1,
        views: [
          {
            id: 'p1',
            name: 'Mine',
            view: {
              version: 1,
              layout: { version: 2, visible: ['kills'], boxes: {}, order: [] },
              canvas: {},
            },
            updatedAt: 1,
          },
        ],
        pins: { [MAP_ID]: { '2': { source: 'personal', id: 'p1' } } },
      },
    };
    render(<Harness views={[fleet]} />);
    await waitFor(() => expect(slot(2).getAttribute('aria-label')).toBe('View 2: Mine'));
    expect(slot(1).getAttribute('aria-label')).toBe('View 1: Fleet');
    fireEvent.click(slot(1));
    expect(visible()).toBe('local');
    // The view's canvas options apply too.
    expect(canvasPrefs()).toMatchObject({ minimap: 'off', background: 'lines' });
    expect(JSON.parse(window.localStorage.getItem(CANVAS_PREFS_KEY)!)).toMatchObject({ minimap: 'off' });
    fireEvent.click(slot(2));
    expect(visible()).toBe('kills');

    // Back to the map's defaults.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset slots to the map’s defaults' }));
    await waitFor(() => expect(slot(2).getAttribute('aria-label')).toMatch(/^View 2: PvP/));
    expect(puts.preferences.at(-1)).toEqual({ [VIEWS_AREA]: expect.objectContaining({ pins: {} }) });
  });

  it('saves the screen as my own view and pins it to a slot', async () => {
    const user = userEvent.setup();
    render();
    fireEvent.click(slot(2));
    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Save the screen as a view…' }));
    // Members do not publish.
    expect(screen.queryByRole('checkbox', { name: /Publish/ })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Hunting');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts.preferences).toHaveLength(1));
    const saved = (
      puts.preferences[0] as Record<string, { views: { name: string; view: { layout: WidgetsLayout } }[] }>
    )[VIEWS_AREA]!;
    expect(saved.views.map((v) => [v.name, v.view.layout.visible])).toEqual([
      ['Hunting', ['info', 'local', 'kills', 'comments']],
    ]);

    await user.click(screen.getByRole('button', { name: 'Views' }));
    // Into the view's submenu and its Pin to slot with the keyboard, as a pilot would.
    const hunting = await screen.findByRole('menuitem', { name: /Hunting/ });
    act(() => hunting.focus());
    fireEvent.keyDown(hunting, { key: 'ArrowRight' });
    const pin = await screen.findByRole('menuitem', { name: 'Pin to slot' });
    act(() => pin.focus());
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Slot 3/ }));
    await waitFor(() => expect(slot(3).getAttribute('aria-label')).toBe('View 3: Hunting'));
  });

  it('keeps a changed built-in view as my own copy on its slot, in one save', async () => {
    const user = userEvent.setup();
    render();
    fireEvent.click(slot(1));
    expect(slot(1).hasAttribute('data-modified')).toBe(false);
    // Change the screen after switching: the slot stays lit, with the changed mark.
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    await waitFor(() => expect(slot(1).hasAttribute('data-modified')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(await screen.findByRole('menuitem', { name: /Save changes to Scan/ }));
    await waitFor(() => expect(puts.preferences).toHaveLength(1));
    const saved = (
      puts.preferences[0] as Record<
        string,
        { views: { id: string; name: string }[]; pins: Record<string, Record<string, { id: string }>> }
      >
    )[VIEWS_AREA]!;
    expect(saved.views.map((v) => v.name)).toEqual(['Scan']);
    expect(saved.pins[MAP_ID]!['1']!.id).toBe(saved.views[0]!.id);
    await waitFor(() => expect(slot(1).getAttribute('aria-label')).toBe('View 1: Scan'));
    expect(slot(1).hasAttribute('data-modified')).toBe(false);
  });

  it('lets managers publish the screen to the map as everyone’s view on a slot', async () => {
    const user = userEvent.setup();
    render(<Harness canPublish views={[]} />);
    fireEvent.click(slot(1));
    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Save the screen as a view…' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Fleet scan');
    await user.click(screen.getByRole('checkbox', { name: /Publish to the map/ }));
    await user.click(screen.getByRole('combobox', { name: /quick slot/ }));
    await user.click(await screen.findByRole('option', { name: /Slot 2/ }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(puts.views).toHaveLength(1));
    expect(puts.views[0]!.map((v) => [v.name, v.slot, v.view.layout.visible])).toEqual([
      ['Fleet scan', 2, ['info', 'signatures', 'routes']],
    ]);
    expect(puts.preferences).toEqual([]);
  });
});
