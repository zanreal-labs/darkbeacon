import { z } from 'zod';
import * as dto from './dto/index.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Who may call: anyone, a signed-in account, or an instance admin. Map routes also check the map role. */
export type RouteAuth = 'public' | 'account' | 'admin';

export interface RouteDef {
  method: HttpMethod;
  /** Full path including `/api`; `:param` segments are filled by `buildPath`. */
  path: string;
  auth: RouteAuth;
  /** Minimum map role for routes under /api/maps/:mapId. */
  mapRole?: 'viewer' | 'member' | 'manager' | 'admin';
  body?: z.ZodType;
  query?: z.ZodType;
  /** Response body; absent for 204 and redirects. */
  response?: z.ZodType;
  /** Redirects instead of returning JSON (OAuth flows). */
  redirect?: true;
}

const route = <const R extends RouteDef>(r: R): R => r;

/**
 * Every REST endpoint of the MVP. Server controllers implement these paths; the web app
 * calls them through `buildPath`. Changing a route here is a contract change.
 */
export const routes = {
  health: route({ method: 'GET', path: '/api/health', auth: 'public', response: dto.HealthDto }),

  auth: {
    providers: route({
      method: 'GET',
      path: '/api/auth/providers',
      auth: 'public',
      response: dto.AuthProvidersDto,
    }),
    discordLogin: route({ method: 'GET', path: '/api/auth/discord/login', auth: 'public', redirect: true }),
    discordCallback: route({
      method: 'GET',
      path: '/api/auth/discord/callback',
      auth: 'public',
      redirect: true,
    }),
    /** Links an EVE character to the signed-in account (EVE SSO v2, PKCE). */
    eveLogin: route({ method: 'GET', path: '/api/auth/eve/login', auth: 'account', redirect: true }),
    eveCallback: route({ method: 'GET', path: '/api/auth/eve/callback', auth: 'account', redirect: true }),
    dev: route({
      method: 'POST',
      path: '/api/auth/dev',
      auth: 'public',
      body: dto.DevLoginRequest,
      response: dto.MeDto,
    }),
    logout: route({ method: 'POST', path: '/api/auth/logout', auth: 'account' }),
    logoutEverywhere: route({ method: 'POST', path: '/api/auth/logout-everywhere', auth: 'account' }),
  },

  accounts: {
    me: route({ method: 'GET', path: '/api/accounts/me', auth: 'account', response: dto.MeDto }),
    unlinkCharacter: route({
      method: 'DELETE',
      path: '/api/accounts/me/characters/:characterId',
      auth: 'account',
    }),
  },

  admin: {
    accounts: route({
      method: 'GET',
      path: '/api/admin/accounts',
      auth: 'admin',
      response: z.array(dto.AdminAccountDto),
    }),
    setInstanceRole: route({
      method: 'PUT',
      path: '/api/admin/accounts/:accountId/role',
      auth: 'admin',
      body: dto.UpdateInstanceRoleRequest,
      response: dto.AdminAccountDto,
    }),
    transferOwnership: route({
      method: 'POST',
      path: '/api/admin/transfer-ownership',
      auth: 'admin',
      body: dto.TransferOwnershipRequest,
    }),
  },

  universe: {
    searchSystems: route({
      method: 'GET',
      path: '/api/universe/systems',
      auth: 'account',
      query: dto.UniverseSearchQuery,
      response: z.array(dto.UniverseSystemDto),
    }),
    getSystem: route({
      method: 'GET',
      path: '/api/universe/systems/:solarSystemId',
      auth: 'account',
      response: dto.UniverseSystemDto,
    }),
  },

  maps: {
    list: route({ method: 'GET', path: '/api/maps', auth: 'account', response: z.array(dto.MapSummaryDto) }),
    create: route({
      method: 'POST',
      path: '/api/maps',
      auth: 'account',
      body: dto.CreateMapRequest,
      response: dto.MapDto,
    }),
    bySlug: route({
      method: 'GET',
      path: '/api/maps/by-slug/:slug',
      auth: 'account',
      mapRole: 'viewer',
      response: dto.MapDto,
    }),
    get: route({
      method: 'GET',
      path: '/api/maps/:mapId',
      auth: 'account',
      mapRole: 'viewer',
      response: dto.MapDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId',
      auth: 'account',
      mapRole: 'admin',
      body: dto.UpdateMapRequest,
      response: dto.MapDto,
    }),
    remove: route({ method: 'DELETE', path: '/api/maps/:mapId', auth: 'account', mapRole: 'admin' }),
    setLabels: route({
      method: 'PUT',
      path: '/api/maps/:mapId/labels',
      auth: 'account',
      mapRole: 'manager',
      body: dto.SetLabelsRequest,
      response: z.array(dto.LabelDto),
    }),
  },

  systems: {
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems',
      auth: 'account',
      mapRole: 'member',
      body: dto.AddSystemRequest,
      response: dto.MapSystemDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/systems/:solarSystemId',
      auth: 'account',
      mapRole: 'member',
      body: dto.UpdateSystemRequest,
      response: dto.MapSystemDto,
    }),
    move: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/positions',
      auth: 'account',
      mapRole: 'member',
      body: dto.MoveSystemsRequest,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/systems/:solarSystemId',
      auth: 'account',
      mapRole: 'member',
    }),
  },

  connections: {
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections',
      auth: 'account',
      mapRole: 'member',
      body: dto.AddConnectionRequest,
      response: dto.ConnectionDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/connections/:connectionId',
      auth: 'account',
      mapRole: 'member',
      body: dto.UpdateConnectionRequest,
      response: dto.ConnectionDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/connections/:connectionId',
      auth: 'account',
      mapRole: 'member',
    }),
  },

  signatures: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures',
      auth: 'account',
      mapRole: 'viewer',
      response: z.array(dto.SignatureDto),
    }),
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures',
      auth: 'account',
      mapRole: 'member',
      body: dto.AddSignatureRequest,
      response: dto.SignatureDto,
    }),
    paste: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures/paste',
      auth: 'account',
      mapRole: 'member',
      body: dto.PasteSignaturesRequest,
      response: dto.PasteSignaturesResult,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/signatures/:signatureId',
      auth: 'account',
      mapRole: 'member',
      body: dto.UpdateSignatureRequest,
      response: dto.SignatureDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/signatures/:signatureId',
      auth: 'account',
      mapRole: 'member',
    }),
  },

  access: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/access-rules',
      auth: 'account',
      mapRole: 'admin',
      response: z.array(dto.AccessRuleDto),
    }),
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/access-rules',
      auth: 'account',
      mapRole: 'admin',
      body: dto.CreateAccessRuleRequest,
      response: dto.AccessRuleDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/access-rules/:ruleId',
      auth: 'account',
      mapRole: 'admin',
    }),
  },

  tracking: {
    characters: route({
      method: 'GET',
      path: '/api/maps/:mapId/characters',
      auth: 'account',
      mapRole: 'viewer',
      response: z.array(dto.CharacterPresenceDto),
    }),
    set: route({
      method: 'PUT',
      path: '/api/maps/:mapId/tracking',
      auth: 'account',
      mapRole: 'member',
      body: dto.SetTrackingRequest,
    }),
  },

  webhooks: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/webhooks',
      auth: 'account',
      mapRole: 'admin',
      response: z.array(dto.WebhookDto),
    }),
    create: route({
      method: 'POST',
      path: '/api/maps/:mapId/webhooks',
      auth: 'account',
      mapRole: 'admin',
      body: dto.CreateWebhookRequest,
      response: dto.CreatedWebhookDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/webhooks/:webhookId',
      auth: 'account',
      mapRole: 'admin',
      body: dto.UpdateWebhookRequest,
      response: dto.WebhookDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/webhooks/:webhookId',
      auth: 'account',
      mapRole: 'admin',
    }),
    deliveries: route({
      method: 'GET',
      path: '/api/maps/:mapId/webhooks/:webhookId/deliveries',
      auth: 'account',
      mapRole: 'admin',
      response: z.array(dto.WebhookDeliveryDto),
    }),
    /** Sends a `webhook.test` event once, without retries, and returns the delivery. */
    test: route({
      method: 'POST',
      path: '/api/maps/:mapId/webhooks/:webhookId/test',
      auth: 'account',
      mapRole: 'admin',
      response: dto.WebhookDeliveryDto,
    }),
  },

  plugins: {
    list: route({
      method: 'GET',
      path: '/api/admin/plugins',
      auth: 'admin',
      response: z.array(dto.PluginDto),
    }),
    install: route({
      method: 'POST',
      path: '/api/admin/plugins',
      auth: 'admin',
      body: dto.InstallPluginRequest,
      response: dto.PluginDto,
    }),
    setEnabled: route({
      method: 'PUT',
      path: '/api/admin/plugins/:pluginId/enabled',
      auth: 'admin',
      body: dto.SetPluginEnabledRequest,
      response: dto.PluginDto,
    }),
    uninstall: route({ method: 'DELETE', path: '/api/admin/plugins/:pluginId', auth: 'admin' }),
    /** Body: the raw .tgz with `content-type: application/gzip` (or application/octet-stream). */
    upload: route({
      method: 'POST',
      path: '/api/admin/plugins/upload',
      auth: 'admin',
      response: dto.PluginDto,
    }),
    /** First-party plugins and themes shipped with the server. */
    catalog: route({
      method: 'GET',
      path: '/api/admin/plugins/catalog',
      auth: 'admin',
      response: z.array(dto.CatalogEntryDto),
    }),
    settings: route({
      method: 'GET',
      path: '/api/admin/plugins/:pluginId/settings',
      auth: 'admin',
      query: dto.PluginSettingsQuery,
      response: dto.PluginSettingsDto,
    }),
    updateSettings: route({
      method: 'PUT',
      path: '/api/admin/plugins/:pluginId/settings',
      auth: 'admin',
      body: dto.UpdatePluginSettingsRequest,
      response: dto.PluginSettingsDto,
    }),
    /** Enabled plugins with a web part, for the SPA to load. */
    web: route({
      method: 'GET',
      path: '/api/plugins/web',
      auth: 'account',
      response: z.array(dto.PluginWebDto),
    }),
    /** Files of a plugin's web part (the folder of its web entry). `url` in `web` points here. */
    asset: route({ method: 'GET', path: '/api/plugins/:pluginId/assets/:file', auth: 'account' }),
  },

  themes: {
    list: route({ method: 'GET', path: '/api/themes', auth: 'public', response: dto.ThemesDto }),
    select: route({
      method: 'PUT',
      path: '/api/accounts/me/theme',
      auth: 'account',
      body: dto.SelectThemeRequest,
      response: dto.ThemesDto,
    }),
    setDefault: route({
      method: 'PUT',
      path: '/api/admin/themes/default',
      auth: 'admin',
      body: dto.SetDefaultThemeRequest,
      response: dto.ThemesDto,
    }),
    install: route({
      method: 'POST',
      path: '/api/admin/themes',
      auth: 'admin',
      body: dto.InstallPluginRequest,
      response: dto.ThemeDto,
    }),
    /** Body: the raw .tgz, as for plugins. */
    upload: route({
      method: 'POST',
      path: '/api/admin/themes/upload',
      auth: 'admin',
      response: dto.ThemeDto,
    }),
    uninstall: route({ method: 'DELETE', path: '/api/admin/themes/:themeId', auth: 'admin' }),
  },
} as const;

type PathParams<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? { [K in Name | keyof PathParams<`/${Rest}`>]: string | number }
  : P extends `${string}:${infer Name}`
    ? { [K in Name]: string | number }
    : Record<never, never>;

/** Fills `:param` segments: buildPath('/api/maps/:mapId', { mapId }) */
export function buildPath<P extends string>(path: P, params: PathParams<P>): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = (params as Record<string, string | number | undefined>)[name];
    if (value === undefined) throw new Error(`missing path param ${name} for ${path}`);
    return encodeURIComponent(String(value));
  });
}

/** Path relative to the `/api` prefix, as used in Nest `@Controller`/`@Get` decorators. */
export function nestPath(path: string): string {
  return path.replace(/^\/api\/?/, '');
}
