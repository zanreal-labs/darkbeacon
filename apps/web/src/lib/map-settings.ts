/**
 * Map settings open in a dialog over the live map. Which section is open lives in `?settings=` on
 * the map's own address, so a section can be linked and survives a reload.
 */
export const MAP_SETTINGS_PARAM = 'settings';

export const MAP_SETTINGS_SECTIONS = [
  'general',
  'access',
  'labels',
  'bookmarks',
  'discord',
  'webhooks',
  'danger',
] as const;
export type MapSettingsSection = (typeof MAP_SETTINGS_SECTIONS)[number];

/** What managers may change; every other section is for the map's admins. */
const FOR_MANAGERS: readonly MapSettingsSection[] = ['labels', 'bookmarks'];

/** The sections someone with these rights sees, in order (none below manager). */
export function mapSettingsSections(can: { manage: boolean; admin: boolean }): MapSettingsSection[] {
  if (can.admin) return [...MAP_SETTINGS_SECTIONS];
  return can.manage ? MAP_SETTINGS_SECTIONS.filter((s) => FOR_MANAGERS.includes(s)) : [];
}

/** Tabs of the old settings page (`/m/<slug>/settings?tab=`) that have another name now. */
const RENAMED: Record<string, MapSettingsSection> = { notifications: 'discord' };

/** The section an old `?tab=` value stands for (General when it names none). */
export function sectionOfTab(tab: string | null): MapSettingsSection {
  if (!tab) return 'general';
  if (Object.hasOwn(RENAMED, tab)) return RENAMED[tab]!;
  return (MAP_SETTINGS_SECTIONS as readonly string[]).includes(tab) ? (tab as MapSettingsSection) : 'general';
}

/** The map with its settings open on `section`. */
export function mapSettingsHref(slug: string, section: MapSettingsSection = 'general'): string {
  return `/m/${slug}?${MAP_SETTINGS_PARAM}=${section}`;
}

/** `/m/<slug>/settings` (the old settings page): where it lives now, or null for other paths. */
export function movedSettingsPath(pathname: string, search: URLSearchParams): string | null {
  const match = /^\/m\/([^/]+)\/settings\/?$/.exec(pathname);
  if (!match) return null;
  return mapSettingsHref(match[1]!, sectionOfTab(search.get('tab')));
}
