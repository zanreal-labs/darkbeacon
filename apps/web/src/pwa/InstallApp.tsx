'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MonitorDown, Share, SquarePlus } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Tooltip, useToast } from '../ui';
import { runInstallPrompt, useInstallOption, type InstallOption } from './install';
import styles from './pwa.module.css';

const STEPS: Record<'ios' | 'mac-safari' | 'manual', { title: string; steps: ReactNode[] }> = {
  ios: {
    title: 'Add Darkbeacon to your Home Screen',
    steps: [
      <>
        Tap <strong>Share</strong> <Share className={styles.inlineIcon} aria-label="(the share icon)" /> in
        the browser&apos;s toolbar.
      </>,
      <>
        Choose <strong>Add to Home Screen</strong> <SquarePlus className={styles.inlineIcon} aria-hidden />.
        Scroll the list down if it is not shown.
      </>,
      <>
        Tap <strong>Add</strong>.
      </>,
    ],
  },
  manual: {
    title: 'Install Darkbeacon as an app',
    steps: [
      <>
        <strong>Chrome or Edge</strong>: click the install icon at the right end of the address bar, or open
        the browser menu and choose <strong>Install Darkbeacon</strong> (Chrome:{' '}
        <strong>Cast, save and share › Install page as app</strong>).
      </>,
      <>
        <strong>Safari on a Mac</strong>: <strong>File › Add to Dock</strong>.
      </>,
      <>
        <strong>Firefox</strong> cannot install sites as apps; use one of the above.
      </>,
    ],
  },
  'mac-safari': {
    title: 'Add Darkbeacon to the Dock',
    steps: [
      <>
        In Safari&apos;s menu bar, choose <strong>File › Add to Dock</strong>.
      </>,
      <>
        Click <strong>Add</strong>.
      </>,
    ],
  },
};

/**
 * The help menu's "Install app": `option` says whether to show the item at all; `run` is its
 * action (the browser's own install prompt, or the steps for Safari); `dialog` renders those
 * steps and belongs outside the menu (which unmounts when it closes).
 */
export function useInstallApp(): { option: InstallOption; run(): void; dialog: ReactNode } {
  const option = useInstallOption();
  const [steps, setSteps] = useState<'ios' | 'mac-safari' | 'manual' | null>(null);
  const run = () => {
    if (option === 'prompt') void runInstallPrompt();
    else if (option === 'ios' || option === 'mac-safari' || option === 'manual') setSteps(option);
  };
  const shown = steps ? STEPS[steps] : null;
  const dialog = (
    <Dialog open={!!shown} onOpenChange={(open) => !open && setSteps(null)}>
      {shown && (
        <DialogContent
          title={shown.title}
          description="It then opens in its own window, without the browser around it."
          width={420}
          footer={
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          }
        >
          <ol className={styles.steps}>
            {shown.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </DialogContent>
      )}
    </Dialog>
  );
  return { option, run, dialog };
}

const HINT_KEY = 'dbk-install-hint';

/**
 * Where people find the install: an icon in the rail (with a dot until it was used or the hint
 * dismissed) and, once per browser, a toast a few seconds after the app opens with an Install
 * button. Nothing in the installed app itself.
 */
export function InstallRailButton({
  className,
  dotClassName,
}: {
  className?: string;
  dotClassName?: string;
}) {
  const install = useInstallApp();
  const toast = useToast();
  const [fresh, setFresh] = useState(false);
  const offered = install.option !== null;

  const remember = () => {
    try {
      window.localStorage.setItem(HINT_KEY, String(Date.now()));
    } catch {
      // storage blocked: fine
    }
  };
  const use = () => {
    remember();
    setFresh(false);
    install.run();
  };

  useEffect(() => {
    if (!offered) return;
    let told: boolean;
    try {
      told = window.localStorage.getItem(HINT_KEY) !== null;
    } catch {
      told = true; // storage blocked: no hint, the icon stays
    }
    if (told) return;
    const timer = window.setTimeout(() => {
      setFresh(true);
      toast({
        title: 'Install Darkbeacon as an app',
        description: 'Its own window next to the game, without the browser around it.',
        tone: 'info',
        duration: 20_000,
        action: { label: 'Install', onClick: use },
      });
      remember();
    }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per browser, when it is offered
  }, [offered]);

  if (!offered) return install.dialog;
  return (
    <>
      <Tooltip content="Install Darkbeacon as an app" side="right">
        <button type="button" className={className} aria-label="Install app" onClick={use}>
          <MonitorDown />
          {fresh && <span className={dotClassName} aria-hidden />}
        </button>
      </Tooltip>
      {install.dialog}
    </>
  );
}
