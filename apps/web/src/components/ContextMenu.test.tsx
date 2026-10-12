// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu, placeAtPoint, placeBeside, type MenuItem } from './ContextMenu';
import '../test/setup';

function items(spy = vi.fn()): MenuItem[] {
  return [
    {
      kind: 'submenu',
      label: 'Status',
      hint: 'Unknown',
      items: [
        { kind: 'radio', label: 'Unknown', checked: true, onSelect: () => spy('unknown') },
        { kind: 'radio', label: 'Hostile', checked: false, onSelect: () => spy('hostile') },
      ],
    },
    {
      kind: 'submenu',
      label: 'Labels',
      items: [{ kind: 'check', label: 'Scouted', checked: false, onSelect: () => spy('scouted') }],
    },
    { kind: 'input', label: 'Tag', value: '', onSubmit: (v) => spy(`tag:${v}`) },
    { kind: 'action', label: 'Copy name', onSelect: () => spy('copy') },
    { kind: 'separator' },
    { kind: 'action', label: 'Remove from map', danger: true, onSelect: () => spy('remove') },
  ];
}

function open(spy = vi.fn(), onClose = vi.fn(), at = { x: 100, y: 100 }) {
  render(<ContextMenu title="J123456" x={at.x} y={at.y} items={items(spy)} onClose={onClose} />);
  return { spy, onClose };
}

const submenus = () => screen.queryAllByRole('menu').filter((m) => m.dataset.level !== '0');

afterEach(() => vi.restoreAllMocks());

describe('ContextMenu', () => {
  it('shows a short top level with the title, a trailing value and a chevron per submenu', () => {
    open();
    const root = screen.getByRole('menu', { name: 'J123456' });
    expect(
      within(root)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['StatusUnknown', 'Labels', 'Tag…', 'Copy name', 'Remove from map']);
    expect(
      within(root)
        .getByRole('menuitem', { name: /Status/ })
        .getAttribute('aria-haspopup'),
    ).toBe('menu');
    expect(submenus()).toHaveLength(0);
  });

  it('opens a submenu on hover after a short delay, and only one at a time', async () => {
    open();
    await userEvent.hover(screen.getByRole('menuitem', { name: /Status/ }));
    expect(submenus()).toHaveLength(0);
    expect(await screen.findByRole('menu', { name: 'Status' })).toBeTruthy();

    await userEvent.hover(screen.getByRole('menuitem', { name: 'Labels' }));
    await screen.findByRole('menu', { name: 'Labels' });
    expect(submenus().map((m) => m.getAttribute('aria-label'))).toEqual(['Labels']);
  });

  it('opens a submenu at once on click (and tap)', async () => {
    open();
    await userEvent.click(screen.getByRole('menuitem', { name: /Status/ }));
    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Status/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('selecting a radio runs it and closes the menu; checks in submenus keep it open', async () => {
    const { spy, onClose } = open();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Labels' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Scouted' }));
    expect(spy).toHaveBeenCalledWith('scouted');
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('menuitem', { name: /Status/ }));
    const status = screen.getByRole('menu', { name: 'Status' });
    expect(within(status).getByRole('menuitemradio', { name: 'Unknown' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await userEvent.click(within(status).getByRole('menuitemradio', { name: 'Hostile' }));
    expect(spy).toHaveBeenCalledWith('hostile');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('is driven by the keyboard: arrows, ArrowRight into a submenu, ArrowLeft and Escape out', async () => {
    const { spy, onClose } = open();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('StatusUnknown');
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('Remove from map');
    await userEvent.keyboard('{Home}{ArrowRight}');
    const status = screen.getByRole('menu', { name: 'Status' });
    expect(document.activeElement).toBe(within(status).getByRole('menuitemradio', { name: 'Unknown' }));

    await userEvent.keyboard('{ArrowLeft}');
    expect(submenus()).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe('StatusUnknown');

    await userEvent.keyboard('{Enter}');
    expect(document.activeElement?.textContent).toBe('Unknown');
    await userEvent.keyboard('{Escape}');
    expect(submenus()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(spy).toHaveBeenCalledWith('hostile');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape on the top level closes the menu; typing a letter jumps to the row', async () => {
    const { onClose } = open();
    await userEvent.keyboard('c');
    expect(document.activeElement?.textContent).toBe('Copy name');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('edits a tag inline: Enter saves, Escape goes back to the row', async () => {
    const { spy, onClose } = open();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tag…' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Tag…' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Tag' }), ' C3a {Enter}');
    expect(spy).toHaveBeenCalledWith('tag:C3a');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores the click that ends the long press which opened it', () => {
    const { spy } = open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy name' }), { detail: 1 });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Copy name' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy name' }), { detail: 1 });
    expect(spy).toHaveBeenCalledWith('copy');
  });

  it('closes on a pointer down outside it', async () => {
    const { onClose } = open();
    await new Promise((r) => setTimeout(r));
    await userEvent.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('flips left and up near the bottom right corner, submenus too (kept 8 px inside)', async () => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    const box = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'menu')
        return box(parseFloat(this.style.left) || 0, parseFloat(this.style.top) || 0, 240, 300);
      return box(1160, 860, 240, 30);
    });
    open(vi.fn(), vi.fn(), { x: 1400, y: 880 });
    const root = screen.getByRole('menu', { name: 'J123456' });
    expect([root.style.left, root.style.top]).toEqual(['1160px', '580px']);

    await userEvent.click(screen.getByRole('menuitem', { name: /Status/ }));
    const status = screen.getByRole('menu', { name: 'Status' });
    await waitFor(() => expect([status.style.left, status.style.top]).toEqual(['918px', '592px']));
  });

  it('becomes a bottom sheet on phones, where a submenu replaces the rows and has a back row', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q }));
    open();
    await userEvent.click(screen.getByRole('menuitem', { name: /Status/ }));
    expect(screen.getAllByRole('menu').map((m) => m.getAttribute('aria-label'))).toEqual(['Status']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Status' }));
    expect(screen.getAllByRole('menu').map((m) => m.getAttribute('aria-label'))).toEqual(['J123456']);
    vi.unstubAllGlobals();
  });
});

describe('placement', () => {
  const viewport = { width: 1440, height: 900 };
  const size = { width: 240, height: 300 };

  it('opens below and right of the pointer when there is room', () => {
    expect(placeAtPoint({ x: 100, y: 100 }, size, viewport)).toEqual({
      left: 100,
      top: 100,
      side: 'right',
      flippedUp: false,
    });
  });

  it('flips left at the right edge and up at the bottom edge, and never leaves the viewport', () => {
    expect(placeAtPoint({ x: 1300, y: 800 }, size, viewport)).toEqual({
      left: 1060,
      top: 500,
      side: 'left',
      flippedUp: true,
    });
    expect(placeAtPoint({ x: 100, y: 200 }, { width: 240, height: 1000 }, viewport).top).toBe(8);
  });

  it('puts submenus beside the trigger, on the left when the right has no room', () => {
    const anchor = { left: 100, right: 340, top: 200, bottom: 230 };
    expect(placeBeside(anchor, size, viewport)).toMatchObject({ left: 342, top: 195, side: 'right' });
    const nearRight = { left: 1180, right: 1420, top: 700, bottom: 730 };
    expect(placeBeside(nearRight, size, viewport)).toMatchObject({
      left: 938,
      top: 435,
      side: 'left',
      flippedUp: true,
    });
  });
});
