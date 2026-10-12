'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import { routes, type AuthProvidersDto } from '@darkbeacon/shared';
import { useEnterDemo } from '../lib/session';
import { LogoMark, Wordmark } from '../shell/Logo';
import { ThemeMenu } from '../shell/ThemeMenu';
import { Button, Callout, Skeleton } from '../ui';
import styles from './LoginPage.module.css';

/** Discord's mark (Simple Icons, CC0). */
function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.1 14.1 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128c-.597.349-1.22.645-1.873.891a.077.077 0 0 0-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/**
 * Full-screen sign-in: one way in, Discord or EVE Online as the instance chose (EVE when Discord
 * is not configured). With Discord, EVE characters are linked afterwards with EVE SSO.
 * Everything but `actions` is static and prerendered; the actions depend on how the instance is
 * set up and on the URL, so they stream in.
 */
export function LoginScreen({ actions }: { actions: ReactNode }) {
  return (
    <div className={styles.screen}>
      <div className={styles.sky} aria-hidden>
        <div className={styles.stars} />
        <div className={styles.starsFar} />
        <div className={styles.nebula} />
      </div>

      <header className={styles.top}>
        <Wordmark />
        <ThemeMenu />
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <div className={styles.mark}>
            <span className={styles.beam} aria-hidden />
            <LogoMark size={56} animated />
          </div>
          <h1 className={styles.title}>Darkbeacon</h1>
          <p className={styles.pitch}>Map your wormhole chain together, live.</p>
        </div>

        <div className={styles.actions}>{actions}</div>
      </main>

      <footer className={styles.footer}>
        Self-hosted. EVE Online and all related marks belong to CCP hf.; this tool is not affiliated with CCP.
      </footer>
    </div>
  );
}

/** Stands in for the sign-in buttons while they stream in. */
export function LoginActionsSkeleton() {
  return <Skeleton height={40} radius={8} />;
}

/**
 * The ways in this instance offers. `next` is where to go after signing in (a same-site path),
 * `authError` an OAuth failure (`?auth_error=`).
 * In demo mode a visitor who signed out can step back into the demo.
 */
export function LoginActions({
  providers,
  next,
  authError,
  invite = null,
}: {
  providers: AuthProvidersDto;
  next: string;
  authError: string | null;
  /** An invite link's token (`?invite=`), carried through the sign-in. */
  invite?: string | null;
}) {
  const router = useRouter();
  const enterDemo = useEnterDemo();
  const params = new URLSearchParams({ returnTo: next, ...(invite ? { invite } : {}) });
  const discordHref = `${routes.auth.discordLogin.path}?${params}`;
  const eveHref = `${routes.auth.eveSignIn.path}?${params}`;
  const eveMode = providers.loginMethod === 'eve';
  const primary = eveMode ? providers.eve : providers.discord;

  return (
    <>
      {authError && (
        <Callout tone="danger" title="Sign-in didn't work">
          {authError}
        </Callout>
      )}
      {invite && !authError && (
        <Callout tone="accent" title="You have an invite">
          Sign in to make your account here.
        </Callout>
      )}

      {eveMode && providers.eve && (
        <a href={eveHref} className={styles.eveButton}>
          {/* CCP's own button, as the EVE SSO docs ask third-party sites to use. */}
          <img src={EVE_SSO_BUTTON} alt="Log in with EVE Online" width={270} height={45} decoding="async" />
        </a>
      )}

      {eveMode && !providers.eve && (
        <Callout tone="warning" title="EVE Online sign-in isn't set up yet">
          <span className={styles.setup}>
            An admin of this instance needs to create an application on the EVE developers site, set{' '}
            <code>EVE_CLIENT_ID</code> and <code>EVE_CLIENT_SECRET</code> and restart the server.
          </span>
        </Callout>
      )}

      {!eveMode && providers.discord && (
        <Button asChild variant="discord" size="lg" block>
          <a href={discordHref}>
            <DiscordMark />
            <span>Continue with Discord</span>
          </a>
        </Button>
      )}

      {!eveMode && !providers.discord && (
        <Callout tone="warning" title="Discord sign-in isn't set up yet">
          <span className={styles.setup}>
            An admin of this instance needs to create a Discord application, set{' '}
            <code>DISCORD_CLIENT_ID</code> and <code>DISCORD_CLIENT_SECRET</code>, add the redirect{' '}
            <code className={styles.url}>{providers.discordRedirectUrl}</code> and restart the server.
          </span>
        </Callout>
      )}

      {providers.demo && (
        <Button
          variant={primary ? 'ghost' : 'primary'}
          size={primary ? 'md' : 'lg'}
          block
          icon={<Compass />}
          loading={enterDemo.isPending || enterDemo.isSuccess}
          onClick={() => enterDemo.mutate(undefined, { onSuccess: () => router.replace(next) })}
        >
          Explore the demo
        </Button>
      )}
      {enterDemo.isError && (
        <Callout tone="danger" title="The demo didn't open">
          {enterDemo.error instanceof Error ? enterDemo.error.message : 'Try again.'}
        </Callout>
      )}

      <p className={styles.note}>
        {eveMode
          ? 'Sign in with any of your characters. Add your alts on your account page once you are in.'
          : 'You link your EVE characters with EVE SSO once you are in.'}
      </p>
    </>
  );
}

/** https://developers.eveonline.com/docs/services/sso/ ("please use one of the following images"). */
export const EVE_SSO_BUTTON =
  'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-large.png';
