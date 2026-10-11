import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { buildPath, routes, type MeDto } from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import { meKey, useLogout, useMe } from '../lib/session';
import { ThemePicker } from '../theme/ThemePicker';
import styles from './pages.module.css';

const portrait = (id: number) => `https://images.evetech.net/characters/${id}/portrait?size=64`;

export function AccountPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useLogout();
  const logoutEverywhere = useLogout(true);

  const setMain = useMutation({
    mutationFn: (characterId: number) =>
      api<MeDto>(routes.accounts.setMainCharacter.path, { method: 'PUT', json: { characterId } }),
    onSuccess: (data) => queryClient.setQueryData(meKey, data),
  });
  const unlink = useMutation({
    mutationFn: (characterId: number) =>
      api<void>(buildPath(routes.accounts.unlinkCharacter.path, { characterId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });

  if (!me.data) return null;
  const { account, characters } = me.data;
  const error = setMain.error ?? unlink.error;

  const signOut = (which: typeof logout) =>
    which.mutate(undefined, { onSuccess: () => void navigate('/login', { replace: true }) });

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <h1>Account</h1>
      </div>

      <div className={styles.section}>
        <div className={styles.row}>
          {account.avatarUrl ? (
            <img className={styles.avatar} src={account.avatarUrl} alt="" />
          ) : (
            <span className={styles.avatar} />
          )}
          <div className={styles.grow}>
            <strong>{account.name}</strong>
            <div className="muted">Instance role: {account.instanceRole}</div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.header}>
          <h2>EVE characters</h2>
          <a className="btn btn-primary btn-small" href={routes.auth.eveLogin.path}>
            Link a character
          </a>
        </div>
        {characters.length === 0 ? (
          <p className="muted">No characters yet. Link one to track it on your maps.</p>
        ) : (
          <ul className={styles.rows}>
            {characters.map((c) => {
              const main = account.mainCharacterId === c.id;
              return (
                <li key={c.id} className={styles.row}>
                  <img className={styles.avatar} src={portrait(c.id)} alt="" loading="lazy" />
                  <div className={styles.grow}>
                    <strong>{c.name}</strong> {main && <span className={styles.pill}>main</span>}
                    {!c.tokenValid && (
                      <div className="error">The EVE login expired. Link the character again.</div>
                    )}
                  </div>
                  {!main && (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={setMain.isPending}
                      onClick={() => setMain.mutate(c.id)}
                    >
                      Make main
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={unlink.isPending}
                    onClick={() => {
                      if (window.confirm(`Unlink ${c.name}? Tracking stops on every map.`))
                        unlink.mutate(c.id);
                    }}
                  >
                    Unlink
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="error">{error instanceof ApiError ? error.message : 'Something went wrong.'}</p>
        )}
      </div>

      <div className={styles.section}>
        <h2>Appearance</h2>
        <p className="muted">Stored in this browser.</p>
        <ThemePicker />
      </div>

      <div className={styles.section}>
        <h2>Sessions</h2>
        <p className="muted">Signing out everywhere ends the sessions on all your devices.</p>
        <div className={styles.inline}>
          <button type="button" className="btn" onClick={() => signOut(logout)} disabled={logout.isPending}>
            Sign out
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => signOut(logoutEverywhere)}
            disabled={logoutEverywhere.isPending}
          >
            Sign out everywhere
          </button>
        </div>
      </div>
    </section>
  );
}
