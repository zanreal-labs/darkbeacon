import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '../ui';

export default function NotFound() {
  return (
    <main
      style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--dbk-space-4)' }}
    >
      <EmptyState
        icon={<Compass />}
        title="Nothing here"
        description="This page does not exist. It may have moved, or the link is wrong."
        actions={
          <Button asChild variant="primary">
            <Link href="/maps">Back to maps</Link>
          </Button>
        }
      />
    </main>
  );
}
