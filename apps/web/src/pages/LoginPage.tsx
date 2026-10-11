import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { routes, type DevLoginRequest, type MeDto } from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import { meKey, useMe, useProviders } from '../lib/session';
import styles from './pages.module.css';

/** Only same-site paths, so a crafted link cannot send people elsewhere after login. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const me = useMe();
  const providers = useProviders();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  if (me.data) return <Navigate to={next} replace />;

  return (
    <section className={styles.login}>
      <div>
        <h1>Sign in to Wormwright</h1>
        <p className="muted">Your Discord account is your login. EVE characters are linked afterwards.</p>
      </div>
      {providers.isPending && <p className="muted">Loading…</p>}
      {providers.isError && <p className="error">The server cannot be reached right now.</p>}
      {providers.data?.discord && (
        <a
          className="btn btn-primary"
          href={`${routes.auth.discordLogin.path}?${new URLSearchParams({ next })}`}
        >
          Continue with Discord
        </a>
      )}
      {providers.data && !providers.data.discord && !providers.data.dev && (
        <p className="muted">No login is configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.</p>
      )}
      {providers.data?.dev && (
        <>
          {providers.data.discord && <div className={styles.divider}>development</div>}
          <DevLoginForm next={next} />
        </>
      )}
    </section>
  );
}

function DevLoginForm({ next }: { next: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [character, setCharacter] = useState('');
  const login = useMutation({
    mutationFn: (body: DevLoginRequest) => api<MeDto>(routes.auth.dev.path, { method: 'POST', json: body }),
    onSuccess: (me) => {
      queryClient.clear();
      queryClient.setQueryData(meKey, me);
      void navigate(next, { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({
      name: name.trim(),
      ...(character.trim() ? { character: { name: character.trim() } } : {}),
    });
  };

  return (
    <form className={styles.stack} onSubmit={submit} aria-label="Development login">
      <label className="field">
        <span>Account name</span>
        <input
          className="input"
          required
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Fake EVE character (optional)</span>
        <input
          className="input"
          maxLength={64}
          value={character}
          onChange={(e) => setCharacter(e.target.value)}
        />
      </label>
      <button type="submit" className="btn" disabled={login.isPending || !name.trim()}>
        Sign in locally
      </button>
      {login.error && (
        <p className="error">{login.error instanceof ApiError ? login.error.message : 'Sign in failed.'}</p>
      )}
    </form>
  );
}
