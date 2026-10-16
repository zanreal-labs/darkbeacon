'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookOpen,
  Bug,
  CircleHelp,
  Inbox,
  MessageSquareHeart,
  MonitorDown,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { routes, type SupportClientDto, type TelemetryClientDto } from '@darkbeacon/shared';
import { api } from '../lib/api';
import {
  buildSupportContext,
  fetchUnread,
  IN_APP_CONTEXT_KEY,
  installErrorCapture,
  openSupportPopup,
  supportClientKey,
  supportPage,
  type SupportKind,
} from '../lib/support';
import { browserOptedOut, track } from '../lib/telemetry';
import { InstallRailButton, useInstallApp } from '../pwa/InstallApp';
import { openWormholeReference } from '../reference/open';
import { useTheme } from '../theme/ThemeProvider';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
  useToast,
} from '../ui';
import { telemetryClientKey } from './Telemetry';
import styles from './AppShell.module.css';

const DOCS_URL = 'https://github.com/zanreal-labs/darkbeacon#readme';
const UNREAD_POLL_MS = 2 * 60 * 1000;

export const supportUnreadKey = ['support-unread'] as const;

export function useSupportClient() {
  return useQuery({
    queryKey: supportClientKey,
    queryFn: () => api<SupportClientDto>(routes.support.client.path),
    staleTime: Infinity,
    retry: false,
  });
}

/** Unread replies on the hub: polled every two minutes while the page is visible. */
export function useSupportUnread(client: SupportClientDto | undefined): number {
  const queryClient = useQueryClient();
  const unread = useQuery({
    queryKey: [...supportUnreadKey, client?.hubUrl ?? null, client?.inApp ?? false, client?.handle ?? null],
    queryFn: async () => {
      const result = await fetchUnread(client!);
      if (result === 'gone') {
        // Revoked on the hub: forget it here too.
        await api<void>(routes.support.forgetHandle.path, { method: 'DELETE' }).catch(() => {});
        void queryClient.invalidateQueries({ queryKey: supportClientKey });
        return 0;
      }
      return result;
    },
    enabled: !!client?.hubUrl && (client.inApp || !!client.handle),
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: UNREAD_POLL_MS / 2,
  });
  return unread.data ?? 0;
}

