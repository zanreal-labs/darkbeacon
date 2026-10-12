'use client';

import { ErrorState, Page } from '../../ui';

/** A page that failed to render (the API is down, a bug): the shell stays, with a way to retry. */
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Page width={640}>
      <ErrorState title="This page could not be loaded" error={error} onRetry={reset} />
    </Page>
  );
}
