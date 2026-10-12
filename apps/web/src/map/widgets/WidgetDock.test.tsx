// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Info, Puzzle, Radar, UsersRound } from 'lucide-react';
import { TooltipProvider } from '../../ui';
import { WidgetDock, type DockTab } from './WidgetDock';

const tab = (id: string, title: string, icon = <Puzzle />): DockTab => ({
  id,
  title,
  icon,
  render: () => <p>{title} content</p>,
});

/** The core widgets plus two plugin widgets, as with plugins enabled. */
const tabs = [
  tab('system', 'System', <Info />),
  tab('signatures', 'Signatures', <Radar />),
  tab('local', 'Local', <UsersRound />),
  tab('plugin:sample', 'Sample widget'),
  tab('plugin:added', 'Added since start'),
];

const TAB_WIDTH = 90;
const STRIP_WIDTH = 300;

/** jsdom has no layout: every tab is 90 px wide, the strip shows 300 px of them. */
function fakeLayout() {
  const box = (el: HTMLElement) => {
    if (el.getAttribute('role') === 'tablist')
      return { client: STRIP_WIDTH, scroll: TAB_WIDTH * el.children.length, left: 0 };
    if (el.getAttribute('role') === 'tab') {
      const index = [...el.parentElement!.children].indexOf(el);
      return { client: TAB_WIDTH, scroll: TAB_WIDTH, left: index * TAB_WIDTH };
    }
    return { client: 0, scroll: 0, left: 0 };
  };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this).client;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this).scroll;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this).client;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this).left;
  });
}

function Dock({
  active,
  open = true,
  onChange = () => {},
}: {
  active: string;
  open?: boolean;
  onChange?: () => void;
}) {
  return (
    <TooltipProvider>
      <WidgetDock tabs={tabs} active={active} open={open} onChange={onChange} />
    </TooltipProvider>
  );
}

describe('WidgetDock', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps every tab reachable when plugin widgets make the strip too wide', async () => {
    fakeLayout();
    const onChange = vi.fn();
    const { rerender } = render(<Dock active="system" onChange={onChange} />);
    const strip = screen.getByRole('tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    // More tabs to the right: the strip says so (a fade), instead of running off the screen.
    expect(strip.dataset.moreEnd).toBe('true');
    expect(strip.dataset.moreStart).toBeUndefined();

    // Opening a tab out of sight scrolls the strip (and only the strip) to it.
    rerender(<Dock active="plugin:added" onChange={onChange} />);
    const last = screen.getByRole('tab', { name: /Added since start/ });
    expect(strip.scrollLeft).toBe(4 * TAB_WIDTH + TAB_WIDTH - STRIP_WIDTH + 8);
    act(() => void strip.dispatchEvent(new Event('scroll')));
    expect(strip.dataset.moreStart).toBe('true');
    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(last.getAttribute('title')).toBe('Added since start');
    expect(screen.getByRole('tabpanel', { name: 'Added since start' }).textContent).toBe(
      'Added since start content',
    );

    await userEvent.click(screen.getByRole('tab', { name: /Sample widget/ }));
    expect(onChange).toHaveBeenCalledWith('plugin:sample', true);
  });

  it('turns a vertical mouse wheel into sideways scrolling of the strip', () => {
    fakeLayout();
    render(<Dock active="system" open={false} />);
    const strip = screen.getByRole('tablist');
    const wheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    strip.dispatchEvent(wheel);
    expect(strip.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
  });
});
