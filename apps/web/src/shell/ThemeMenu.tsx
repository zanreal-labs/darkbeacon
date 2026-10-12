import { Contrast, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { SYSTEM_THEME_ID } from '@darkbeacon/theme-sdk';
import { useTheme } from '../theme/ThemeProvider';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../ui';

const MAIN: Record<string, { label: string; icon: React.ReactNode }> = {
  [SYSTEM_THEME_ID]: { label: 'System', icon: <Monitor /> },
  default: { label: 'Light', icon: <Sun /> },
  dark: { label: 'Dark', icon: <Moon /> },
};

/** Top-bar theme switch: System (default) / Light / Dark, then contrast and installed themes. */
export function ThemeMenu() {
  const { preference, options, setPreference, theme } = useTheme();
  const others = options.filter((o) => !(o.id in MAIN));
  const icon =
    preference === SYSTEM_THEME_ID ? <Monitor /> : theme.colorScheme === 'dark' ? <Moon /> : <Sun />;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Theme" icon={icon} tooltip={false} />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={preference} onValueChange={setPreference}>
          {Object.entries(MAIN).map(([id, o]) => (
            <MenuRadioItem key={id} value={id} icon={o.icon}>
              {o.label}
            </MenuRadioItem>
          ))}
          {others.length > 0 && <MenuSeparator />}
          {others.map((o) => (
            <MenuRadioItem key={o.id} value={o.id} icon={o.id === 'contrast' ? <Contrast /> : <Palette />}>
              {o.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
