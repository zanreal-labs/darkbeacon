import { ChangelogPage } from '../../../screens/ChangelogPage';

export const metadata = { title: "What's new · Darkbeacon" };

/** `/changelog`: what changed in each release (the update prompt links here). */
export default function ChangelogRoute() {
  return <ChangelogPage />;
}
