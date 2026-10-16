'use client';

import { useState, type ReactNode } from 'react';
import { Share, SquarePlus } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent } from '../ui';
import { runInstallPrompt, useInstallOption, type InstallOption } from './install';
import styles from './pwa.module.css';

const STEPS: Record<'ios' | 'mac-safari', { title: string; steps: ReactNode[] }> = {
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
  const [steps, setSteps] = useState<'ios' | 'mac-safari' | null>(null);
  const run = () => {
    if (option === 'prompt') void runInstallPrompt();
    else if (option === 'ios' || option === 'mac-safari') setSteps(option);
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
