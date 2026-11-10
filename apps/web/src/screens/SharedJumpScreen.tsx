'use client';

import dynamic from 'next/dynamic';
import { Link2Off } from 'lucide-react';
import type { JumpShareViewDto } from '@darkbeacon/shared';
import { Button, EmptyState } from '../ui';
import { JumpLoading } from './JumpLoading';
import styles from './PublicMap.module.css';

// The star map draws on a canvas sized to the window: browser only.
const SharedJumpView = dynamic(() => import('../jump/SharedJumpView').then((m) => m.SharedJumpView), {
  ssr: false,
  loading: () => <JumpLoading />,
});

export function SharedJumpScreen({ view }: { view: JumpShareViewDto }) {
  return <SharedJumpView view={view} />;
}

/** Nobody shared this token (or it was mistyped). */
export function SharedJumpGone() {
  return (
    <main className={styles.standalone}>
      <EmptyState
        icon={<Link2Off />}
        title="This route link does not work"
        description="Check the address, or ask whoever shared it for the link again."
        actions={
          <Button asChild>
            <a href="/">Open Darkbeacon</a>
          </Button>
        }
      />
    </main>
  );
}

/** The server could not read the link right now (busy, restarting): try again. */
export function SharedJumpUnavailable({ message }: { message: string }) {
  return (
    <main className={styles.standalone}>
      <EmptyState
        tone="danger"
        icon={<Link2Off />}
        title="The route could not be loaded"
        description={message}
        actions={
          <Button asChild>
            <a href="">Try again</a>
          </Button>
        }
      />
    </main>
  );
}
