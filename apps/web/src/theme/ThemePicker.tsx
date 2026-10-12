import { RadioGroup } from 'radix-ui';
import { Check } from 'lucide-react';
import { builtInThemes, SYSTEM_THEME_ID, type Theme, type TokenName } from '@darkbeacon/theme-sdk';
import { useTheme } from './ThemeProvider';
import styles from './ThemePicker.module.css';

function Preview({ theme }: { theme: Theme }) {
  const t = (name: TokenName) => theme.tokens[name];
  return (
    <span className={styles.preview} style={{ background: t('color-bg'), borderColor: t('color-border') }}>
      <span
        className={styles.previewRail}
        style={{ background: t('color-bg-subtle'), borderColor: t('color-border') }}
      />
      <span className={styles.previewBody}>
        <span className={styles.previewLine} style={{ background: t('color-text'), width: '45%' }} />
        <span
          className={styles.previewLine}
          style={{ background: t('color-text-muted'), width: '70%', opacity: 0.6 }}
        />
        <span className={styles.previewChips}>
          <span style={{ background: t('color-accent') }} />
          <span style={{ background: t('security-high') }} />
          <span style={{ background: t('security-wormhole') }} />
          <span style={{ background: t('edge-time-eol') }} />
          <span style={{ background: t('status-hostile') }} />
        </span>
      </span>
    </span>
  );
}

const HINTS: Record<string, string> = {
  default: 'Clean and bright',
  dark: 'Deep graphite',
  contrast: 'Maximum legibility',
};

/** Theme cards: System (default, follows the OS), then every built-in and installed theme. */
export function ThemePicker() {
  const { preference, themes, setPreference } = useTheme();
  const light = builtInThemes[0]!;
  const dark = builtInThemes[1]!;
  return (
    <RadioGroup.Root
      className={styles.grid}
      value={preference}
      onValueChange={setPreference}
      aria-label="Theme"
    >
      <RadioGroup.Item value={SYSTEM_THEME_ID} className={styles.card}>
        <span className={styles.split}>
          <Preview theme={light} />
          <Preview theme={dark} />
        </span>
        <span className={styles.name}>
          System
          <RadioGroup.Indicator className={styles.check}>
            <Check />
          </RadioGroup.Indicator>
        </span>
        <span className={styles.hint}>Follows your computer</span>
      </RadioGroup.Item>
      {themes.map((t) => (
        <RadioGroup.Item key={t.id} value={t.id} className={styles.card}>
          <Preview theme={t} />
          <span className={styles.name}>
            {t.name}
            <RadioGroup.Indicator className={styles.check}>
              <Check />
            </RadioGroup.Indicator>
          </span>
          <span className={styles.hint}>
            {HINTS[t.id] ?? (t.colorScheme === 'dark' ? 'Dark theme' : 'Light theme')}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