/** Opens support (a popup on the hub, or the hub's own page when this instance is the hub). */
export function useOpenSupport(): ((kind: SupportKind) => void) | null {
  const client = useSupportClient().data;
  const { preference, theme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const open = useCallback(
    (kind: SupportKind) => {
      if (!client?.hubUrl) return;
      const parts = buildSupportContext({
        client,
        location: window.location,
        theme: { preference, scheme: theme.colorScheme === 'dark' ? 'dark' : 'light' },
        navigator,
        width: window.innerWidth,
      });
      if (client.inApp) {
        try {
          sessionStorage.setItem(IN_APP_CONTEXT_KEY, JSON.stringify(parts));
        } catch {
          // Private mode: the page opens without the details.
        }
        router.push(`/support?kind=${kind}`);
        return;
      }
      const opened = openSupportPopup({
        hubUrl: client.hubUrl,
        kind,
        parts,
        hasHandle: !!client.handle,
        onHandle: (handle) => {
          void api<void>(routes.support.saveHandle.path, {
            method: 'PUT',
            json: { hubOrigin: client.hubUrl, handle },
          }).then(() => queryClient.invalidateQueries({ queryKey: supportClientKey }));
        },
      });
      if (!opened)
        toast({
          title: 'The support window was blocked',
          description: 'Allow pop-ups for this site, then try again.',
          tone: 'warning',
        });
    },
    [client, preference, theme.colorScheme, router, toast, queryClient],
  );
  return client?.hubUrl ? open : null;
}

/** "Report a problem" and "Send feedback", for the account menu. */
export function SupportMenuItems() {
  const open = useOpenSupport();
  if (!open) return null;
  return (
    <>
      <MenuItem icon={<Bug />} onSelect={() => open('ticket')}>
        Report a problem
      </MenuItem>
      <MenuItem icon={<MessageSquareHeart />} onSelect={() => open('feedback')}>
        Send feedback
      </MenuItem>
    </>
  );
}

/**
 * The help menu, at the bottom of the main rail (in the top bar on phones, where the rail is the
 * tab bar): report a problem, send feedback, my tickets (with the unread badge
 * from the hub), a thumbs up or down for the page (anonymous telemetry, when it is on), the
 * wormhole types reference (the phones' way to it), what's new, the documentation and, when this
 * browser can install it, "Install app".
 */
export function HelpMenu({ placement = 'rail' }: { placement?: 'rail' | 'topbar' }) {
  const router = useRouter();
  const toast = useToast();
  const client = useSupportClient().data;
  const unread = useSupportUnread(client);
  const open = useOpenSupport();
  const telemetry = useQuery<TelemetryClientDto>({ queryKey: telemetryClientKey, enabled: false });
  const canRate = !!telemetry.data?.active && !browserOptedOut();
  const install = useInstallApp();

  useEffect(() => installErrorCapture(), []);

  const rate = (rating: 'up' | 'down') => {
    const area = supportPage(window.location.pathname);
    if (area !== 'other') track('feedback_rated', { rating, area });
    toast({
      title: 'Thanks for the rating',
      description: rating === 'down' && open ? 'Tell us what is off with Send feedback.' : undefined,
      tone: 'success',
    });
  };

  const label = unread > 0 ? `Help, ${unread} unread ${unread === 1 ? 'reply' : 'replies'}` : 'Help';
  return (
    <>
      {/* The install sits right above Help in the rail (its one-time toast shows on phones too,
          where the rail is hidden). */}
      {placement === 'rail' && (
        <InstallRailButton className={styles.railLink} dotClassName={styles.railDot} />
      )}
      <Menu>
        <span className={placement === 'rail' ? styles.railHelp : styles.topbarHelp}>
          {placement === 'rail' ? (
            <Tooltip content={label} side="right">
              <MenuTrigger className={styles.railLink} aria-label={label}>
                <CircleHelp />
              </MenuTrigger>
            </Tooltip>
          ) : (
            <MenuTrigger asChild>
              <IconButton label={label} icon={<CircleHelp />} tooltip={false} />
            </MenuTrigger>
          )}
          {unread > 0 && (
            <span className={styles.helpBadge} aria-hidden>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
        <MenuContent className={styles.helpMenu} side={placement === 'rail' ? 'right' : 'bottom'} align="end">
          {open && (
            <>
              <MenuLabel>Support</MenuLabel>
              <MenuItem icon={<Bug />} onSelect={() => open('ticket')}>
                Report a problem
              </MenuItem>
              <MenuItem icon={<MessageSquareHeart />} onSelect={() => open('feedback')}>
                Send feedback
              </MenuItem>
              <MenuItem icon={<Inbox />} onSelect={() => open('tickets')}>
                <span className={styles.helpItem}>
                  My tickets
                  {unread > 0 && <span className={styles.helpCount}>{unread} new</span>}
                </span>
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {canRate && (
            <>
              <MenuLabel>Is this page working for you?</MenuLabel>
              <div className={styles.helpRate} role="group" aria-label="Rate this page">
                <MenuItem icon={<ThumbsUp />} onSelect={() => rate('up')}>
                  Yes
                </MenuItem>
                <MenuItem icon={<ThumbsDown />} onSelect={() => rate('down')}>
                  Not really
                </MenuItem>
              </div>
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<BookOpen />} onSelect={() => openWormholeReference()}>
            Wormhole types
          </MenuItem>
          <MenuItem icon={<Sparkles />} onSelect={() => router.push('/changelog')}>
            What&apos;s new
          </MenuItem>
          <MenuItem
            icon={<ArrowUpRight />}
            onSelect={() => window.open(DOCS_URL, '_blank', 'noopener,noreferrer')}
          >
            Documentation
          </MenuItem>
          {install.option && (
            <>
              <MenuSeparator />
              <MenuItem icon={<MonitorDown />} onSelect={install.run}>
                Install app
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      {install.dialog}
    </>
  );
}
