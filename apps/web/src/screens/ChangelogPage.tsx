'use client';

import { CHANGELOG } from '../changelog/entries';
import { usePageView } from '../lib/useTelemetry';
import { Badge, Card, CardBody, CardHeader, Page, PageHeader, Stack } from '../ui';
import styles from './ChangelogPage.module.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** `/changelog`: what changed in each release, newest first. */
export function ChangelogPage() {
  usePageView('changelog');
  return (
    <Page width={760}>
      <PageHeader title="What's new" description="What changed in Darkbeacon, newest first." />
      <Stack>
        {CHANGELOG.map((entry, i) => (
          <Card key={entry.version}>
            <CardHeader
              title={entry.title}
              description={dateFormat.format(new Date(`${entry.date}T12:00:00Z`))}
              actions={<Badge tone={i === 0 ? 'accent' : 'neutral'}>{entry.version}</Badge>}
            />
            <CardBody>
              {entry.groups.map((group) => (
                <section key={group.name} className={styles.group}>
                  <h3 className={styles.groupName}>{group.name}</h3>
                  <ul className={styles.items}>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </CardBody>
          </Card>
        ))}
      </Stack>
    </Page>
  );
}
