import type { TokenName } from '@wormwright/theme-sdk';
import styles from '../pages/pages.module.css';
import { useTheme } from './ThemeProvider';

/** Tokens previewed on each card: the theme's own values, not the active theme's. */
const PREVIEW: TokenName[] = [
  'color-bg',
  'color-surface',
  'color-accent',
  'security-wormhole',
  'status-hostile',
  'edge-time-eol',
];

export function ThemePicker() {
  const { theme: active, themes, setTheme } = useTheme();
  return (
    <div className={styles.themes} role="radiogroup" aria-label="Theme">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={t.id === active.id}
          className={styles.theme}
          onClick={() => setTheme(t.id)}
        >
          <span className={styles.swatches} aria-hidden>
            {PREVIEW.map((token) => (
              <span key={token} style={{ background: t.tokens[token] }} />
            ))}
          </span>
          {t.name}
        </button>
      ))}
    </div>
  );
}
