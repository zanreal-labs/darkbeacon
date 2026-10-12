'use client';

import { useState } from 'react';
import { Inbox, Plus, Send, Settings, Star, Trash2, UserRound } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ChoiceGroup,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Kbd,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Page,
  PageHeader,
  Row,
  Rows,
  SearchPicker,
  Select,
  Skeleton,
  Stack,
  StatusDot,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
  type PickerOption,
} from '../ui';
import styles from './ComponentGallery.module.css';

const PILOTS: PickerOption[] = [
  { key: '1', label: 'Ayla Vex', imageUrl: null },
  { key: '2', label: 'Torren Kade', imageUrl: null },
  { key: '3', label: 'Hard Knocks Inc.', detail: '[HKRAB]', imageUrl: null, shape: 'rounded' },
];

/** Every design-system part in one place, in the light and the dark theme side by side. */
export function ComponentGallery() {
  return (
    <Page width={1400}>
      <PageHeader
        title="Components"
        description="The design system as screens use it (docs/design.md). Light on the left, dark on the right."
      />
      <div className={styles.columns}>
        <div data-theme="default" className={styles.column}>
          <Gallery scheme="Light" />
        </div>
        <div data-theme="dark" className={styles.column}>
          <Gallery scheme="Dark" />
        </div>
      </div>
    </Page>
  );
}

function Gallery({ scheme }: { scheme: string }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState('eve');
  const [picked, setPicked] = useState<PickerOption | null>(PILOTS[2]!);
  const [role, setRole] = useState('member');

  return (
    <Stack>
      <h2 className={styles.scheme}>{scheme}</h2>

      <Card>
        <CardHeader
          title="Card anatomy"
          description="Header with title, one line of description and at most one primary action."
          actions={
            <Button size="sm" icon={<Plus />}>
              Add
            </Button>
          }
        />
        <CardBody>
          <p className="muted">The body sits on the same surface; padding is 16 px on every side.</p>
        </CardBody>
        <CardFooter>
          <span className={styles.footerNote}>The footer is a divider, not a darker band.</span>
          <Button variant="ghost">Discard</Button>
          <Button variant="primary">Save</Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title="Buttons" description="One primary per view; destructive actions confirm first." />
        <CardBody>
          <div className={styles.wrap}>
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Delete…
            </Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className={styles.wrap}>
            <Button size="sm" icon={<Send />}>
              Small
            </Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <IconButton label="Settings" icon={<Settings />} />
            <IconButton label="Star" icon={<Star />} size="sm" />
            <IconButton label="Remove" icon={<Trash2 />} size="sm" onClick={() => setConfirm(true)} />
            <Button variant="discord">Discord</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Status" />
        <CardBody>
          <div className={styles.wrap}>
            <Badge>Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="success" dot>
              Posting
            </Badge>
            <Badge tone="warning">Search off</Badge>
            <Badge tone="danger">Blocked</Badge>
            <Badge variant="outline">Outline</Badge>
            <StatusDot color="var(--dbk-color-success)" pulse label="Live" />
            <Kbd>/</Kbd>
          </div>
          <Stack className={styles.callouts}>
            <Callout tone="accent" title="Accent">
              A hint about what this does.
            </Callout>
            <Callout tone="warning" title="Warning">
              Something to check before going on.
            </Callout>
            <Callout tone="danger" title="Danger">
              What went wrong, in words.
            </Callout>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rows" description="Lists inside cards: people, characters, sessions." />
        <CardBody flush>
          <Rows>
            <Row
              leading={<Avatar name="Ayla Vex" size={36} />}
              title={
                <>
                  <span>Ayla Vex</span>
                  <Badge tone="accent">Main</Badge>
                </>
              }
              meta="Hard Knocks Inc. [HKRAB]"
              actions={<IconButton label="More" icon={<Settings />} tooltip={false} />}
            />
            <Row
              leading={<Avatar name="Torren Kade" size={36} />}
              title={<span>Torren Kade</span>}
              meta="Active 5 min ago"
            />
          </Rows>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fields" />
        <CardBody>
          <div className={styles.fields}>
            <Field label="Text" hint="A hint under the control.">
              <Input placeholder="Home chain" />
            </Field>
            <Field label="With an error" error="Pick a server first">
              <Input defaultValue="nope" />
            </Field>
            <Field label="Select">
              <Select
                value={role}
                onValueChange={setRole}
                options={[
                  { value: 'viewer', label: 'Viewer' },
                  { value: 'member', label: 'Member' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />
            </Field>
            <Field label="Search picker">
              <SearchPicker
                value={picked}
                onChange={setPicked}
                cacheKey={['gallery', scheme]}
                placeholder="Search a name"
                search={async (q) => ({
                  options: PILOTS.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())),
                })}
              />
            </Field>
          </div>
          <div className={styles.wrap}>
            <Checkbox
              checked={checked}
              onCheckedChange={setChecked}
              label="Checkbox"
              description="With a line of help."
            />
            <Switch checked={on} onCheckedChange={setOn} label="Switch" description="Applies at once." />
          </div>
          <ChoiceGroup
            aria-label="Choice"
            value={choice}
            onValueChange={setChoice}
            options={[
              { value: 'eve', label: 'EVE Online', icon: <UserRound />, description: 'One card per option.' },
              { value: 'discord', label: 'Discord', description: 'With a line of explanation.' },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Overlays and tabs" />
        <CardBody>
          <div className={styles.wrap}>
            <Menu>
              <MenuTrigger asChild>
                <Button>Menu</Button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuItem icon={<Star />}>Open this map first</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} tone="danger">
                  Delete…
                </MenuItem>
              </MenuContent>
            </Menu>
            <Button
              onClick={() =>
                toast({ title: 'Saved', description: 'A toast says what happened.', tone: 'success' })
              }
            >
              Toast
            </Button>
          </div>
          <Tabs defaultValue="one">
            <TabsList aria-label="Tabs">
              <TabsTrigger value="one">General</TabsTrigger>
              <TabsTrigger value="two">Access</TabsTrigger>
            </TabsList>
            <TabsContent value="one">
              <p className="muted">Tab content.</p>
            </TabsContent>
            <TabsContent value="two">
              <p className="muted">More content.</p>
            </TabsContent>
          </Tabs>
        </CardBody>
      </Card>

      <Card>
        <EmptyState
          compact
          icon={<Inbox />}
          title="Empty state"
          description="What is missing and what to do next."
          actions={<Button icon={<Plus />}>Add one</Button>}
        />
      </Card>
      <Card>
        <ErrorState compact error={new Error('The server did not answer.')} onRetry={() => undefined} />
      </Card>
      <Card>
        <CardBody>
          <Stack>
            <Skeleton width="60%" height={12} />
            <Skeleton width="40%" height={12} />
          </Stack>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this?"
        description="Destructive actions always ask first, with a danger button."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => undefined}
      />
    </Stack>
  );
}
