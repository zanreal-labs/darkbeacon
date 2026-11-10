import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '../../../lib/api';
import { getJumpShare } from '../../../server/jump-share';
import { JumpLoading } from '../../../screens/JumpLoading';
import { SharedJumpGone, SharedJumpScreen, SharedJumpUnavailable } from '../../../screens/SharedJumpScreen';

/**
 * `/j/<token>`: a jump route someone shared, read-only, for anyone with the link (no app shell, no
 * session; the proxy never signs a visit here in). Never indexed, and the address (the secret)
 * never leaves as a referrer.
 */
export async function generateMetadata({ params }: PageProps<'/j/[token]'>): Promise<Metadata> {
  const { token } = await params;
  const view = await getJumpShare(token).catch(() => null);
  const legs = view?.plan.route?.legs ?? [];
  const title =
    view && legs.length > 0
      ? `${legs[0]!.from.name} > ${legs[legs.length - 1]!.to.name} · ${view.plan.ship.name} · Darkbeacon`
      : 'Shared jump route · Darkbeacon';
  return { title, referrer: 'no-referrer', robots: { index: false, follow: false } };
}

export default function SharedJumpRoute({ params }: PageProps<'/j/[token]'>) {
  return (
    <Suspense fallback={<JumpLoading />}>
      <SharedJump params={params} />
    </Suspense>
  );
}

async function SharedJump({ params }: Pick<PageProps<'/j/[token]'>, 'params'>) {
  const { token } = await params;
  const read = await getJumpShare(token).then(
    (view) => ({ view, error: null }),
    (error: unknown) => ({ view: null, error }),
  );
  if (read.error) {
    const busy = read.error instanceof ApiError && read.error.status === 429;
    return (
      <SharedJumpUnavailable
        message={
          busy
            ? 'Too many visits from your address right now. Wait a minute and try again.'
            : 'The server did not answer. Try again in a moment.'
        }
      />
    );
  }
  if (!read.view) return <SharedJumpGone />;
  return <SharedJumpScreen view={read.view} />;
}
