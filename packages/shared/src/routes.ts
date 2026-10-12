import { z } from 'zod';
import * as dto from './dto/index.js';
import type { ScopeRequirement } from './scopes.js';
import * as telemetry from './telemetry.js';

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
  /**
   * What an API key needs to call it (see `scopes.ts`): `none`, `session` (browser sessions only)
   * or a resource and action. Required, so a new route cannot ship without deciding.
   */
  scope: ScopeRequirement;
  /** Answers a file (CSV/JSON export, plugin asset) instead of a JSON body. */
  download?: true;
  /** Takes a raw body of this media type instead of JSON. */
  upload?: string;
  /** One line for the API docs; the doc comment above the route says more. */
  summary?: string;
  /** Kept for compatibility; see the deprecation policy in docs/api.md. */
  deprecated?: true;
  /** Media type of a response that is not JSON (the docs page). */
  contentType?: string;
  /** Media type of the body when it is not JSON (the OAuth token endpoint takes a form). */
  bodyContentType?: string;
  /** Success status when it is not the default (201 for POST with a body, else 200; 204 without one). */
  status?: 200 | 202;
}

const route = <const R extends RouteDef>(r: R): R => r;

/**
 * Every REST endpoint of the MVP. Server controllers implement these paths; the web app
 * calls them through `buildPath`. Changing a route here is a contract change.
 */
export const routes = {
  health: route({
    method: 'GET',
    path: '/api/health',
    auth: 'public',
    scope: 'none',
    response: dto.HealthDto,
  }),
  /** Readiness: the database answers and every migration is applied (503 otherwise). */
  ready: route({ method: 'GET', path: '/api/ready', auth: 'public', scope: 'none', response: dto.ReadyDto }),

  realtime: {
    /**
     * Snapshot of a stream (`map:<id>`, `instance`) for whoever may follow it over /ws. Streams the
     * caller cannot follow answer 404 (signed in) or 401 (anonymous).
     */
    snapshot: route({
      method: 'GET',
      path: '/api/streams/:stream/snapshot',
      auth: 'public',
      scope: { resource: '*', action: 'read' },
      response: dto.StreamSnapshotDto,
    }),
  },

  auth: {
    providers: route({
      method: 'GET',
      path: '/api/auth/providers',
      auth: 'public',
      scope: 'none',
      response: dto.AuthProvidersDto,
    }),
    discordLogin: route({
      method: 'GET',
      path: '/api/auth/discord/login',
      auth: 'public',
      scope: 'session',
      redirect: true,
    }),
    discordCallback: route({
      method: 'GET',
      path: '/api/auth/discord/callback',
      auth: 'public',
      scope: 'session',
      redirect: true,
    }),
    /**
     * Connects a Discord user to the signed-in account (EVE sign-in instances), so Discord roles
     * and the account's Discord name come along. Returns to `returnTo`.
     */
    discordConnect: route({
      method: 'GET',
      path: '/api/auth/discord/connect',
      auth: 'account',
      scope: 'session',
      redirect: true,
    }),
    /**
     * Signs in with an EVE character (instances whose login method is `eve`). A linked character
     * opens its account; an unknown one creates a new account (see docs/decisions.md).
     */
    eveSignIn: route({
      method: 'GET',
      path: '/api/auth/eve/signin',
      auth: 'public',
      scope: 'session',
      redirect: true,
    }),
    /** Links an EVE character to the signed-in account (EVE SSO v2, PKCE). */
    eveLogin: route({
      method: 'GET',
      path: '/api/auth/eve/login',
      auth: 'account',
      scope: 'session',
      redirect: true,
    }),
    eveCallback: route({
      method: 'GET',
      path: '/api/auth/eve/callback',
      auth: 'account',
      scope: 'session',
      redirect: true,
    }),
    /** Demo mode: signs in as the demo account (seeding the demo map once). */
    demo: route({
      method: 'POST',
      path: '/api/auth/demo',
      auth: 'public',
      scope: 'session',
      status: 200,
      response: dto.MeDto,
    }),
    /** Demo mode: signs in a named local account (scripts and tests). */
    dev: route({
      method: 'POST',
      path: '/api/auth/dev',
      auth: 'public',
      scope: 'session',
      status: 200,
      body: dto.DevLoginRequest,
      response: dto.MeDto,
    }),
    logout: route({ method: 'POST', path: '/api/auth/logout', auth: 'account', scope: 'session' }),
    logoutEverywhere: route({
      method: 'POST',
      path: '/api/auth/logout-everywhere',
      auth: 'account',
      scope: 'session',
    }),
  },

  accounts: {
    me: route({
      method: 'GET',
      path: '/api/accounts/me',
      auth: 'account',
      scope: { resource: 'account', action: 'read' },
      response: dto.MeDto,
    }),
    setMainCharacter: route({
      method: 'PUT',
      path: '/api/accounts/me/main-character',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.SetMainCharacterRequest,
      response: dto.MeDto,
    }),
    unlinkCharacter: route({
      method: 'DELETE',
      path: '/api/accounts/me/characters/:characterId',
      auth: 'account',
      scope: 'session',
    }),
    setDefaultMap: route({
      method: 'PUT',
      path: '/api/accounts/me/default-map',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.SetDefaultMapRequest,
      response: dto.MeDto,
    }),
    /** Remembers the map the account opened (the map page calls it). */
    recordMapOpened: route({
      method: 'PUT',
      path: '/api/accounts/me/recent-map',
      auth: 'account',
      scope: 'session',
      body: dto.RecordMapOpenedRequest,
    }),
    /** Where `/` goes: account default, instance default, last opened, the only map. */
    landing: route({
      method: 'GET',
      path: '/api/accounts/me/landing',
      auth: 'account',
      scope: { resource: 'account', action: 'read' },
      response: dto.LandingDto,
    }),
    sessions: route({
      method: 'GET',
      path: '/api/accounts/me/sessions',
      auth: 'account',
      scope: 'session',
      response: z.array(dto.SessionDto),
    }),
    revokeSession: route({
      method: 'DELETE',
      path: '/api/accounts/me/sessions/:sessionId',
      auth: 'account',
      scope: 'session',
    }),
    /** Disconnects the account's Discord user (EVE sign-in instances only). */
    disconnectDiscord: route({
      method: 'DELETE',
      path: '/api/accounts/me/discord',
      auth: 'account',
      scope: 'session',
    }),
    /** Accounts by name, for map admins (people who are admin of a map, or instance admins). */
    search: route({
      method: 'GET',
      path: '/api/accounts/search',
      auth: 'account',
      scope: 'session',
      query: dto.AccountSearchQuery,
      response: z.array(dto.AccountSummaryDto),
    }),
  },

  instance: {
    info: route({
      method: 'GET',
      path: '/api/instance',
      auth: 'account',
      scope: { resource: 'account', action: 'read' },
      response: dto.InstanceInfoDto,
    }),
  },

  eve: {
    /** ESI search through one of the caller's characters, or exact names (POST /universe/ids). */
    search: route({
      method: 'GET',
      path: '/api/eve/search',
      auth: 'account',
      scope: 'session',
      query: dto.EveSearchQuery,
      response: dto.EveSearchResultDto,
    }),
    entities: route({
      method: 'GET',
      path: '/api/eve/entities',
      auth: 'account',
      scope: 'session',
      query: dto.EveEntitiesQuery,
      response: z.array(dto.EveEntityDto),
    }),
  },

  discord: {
    /** Servers the instance bot is in (map admins and instance admins). */
    guilds: route({
      method: 'GET',
      path: '/api/discord/guilds',
      auth: 'account',
      scope: 'session',
      response: z.array(dto.DiscordGuildDto),
    }),
    roles: route({
      method: 'GET',
      path: '/api/discord/guilds/:guildId/roles',
      auth: 'account',
      scope: 'session',
      response: z.array(dto.DiscordRoleDto),
    }),
    channels: route({
      method: 'GET',
      path: '/api/discord/guilds/:guildId/channels',
      auth: 'account',
      scope: 'session',
      response: z.array(dto.DiscordChannelDto),
    }),
  },

  /** Served by the bundled `discord-notify` plugin (map admins). */
  discordNotify: {
    get: route({
      method: 'GET',
      path: '/api/plugins/discord-notify/maps/:mapId',
      auth: 'account',
      scope: 'session',
      mapRole: 'admin',
      response: dto.DiscordNotifyStateDto,
    }),
    update: route({
      method: 'PUT',
      path: '/api/plugins/discord-notify/maps/:mapId',
      auth: 'account',
      scope: 'session',
      mapRole: 'admin',
      body: dto.UpdateDiscordNotifyRequest,
      response: dto.DiscordNotifyStateDto,
    }),
    test: route({
      method: 'POST',
      path: '/api/plugins/discord-notify/maps/:mapId/test',
      auth: 'account',
      scope: 'session',
      mapRole: 'admin',
      response: dto.DiscordNotifyTestDto,
    }),
    /** Posts the map's way home now (the hubs, their jumps and mouths). */
    testWayHome: route({
      method: 'POST',
      path: '/api/plugins/discord-notify/maps/:mapId/test-way-home',
      auth: 'account',
      scope: 'session',
      mapRole: 'admin',
      response: dto.DiscordNotifyTestDto,
    }),
  },

  admin: {
    accounts: route({
      method: 'GET',
      path: '/api/admin/accounts',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: z.array(dto.AdminAccountDto),
    }),
    setInstanceRole: route({
      method: 'PUT',
      path: '/api/admin/accounts/:accountId/role',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.UpdateInstanceRoleRequest,
      response: dto.AdminAccountDto,
    }),
    transferOwnership: route({
      method: 'POST',
      path: '/api/admin/transfer-ownership',
      auth: 'admin',
      scope: 'session',
      body: dto.TransferOwnershipRequest,
    }),
    settings: route({
      method: 'GET',
      path: '/api/admin/settings',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: dto.InstanceSettingsDto,
    }),
    updateSettings: route({
      method: 'PATCH',
      path: '/api/admin/settings',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.UpdateInstanceSettingsRequest,
      response: dto.InstanceSettingsDto,
    }),
    discordBot: route({
      method: 'GET',
      path: '/api/admin/discord-bot',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: dto.DiscordBotDto,
    }),
    /** Connects the bot: the token is checked with Discord, then stored encrypted and never shown. */
    setDiscordBot: route({
      method: 'PUT',
      path: '/api/admin/discord-bot',
      auth: 'admin',
      scope: 'session',
      body: dto.SetDiscordBotRequest,
      response: dto.DiscordBotDto,
    }),
    removeDiscordBot: route({
      method: 'DELETE',
      path: '/api/admin/discord-bot',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
    /** What the instance exports for monitoring (OpenTelemetry); set through the environment only. */
    observability: route({
      method: 'GET',
      path: '/api/admin/observability',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: dto.ObservabilityDto,
    }),
  },

  /**
   * SQLite backups (instance admins). On Postgres the status says `supported: false` and the
   * other routes answer 409: back Postgres up with its own tooling.
   */
  backups: {
    status: route({
      method: 'GET',
      path: '/api/admin/backups',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: dto.BackupStatusDto,
    }),
    create: route({
      method: 'POST',
      path: '/api/admin/backups',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      response: dto.BackupDto,
    }),
    updateSettings: route({
      method: 'PATCH',
      path: '/api/admin/backups/settings',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.UpdateBackupSettingsRequest,
      response: dto.BackupSettingsDto,
    }),
    /** Streams the `.db.gz` file as an attachment. */
    download: route({
      method: 'GET',
      path: '/api/admin/backups/:name/download',
      auth: 'admin',
      scope: 'session',
      download: true,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/admin/backups/:name',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
    restore: route({
      method: 'POST',
      path: '/api/admin/backups/:name/restore',
      auth: 'admin',
      scope: 'session',
      body: dto.RestoreBackupRequest,
      response: dto.RestoreResultDto,
    }),
    /**
     * multipart/form-data: a `confirm` field (`RESTORE`) first, then one `file` (a `.db.gz`
     * backup or a plain SQLite file), streamed to disk up to `maxUploadBytes`.
     */
    restoreUpload: route({
      method: 'POST',
      path: '/api/admin/backups/restore-upload',
      auth: 'admin',
      scope: 'session',
      upload: 'multipart/form-data',
      response: dto.RestoreResultDto,
    }),
  },

  universe: {
    searchSystems: route({
      method: 'GET',
      path: '/api/universe/systems',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      query: dto.UniverseSearchQuery,
      response: z.array(dto.UniverseSystemDto),
    }),
    getSystem: route({
      method: 'GET',
      path: '/api/universe/systems/:solarSystemId',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      response: dto.UniverseSystemDto,
    }),
    /** Several systems at once (unknown ids are left out), e.g. every system on a map. */
    lookup: route({
      method: 'GET',
      path: '/api/universe/lookup',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      query: dto.UniverseLookupQuery,
      response: z.array(dto.UniverseSystemDto),
    }),
    /** Published ships by name with what changes their jump mass (SDE). */
    searchShips: route({
      method: 'GET',
      path: '/api/universe/ships',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      query: dto.ShipSearchQuery,
      response: z.array(dto.ShipTypeDto),
    }),
    /** What prop modules, Higgs Anchors and the mass entangler do, and ships people roll with. */
    shipCatalog: route({
      method: 'GET',
      path: '/api/universe/ships/catalog',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      response: dto.ShipCatalogDto,
    }),
    /** A pasted fit (EFT) weighed cold and hot. */
    fitMass: route({
      method: 'POST',
      path: '/api/universe/ships/fit-mass',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      body: dto.FitMassRequest,
      response: dto.FitMassDto,
    }),
    getShip: route({
      method: 'GET',
      path: '/api/universe/ships/:shipTypeId',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      response: dto.ShipTypeDto,
    }),
    /** Every wormhole type with its SDE attributes, and the hull classes "fits" refers to. */
    wormholes: route({
      method: 'GET',
      path: '/api/universe/wormholes',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      response: dto.WormholeCatalogDto,
    }),
  },

  maps: {
    list: route({
      method: 'GET',
      path: '/api/maps',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      response: z.array(dto.MapSummaryDto),
    }),
    create: route({
      method: 'POST',
      path: '/api/maps',
      auth: 'account',
      scope: { resource: 'maps', action: 'write', global: true },
      body: dto.CreateMapRequest,
      response: dto.MapDto,
    }),
    bySlug: route({
      method: 'GET',
      path: '/api/maps/by-slug/:slug',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      response: dto.MapDto,
    }),
    get: route({
      method: 'GET',
      path: '/api/maps/:mapId',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      response: dto.MapDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      body: dto.UpdateMapRequest,
      response: dto.MapDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
    }),
    setLabels: route({
      method: 'PUT',
      path: '/api/maps/:mapId/labels',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      body: dto.SetLabelsRequest,
      response: z.array(dto.LabelDto),
    }),
    /** The map's Labels (WH1, WH2...) in order (manager+); published as `system_labels.changed`. */
    setSystemLabels: route({
      method: 'PUT',
      path: '/api/maps/:mapId/system-labels',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      body: dto.SetSystemLabelsRequest,
      response: z.array(dto.SystemLabelDto),
    }),
    /** The map's default bookmark label template (manager+); published as `map.settings_changed`. */
    setBookmarkTemplate: route({
      method: 'PUT',
      path: '/api/maps/:mapId/bookmark-template',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      body: dto.SetBookmarkTemplateRequest,
      response: dto.MapDto,
    }),
    /**
     * The map's `{n}` numbering: order and renumber on close (manager+); published as
     * `map.settings_changed`. A new order numbers every system's wormholes again.
     */
    setBookmarkNumbering: route({
      method: 'PUT',
      path: '/api/maps/:mapId/bookmark-numbering',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      body: dto.SetBookmarkNumberingRequest,
      response: dto.MapDto,
    }),
    /** Numbers wormholes 1, 2, 3 again in the map's order; changes arrive as `connection.updated`. */
    renumberBookmarks: route({
      method: 'POST',
      path: '/api/maps/:mapId/bookmark-numbers/renumber',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'member',
      body: dto.RenumberBookmarksRequest,
    }),
    /** The caller's own view of the map: last viewport and bookmark template override. */
    getPreferences: route({
      method: 'GET',
      path: '/api/maps/:mapId/preferences',
      auth: 'account',
      scope: 'session',
      mapRole: 'viewer',
      response: dto.MapPreferencesDto,
    }),
    updatePreferences: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/preferences',
      auth: 'account',
      scope: 'session',
      mapRole: 'viewer',
      body: dto.UpdateMapPreferencesRequest,
      response: dto.MapPreferencesDto,
    }),
  },

  systems: {
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.AddSystemRequest,
      response: dto.MapSystemDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/systems/:solarSystemId',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.UpdateSystemRequest,
      response: dto.MapSystemDto,
    }),
    move: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/positions',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.MoveSystemsRequest,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/systems/:solarSystemId',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
    }),
  },

  connections: {
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
      body: dto.AddConnectionRequest,
      response: dto.ConnectionDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/connections/:connectionId',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
      body: dto.UpdateConnectionRequest,
      response: dto.ConnectionDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/connections/:connectionId',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
    }),
    /** A wormhole's `{n}` set by hand; the sibling that had the number swaps with it. */
    setBookmarkNumber: route({
      method: 'PUT',
      path: '/api/maps/:mapId/connections/:connectionId/bookmark-number',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
      body: dto.SetBookmarkNumberRequest,
      response: dto.ConnectionDto,
    }),
    /** The connections panel: every visible connection with type, mass and time estimates, most urgent first. */
    intel: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/intel',
      auth: 'account',
      scope: { resource: 'connections', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.ConnectionIntelDto),
    }),
    /** One connection with its type, mass and time estimates (the sidebar's Connection section). */
    intelOne: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/:connectionId/intel',
      auth: 'account',
      scope: { resource: 'connections', action: 'read' },
      mapRole: 'viewer',
      response: dto.ConnectionIntelDto,
    }),
    /** Ships recorded going through a connection, newest first. */
    passages: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/:connectionId/passages',
      auth: 'account',
      scope: { resource: 'connections', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.PassageDto),
    }),
    /** "Log a jump" for pilots nobody tracks; on a merged map it goes to the map that takes new objects. */
    logPassages: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections/:connectionId/passages',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
      body: dto.LogPassagesRequest,
      response: z.array(dto.PassageDto),
    }),
    /** Passages count from now on, against the mass status as it is (earlier ones stay in the log). */
    resetPassages: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections/:connectionId/passages/reset',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
    }),
    /** How a passage's mass counts (cold, hot, custom), its modules and note. */
    updatePassage: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/connections/:connectionId/passages/:passageId',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
      body: dto.UpdatePassageRequest,
      response: dto.PassageDto,
    }),
    removePassage: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/connections/:connectionId/passages/:passageId',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
    }),
    /** A rolling plan for the connection with the crew's ships. */
    rollPlan: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections/:connectionId/roll-plan',
      auth: 'account',
      scope: { resource: 'connections', action: 'read' },
      mapRole: 'viewer',
      body: dto.RollPlanRequest,
      response: dto.RollPlanDto,
    }),
  },

  routing: {
    /** A route over stargates and the map's chain. */
    route: route({
      method: 'GET',
      path: '/api/maps/:mapId/route',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      query: dto.RouteQuery,
      response: dto.RouteDto,
    }),
    /** Ways out of the chain with the nearest hub and jumps. */
    exits: route({
      method: 'GET',
      path: '/api/maps/:mapId/exits',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      query: dto.ExitsQuery,
      response: dto.MapExitsDto,
    }),
    hubs: route({
      method: 'GET',
      path: '/api/maps/:mapId/hubs',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      response: dto.HubsDto,
    }),
    setMapHubs: route({
      method: 'PUT',
      path: '/api/maps/:mapId/hubs',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'member',
      body: dto.SetHubsRequest,
      response: z.array(dto.HubDto),
    }),
    /** Jumps from one system to every hub of the viewer, nearest first. */
    hubDistances: route({
      method: 'GET',
      path: '/api/maps/:mapId/hubs/distances',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      query: dto.HubDistancesQuery,
      response: z.array(dto.HubDistanceDto),
    }),
    personalHubs: route({
      method: 'GET',
      path: '/api/accounts/me/hubs',
      auth: 'account',
      scope: { resource: 'account', action: 'read' },
      response: z.array(dto.HubDto),
    }),
    setPersonalHubs: route({
      method: 'PUT',
      path: '/api/accounts/me/hubs',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.SetHubsRequest,
      response: z.array(dto.HubDto),
    }),
    /** Sets the in-game destination or adds a waypoint (ESI, `esi-ui.write_waypoint.v1`). */
    waypoint: route({
      method: 'POST',
      path: '/api/accounts/me/characters/:characterId/waypoint',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.WaypointRequest,
    }),
    /** One destination or waypoint for several own characters at once. */
    waypoints: route({
      method: 'POST',
      path: '/api/accounts/me/waypoints',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.WaypointsRequest,
      response: dto.WaypointsResultDto,
    }),
    /** Routes from one system to every map hub (or every own hub), with the systems on the way. */
    hubRoutes: route({
      method: 'GET',
      path: '/api/maps/:mapId/routes/hubs',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      query: dto.HubRoutesQuery,
      response: dto.HubRoutesDto,
    }),
    /** The nearest places of a kind (loot buyers, security offices, trade hubs, Thera, Turnur). */
    routesBy: route({
      method: 'GET',
      path: '/api/maps/:mapId/routes/by',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      query: dto.RoutesByQuery,
      response: dto.RoutesByDto,
    }),
    /** The viewer's route options, the same on every map. */
    preferences: route({
      method: 'GET',
      path: '/api/accounts/me/route-preferences',
      auth: 'account',
      scope: { resource: 'account', action: 'read' },
      response: dto.RoutePreferencesDto,
    }),
    updatePreferences: route({
      method: 'PUT',
      path: '/api/accounts/me/route-preferences',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.UpdateRoutePreferencesRequest,
      response: dto.RoutePreferencesDto,
    }),
    mapSettings: route({
      method: 'GET',
      path: '/api/maps/:mapId/routing-settings',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      response: dto.MapRoutingSettingsDto,
    }),
    updateMapSettings: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/routing-settings',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'manager',
      body: dto.UpdateMapRoutingSettingsRequest,
      response: dto.MapRoutingSettingsDto,
    }),
    /** The way home from each hub to the map's home system. */
    wayHome: route({
      method: 'GET',
      path: '/api/maps/:mapId/way-home',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      response: dto.WayHomeDto,
    }),
    /** Thera and Turnur holes as EVE-Scout lists them. */
    eveScout: route({
      method: 'GET',
      path: '/api/routes/eve-scout',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      response: dto.TheraDto,
    }),
    /** NPC stations of a system. */
    stations: route({
      method: 'GET',
      path: '/api/universe/systems/:solarSystemId/stations',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      response: dto.StationsDto,
    }),
  },

  /** Ansiblex jump bridges a map routes over. */
  bridges: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/bridges',
      auth: 'account',
      scope: { resource: 'routes', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.BridgeDto),
    }),
    paste: route({
      method: 'POST',
      path: '/api/maps/:mapId/bridges/paste',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'manager',
      body: dto.PasteBridgesRequest,
      response: dto.ImportBridgesResultDto,
    }),
    /** Reads the Ansiblex gates of the character's corporation (ESI, Station Manager role). */
    readFromEsi: route({
      method: 'POST',
      path: '/api/maps/:mapId/bridges/esi',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'manager',
      body: dto.ReadBridgesFromEsiRequest,
      response: dto.ImportBridgesResultDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/bridges/:bridgeId',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'manager',
      body: dto.UpdateBridgeRequest,
      response: dto.BridgeDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/bridges/:bridgeId',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'manager',
    }),
    clear: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/bridges',
      auth: 'account',
      scope: { resource: 'routes', action: 'write' },
      mapRole: 'manager',
    }),
  },

  jumps: {
    /** Ships with a jump drive and the version of the k-space dataset. */
    meta: route({
      method: 'GET',
      path: '/api/jumps',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      summary: 'Ships with a jump drive and the k-space dataset version',
      response: dto.JumpMetaDto,
    }),
    /** Known space for the planner's map; `?v=<version>` answers are cached for good. */
    universe: route({
      method: 'GET',
      path: '/api/jumps/universe',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      summary: 'Known space for the jump planner map (columnar)',
      query: dto.JumpUniverseQuery,
      response: dto.JumpUniverseDto,
    }),
    /** A capital jump route between two known-space systems; changes nothing. */
    plan: route({
      method: 'POST',
      path: '/api/jumps/plan',
      auth: 'account',
      scope: { resource: 'universe', action: 'read' },
      summary: 'Plan a capital jump route between two known-space systems',
      status: 200,
      body: dto.JumpPlanRequest,
      response: dto.JumpPlanDto,
    }),
  },

  signatures: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures',
      auth: 'account',
      scope: { resource: 'signatures', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.SignatureDto),
    }),
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures',
      auth: 'account',
      scope: { resource: 'signatures', action: 'write' },
      mapRole: 'member',
      body: dto.AddSignatureRequest,
      response: dto.SignatureDto,
    }),
    paste: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures/paste',
      auth: 'account',
      scope: { resource: 'signatures', action: 'write' },
      status: 200,
      mapRole: 'member',
      body: dto.PasteSignaturesRequest,
      response: dto.PasteSignaturesResult,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/signatures/:signatureId',
      auth: 'account',
      scope: { resource: 'signatures', action: 'write' },
      mapRole: 'member',
      body: dto.UpdateSignatureRequest,
      response: dto.SignatureDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/signatures/:signatureId',
      auth: 'account',
      scope: { resource: 'signatures', action: 'write' },
      mapRole: 'member',
    }),
    /** Several at once, with the cascades; returns what was removed, for an undo. */
    removeMany: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/signatures/remove',
      auth: 'account',
      scope: { resource: 'signatures', action: 'write' },
      mapRole: 'member',
      body: dto.RemoveSignaturesRequest,
      response: dto.RemovedSignaturesDto,
    }),
    /** Puts removed signatures back (the undo of a removal or of a paste that removed some). */
    restore: route({
      method: 'POST',
      path: '/api/maps/:mapId/signatures/restore',
      auth: 'account',
      scope: { resource: 'signatures', action: 'write' },
      mapRole: 'member',
      body: dto.RestoreSignaturesRequest,
      response: z.array(dto.SignatureDto),
    }),
  },

  /** Shares between maps: a source map's admins offer, the target map's admins accept. */
  sharing: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/shares',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      response: dto.MapSharesDto,
    }),
    offer: route({
      method: 'POST',
      path: '/api/maps/:mapId/shares',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      body: dto.OfferShareRequest,
      response: dto.MapShareDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/shares/:shareId',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      body: dto.UpdateShareRequest,
      response: dto.MapShareDto,
    }),
    accept: route({
      method: 'POST',
      path: '/api/maps/:mapId/shares/:shareId/accept',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      body: dto.AcceptShareRequest,
      response: dto.MapShareDto,
    }),
    /** Revokes a share or declines an offer (either side's admins). */
    revoke: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/shares/:shareId',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
    }),
  },

  access: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/access-rules',
      auth: 'account',
      scope: { resource: 'access', action: 'manage' },
      mapRole: 'manager',
      response: z.array(dto.AccessRuleDto),
    }),
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/access-rules',
      auth: 'account',
      scope: { resource: 'access', action: 'manage' },
      mapRole: 'manager',
      body: dto.CreateAccessRuleRequest,
      response: dto.AccessRuleDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/access-rules/:ruleId',
      auth: 'account',
      scope: { resource: 'access', action: 'manage' },
      mapRole: 'manager',
    }),
  },

  tracking: {
    characters: route({
      method: 'GET',
      path: '/api/maps/:mapId/characters',
      auth: 'account',
      scope: { resource: 'tracking', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.CharacterPresenceDto),
    }),
    set: route({
      method: 'PUT',
      path: '/api/maps/:mapId/tracking',
      auth: 'account',
      scope: { resource: 'tracking', action: 'write' },
      mapRole: 'member',
      body: dto.SetTrackingRequest,
    }),
  },

  /** Imports of whole maps from Wanderer (docs/migrate-from-wanderer.md). */
  imports: {
    /** Whether a Wanderer instance answers and the map API key works. */
    test: route({
      method: 'POST',
      path: '/api/imports/wanderer/test',
      auth: 'account',
      scope: 'session',
      body: dto.WandererApiSourceRequest,
      response: dto.WandererTestResultDto,
    }),
    /** Reads the whole map over Wanderer's API and stages it as a preview. */
    previewApi: route({
      method: 'POST',
      path: '/api/imports/wanderer',
      auth: 'account',
      scope: 'session',
      body: dto.WandererApiSourceRequest,
      response: dto.ImportJobDto,
    }),
    /**
     * Stages a Wanderer export file: the raw JSON as the body with content type
     * `WANDERER_EXPORT_CONTENT_TYPE` (streamed, 25 MB at most); `?name=` the file's name.
     */
    previewFile: route({
      method: 'POST',
      path: '/api/imports/wanderer/file',
      auth: 'account',
      scope: 'session',
      upload: dto.WANDERER_EXPORT_CONTENT_TYPE,
      response: dto.ImportJobDto,
    }),
    get: route({
      method: 'GET',
      path: '/api/imports/:jobId',
      auth: 'account',
      scope: 'session',
      response: dto.ImportJobDto,
    }),
    /** What an import into a new map or a merge into an existing one would do. */
    plan: route({
      method: 'POST',
      path: '/api/imports/:jobId/plan',
      auth: 'account',
      scope: 'session',
      body: dto.ImportPlanRequest,
      response: dto.ImportPlanDto,
    }),
    start: route({
      method: 'POST',
      path: '/api/imports/:jobId/start',
      auth: 'account',
      scope: 'session',
      body: dto.StartImportRequest,
      response: dto.ImportJobDto,
    }),
    cancel: route({
      method: 'POST',
      path: '/api/imports/:jobId/cancel',
      auth: 'account',
      scope: 'session',
      response: dto.ImportJobDto,
    }),
    /** The whole report as a JSON download (job, mapping report, outcome, `importedExtra`). */
    report: route({
      method: 'GET',
      path: '/api/imports/:jobId/report',
      auth: 'account',
      scope: 'session',
      download: true,
    }),
    /** The map's sync from Wanderer, or null. */
    sync: route({
      method: 'GET',
      path: '/api/maps/:mapId/import-sync',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      response: dto.ImportSyncDto.nullable(),
    }),
    stopSync: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/import-sync',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
    }),
  },

  webhooks: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/webhooks',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      mapRole: 'admin',
      response: z.array(dto.WebhookDto),
    }),
    create: route({
      method: 'POST',
      path: '/api/maps/:mapId/webhooks',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      mapRole: 'admin',
      body: dto.CreateWebhookRequest,
      response: dto.CreatedWebhookDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/webhooks/:webhookId',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      mapRole: 'admin',
      body: dto.UpdateWebhookRequest,
      response: dto.WebhookDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/webhooks/:webhookId',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      mapRole: 'admin',
    }),
    deliveries: route({
      method: 'GET',
      path: '/api/maps/:mapId/webhooks/:webhookId/deliveries',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      mapRole: 'admin',
      response: z.array(dto.WebhookDeliveryDto),
    }),
    /** A new signing secret, shown once in the answer; the old one stops working. */
    rotateSecret: route({
      method: 'POST',
      path: '/api/maps/:mapId/webhooks/:webhookId/rotate-secret',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      status: 200,
      mapRole: 'admin',
      response: dto.CreatedWebhookDto,
    }),
    /** Sends a `webhook.test` event once, without retries, and returns the delivery. */
    test: route({
      method: 'POST',
      path: '/api/maps/:mapId/webhooks/:webhookId/test',
      auth: 'account',
      scope: { resource: 'webhooks', action: 'manage' },
      status: 200,
      mapRole: 'admin',
      response: dto.WebhookDeliveryDto,
    }),
  },

  plugins: {
    list: route({
      method: 'GET',
      path: '/api/admin/plugins',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: z.array(dto.PluginDto),
    }),
    install: route({
      method: 'POST',
      path: '/api/admin/plugins',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.InstallPluginRequest,
      response: dto.PluginDto,
    }),
    setEnabled: route({
      method: 'PUT',
      path: '/api/admin/plugins/:pluginId/enabled',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.SetPluginEnabledRequest,
      response: dto.PluginDto,
    }),
    uninstall: route({
      method: 'DELETE',
      path: '/api/admin/plugins/:pluginId',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
    /** Body: the raw .tgz with `content-type: application/gzip` (or application/octet-stream). */
    upload: route({
      method: 'POST',
      path: '/api/admin/plugins/upload',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      upload: 'application/gzip',
      response: dto.PluginDto,
    }),
    /** First-party plugins and themes shipped with the server. */
    catalog: route({
      method: 'GET',
      path: '/api/admin/plugins/catalog',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: z.array(dto.CatalogEntryDto),
    }),
    settings: route({
      method: 'GET',
      path: '/api/admin/plugins/:pluginId/settings',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      query: dto.PluginSettingsQuery,
      response: dto.PluginSettingsDto,
    }),
    updateSettings: route({
      method: 'PUT',
      path: '/api/admin/plugins/:pluginId/settings',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.UpdatePluginSettingsRequest,
      response: dto.PluginSettingsDto,
    }),
    /** Enabled plugins with a web part, for the SPA to load. */
    web: route({
      method: 'GET',
      path: '/api/plugins/web',
      auth: 'account',
      scope: 'session',
      response: z.array(dto.PluginWebDto),
    }),
    /** Files of a plugin's web part (the folder of its web entry). `url` in `web` points here. */
    asset: route({
      method: 'GET',
      path: '/api/plugins/:pluginId/assets/:file',
      auth: 'account',
      scope: 'session',
      download: true,
    }),
  },

  /**
   * History of changes (the event log with its audit records). Map histories are open to map
   * viewers; the request origin is shown to map admins only. Newest first, paged with `before`.
   */
  audit: {
    mapHistory: route({
      method: 'GET',
      path: '/api/maps/:mapId/history',
      auth: 'account',
      scope: { resource: 'audit', action: 'read' },
      mapRole: 'viewer',
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    /** The system, its signatures and the connections touching it. */
    systemHistory: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/history',
      auth: 'account',
      scope: { resource: 'audit', action: 'read' },
      mapRole: 'viewer',
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    connectionHistory: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/:connectionId/history',
      auth: 'account',
      scope: { resource: 'audit', action: 'read' },
      mapRole: 'viewer',
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    /** `format=csv|json`; a file download (`content-disposition: attachment`). */
    mapExport: route({
      method: 'GET',
      path: '/api/maps/:mapId/history/export',
      auth: 'account',
      scope: { resource: 'audit', action: 'read' },
      download: true,
      mapRole: 'viewer',
      query: dto.AuditExportQuery,
    }),
    /**
     * Undoes one change when that is safe (the thing still looks as the change left it); the
     * revert is recorded like any change, with `revertOf`. 409 when it changed since.
     */
    revert: route({
      method: 'POST',
      path: '/api/maps/:mapId/history/:eventId/revert',
      auth: 'account',
      scope: { resource: 'audit', action: 'write' },
      status: 200,
      mapRole: 'member',
      response: dto.AuditRevertDto,
    }),
    /**
     * Instance audit: sign-ins, roles and ownership, access rules, plugins and their settings,
     * themes, instance settings and webhooks.
     */
    instance: route({
      method: 'GET',
      path: '/api/admin/audit',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    instanceExport: route({
      method: 'GET',
      path: '/api/admin/audit/export',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      download: true,
      query: dto.AuditExportQuery,
    }),
    /** Checks the hash chain of every stream (or `?stream=`). */
    verify: route({
      method: 'POST',
      path: '/api/admin/audit/verify',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      status: 200,
      response: dto.AuditVerifyDto,
    }),
  },

  /** Anonymous product telemetry (see docs/telemetry.md). */
  telemetry: {
    /** Whether the web app reports usage, and whether to show the admin the notice about it. */
    client: route({
      method: 'GET',
      path: '/api/telemetry',
      auth: 'account',
      scope: 'none',
      response: telemetry.TelemetryClientDto,
    }),
    /**
     * Usage events from the web app, checked against the allow-list and forwarded without the
     * request's IP or anything else about the browser. 400 when any event is not on the list.
     */
    ingest: route({
      method: 'POST',
      path: '/api/telemetry/e',
      auth: 'account',
      scope: 'session',
      status: 202,
      body: telemetry.TelemetryIngestRequest,
      response: telemetry.TelemetryIngestResultDto,
    }),
    /** Status, instance id, the last payloads sent and the heartbeat as it would be sent now. */
    status: route({
      method: 'GET',
      path: '/api/admin/telemetry',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: telemetry.TelemetryStatusDto,
    }),
    /** The admin switch; recorded on the instance audit as `telemetry.changed`. */
    setEnabled: route({
      method: 'PUT',
      path: '/api/admin/telemetry/enabled',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: telemetry.SetTelemetryEnabledRequest,
      response: telemetry.TelemetryStatusDto,
    }),
    /** The admin has read the notice about telemetry; it is not shown to them again. */
    dismissNotice: route({
      method: 'POST',
      path: '/api/admin/telemetry/notice',
      auth: 'admin',
      scope: 'session',
    }),
  },

  presence: {
    settings: route({
      method: 'GET',
      path: '/api/accounts/me/presence',
      auth: 'account',
      scope: 'session',
      response: dto.PresenceSettingsDto,
    }),
    updateSettings: route({
      method: 'PUT',
      path: '/api/accounts/me/presence',
      auth: 'account',
      scope: 'session',
      body: dto.UpdatePresenceSettingsRequest,
      response: dto.PresenceSettingsDto,
    }),
  },

  themes: {
    list: route({
      method: 'GET',
      path: '/api/themes',
      auth: 'public',
      scope: 'none',
      response: dto.ThemesDto,
    }),
    select: route({
      method: 'PUT',
      path: '/api/accounts/me/theme',
      auth: 'account',
      scope: 'session',
      body: dto.SelectThemeRequest,
      response: dto.ThemesDto,
    }),
    setDefault: route({
      method: 'PUT',
      path: '/api/admin/themes/default',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.SetDefaultThemeRequest,
      response: dto.ThemesDto,
    }),
    install: route({
      method: 'POST',
      path: '/api/admin/themes',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.InstallPluginRequest,
      response: dto.ThemeDto,
    }),
    /** Body: the raw .tgz, as for plugins. */
    upload: route({
      method: 'POST',
      path: '/api/admin/themes/upload',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      upload: 'application/gzip',
      response: dto.ThemeDto,
    }),
    uninstall: route({
      method: 'DELETE',
      path: '/api/admin/themes/:themeId',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
  },
  /**
   * Personal access tokens: made by a signed-in account in its settings, acting as that account
   * and never more (the scopes only narrow). Managing keys needs a browser session.
   */
  apiKeys: {
    list: route({
      method: 'GET',
      path: '/api/accounts/me/api-keys',
      auth: 'account',
      scope: 'session',
      summary: 'Your personal access tokens',
      response: z.array(dto.ApiKeyDto),
    }),
    create: route({
      method: 'POST',
      path: '/api/accounts/me/api-keys',
      auth: 'account',
      scope: 'session',
      summary: 'Make a personal access token (the token is shown once)',
      body: dto.CreateApiKeyRequest,
      response: dto.CreatedApiKeyDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/accounts/me/api-keys/:keyId',
      auth: 'account',
      scope: 'session',
      summary: 'Rename a token or change its IP allow-list and rate limit',
      body: dto.UpdateApiKeyRequest,
      response: dto.ApiKeyDto,
    }),
    rotate: route({
      method: 'POST',
      path: '/api/accounts/me/api-keys/:keyId/rotate',
      auth: 'account',
      status: 200,
      scope: 'session',
      summary: 'Replace the secret of a token; the old one stops working at once',
      response: dto.CreatedApiKeyDto,
    }),
    revoke: route({
      method: 'DELETE',
      path: '/api/accounts/me/api-keys/:keyId',
      auth: 'account',
      scope: 'session',
      summary: 'Revoke a token',
    }),
    /** Every key of the instance, personal and service (instance admins), to find and revoke. */
    adminList: route({
      method: 'GET',
      path: '/api/admin/api-keys',
      auth: 'admin',
      scope: 'session',
      summary: 'Every API key of the instance',
      response: z.array(dto.ApiKeyDto),
    }),
    adminRevoke: route({
      method: 'DELETE',
      path: '/api/admin/api-keys/:keyId',
      auth: 'admin',
      scope: 'session',
      summary: 'Revoke any key',
    }),
    /** Service keys: their own principal with an instance role and map roles an admin gives them. */
    createService: route({
      method: 'POST',
      path: '/api/admin/service-keys',
      auth: 'admin',
      scope: 'session',
      summary: 'Make a service key (the token is shown once)',
      body: dto.CreateServiceKeyRequest,
      response: dto.CreatedApiKeyDto,
    }),
    updateService: route({
      method: 'PATCH',
      path: '/api/admin/service-keys/:keyId',
      auth: 'admin',
      scope: 'session',
      summary: 'Rename a service key or change its IP allow-list and rate limit',
      body: dto.UpdateApiKeyRequest,
      response: dto.ApiKeyDto,
    }),
    rotateService: route({
      method: 'POST',
      path: '/api/admin/service-keys/:keyId/rotate',
      auth: 'admin',
      status: 200,
      scope: 'session',
      summary: 'Replace the secret of a service key',
      response: dto.CreatedApiKeyDto,
    }),
  },

  /** A map's public link (`/p/<token>`) and what it shows; map admins. */
  publicLink: {
    get: route({
      method: 'GET',
      path: '/api/maps/:mapId/public-link',
      auth: 'account',
      mapRole: 'admin',
      scope: { resource: 'maps', action: 'manage' },
      summary: 'Public link and AI agent reach of a map',
      response: dto.PublicLinkDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/public-link',
      auth: 'account',
      mapRole: 'admin',
      scope: { resource: 'maps', action: 'manage' },
      summary: 'Switch the public link on or off and choose what it shows',
      body: dto.UpdatePublicLinkRequest,
      response: dto.PublicLinkDto,
    }),
    regenerate: route({
      method: 'POST',
      path: '/api/maps/:mapId/public-link/regenerate',
      auth: 'account',
      status: 200,
      mapRole: 'admin',
      scope: { resource: 'maps', action: 'manage' },
      summary: 'Make a new public link; the old one stops working',
      response: dto.PublicLinkDto,
    }),
  },

  /** Read without a session; rate limited per client address. */
  public: {
    map: route({
      method: 'GET',
      path: '/api/public/maps/:token',
      auth: 'public',
      scope: 'none',
      summary: 'A public map: what its link shows, and the stream to follow it live',
      response: dto.PublicMapViewDto,
    }),
  },

  /**
   * OAuth 2.1 for the MCP endpoint (docs/mcp.md). The metadata documents are under
   * `/.well-known/` (RFC 8414, RFC 9728); the authorization endpoint is the web page
   * `/oauth/authorize`, which uses `describe` and `decide`.
   */
  oauth: {
    register: route({
      method: 'POST',
      path: '/api/oauth/register',
      auth: 'public',
      scope: 'none',
      summary: 'Dynamic client registration (RFC 7591), public clients only',
      body: dto.OAuthRegisterRequest,
      response: dto.OAuthRegisteredClientDto,
    }),
    token: route({
      method: 'POST',
      path: '/api/oauth/token',
      auth: 'public',
      scope: 'none',
      status: 200,
      summary: 'Exchange a code (with its PKCE verifier) or a refresh token for tokens',
      body: dto.OAuthTokenRequest,
      bodyContentType: 'application/x-www-form-urlencoded',
      response: dto.OAuthTokenResponse,
    }),
    describe: route({
      method: 'GET',
      path: '/api/oauth/authorize',
      auth: 'account',
      scope: 'session',
      summary: 'Check an authorization request and say what the consent page shows',
      query: dto.OAuthAuthorizeQuery,
      response: dto.OAuthAuthorizeRequestDto,
    }),
    decide: route({
      method: 'POST',
      path: '/api/oauth/authorize',
      auth: 'account',
      scope: 'session',
      status: 200,
      summary: 'Approve (possibly narrowed) or decline; answers where the browser goes next',
      body: dto.OAuthAuthorizeDecision,
      response: dto.OAuthRedirectDto,
    }),
    grants: route({
      method: 'GET',
      path: '/api/accounts/me/oauth-grants',
      auth: 'account',
      scope: 'session',
      summary: 'MCP clients you approved',
      response: z.array(dto.OAuthGrantDto),
    }),
    revokeGrant: route({
      method: 'DELETE',
      path: '/api/accounts/me/oauth-grants/:grantId',
      auth: 'account',
      scope: 'session',
      summary: 'Revoke an approval and every token it gave',
    }),
  },

  /** This API, described. */
  docs: {
    openapi: route({
      method: 'GET',
      path: '/api/openapi.json',
      auth: 'public',
      scope: 'none',
      summary: 'OpenAPI 3.1 description of this API',
      response: z.record(z.string(), z.unknown()),
    }),
    asyncapi: route({
      method: 'GET',
      path: '/api/asyncapi.json',
      auth: 'public',
      scope: 'none',
      summary: 'AsyncAPI 3.0 description of the WebSocket protocol and webhooks',
      response: z.record(z.string(), z.unknown()),
    }),
    ui: route({
      method: 'GET',
      path: '/api/docs',
      auth: 'public',
      scope: 'none',
      summary: 'Interactive API reference',
      contentType: 'text/html',
    }),
    asset: route({
      method: 'GET',
      path: '/api/docs/assets/*',
      auth: 'public',
      scope: 'none',
      summary: 'Files of the API reference page',
      download: true,
    }),
  },

  /** Comment threads on the systems of a map (newest first). */
  comments: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/comments',
      auth: 'account',
      scope: { resource: 'systems', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.CommentDto),
    }),
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/comments',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.AddCommentRequest,
      response: dto.CommentDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/comments/:commentId',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
    }),
  },

  /** Structures in the systems of a map, with owners and timers. */
  structures: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/structures',
      auth: 'account',
      scope: { resource: 'systems', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.StructureDto),
    }),
    /** Every structure of the map, soonest timer first (timer boards and bots). */
    listMap: route({
      method: 'GET',
      path: '/api/maps/:mapId/structures',
      auth: 'account',
      scope: { resource: 'systems', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.StructureDto),
    }),
    add: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/structures',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.AddStructureRequest,
      response: dto.StructureDto,
    }),
    paste: route({
      method: 'POST',
      path: '/api/maps/:mapId/systems/:solarSystemId/structures/paste',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.PasteStructuresRequest,
      response: dto.PasteStructuresResult,
    }),
    setOwners: route({
      method: 'PUT',
      path: '/api/maps/:mapId/systems/:solarSystemId/structures/owner',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.SetStructureOwnersRequest,
      response: z.array(dto.StructureDto),
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/structures/:structureId',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.UpdateStructureRequest,
      response: dto.StructureDto,
    }),
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/structures/:structureId',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
    }),
  },

  /** More on access rules (managers handle viewers, members and blocks; admins every rule). */
  accessRules: {
    /** Changes a rule's role in place; the subject stays. */
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/access-rules/:ruleId',
      auth: 'account',
      scope: { resource: 'access', action: 'manage' },
      mapRole: 'manager',
      body: dto.UpdateAccessRuleRequest,
      response: dto.AccessRuleDto,
    }),
    /** Adds the rules of another map the caller manages (admins of this map). */
    copy: route({
      method: 'POST',
      path: '/api/maps/:mapId/access-rules/copy',
      auth: 'account',
      scope: { resource: 'access', action: 'manage' },
      mapRole: 'admin',
      status: 200,
      body: dto.CopyAccessRulesRequest,
      response: dto.CopyAccessRulesResultDto,
    }),
  },

  /** Owner handover and duplicating a map. */
  mapLifecycle: {
    /** The owner (or an instance admin, under `adminMaps`) hands the map to another account. */
    transferOwner: route({
      method: 'PUT',
      path: '/api/maps/:mapId/owner',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      body: dto.TransferMapOwnerRequest,
      response: dto.MapDto,
    }),
    /** A new map from this one (systems, connections, settings, labels; signatures and rules on request). */
    duplicate: route({
      method: 'POST',
      path: '/api/maps/:mapId/duplicate',
      auth: 'account',
      scope: { resource: 'maps', action: 'write', global: true },
      mapRole: 'admin',
      body: dto.DuplicateMapRequest,
      response: dto.ImportMapResultDto,
    }),
  },

  /**
   * Darkbeacon's own map files (`darkbeacon.map` v1): everything on a map, to move it between
   * instances or out of Darkbeacon; and the settings alone. Bodies over 1 MB are sent as
   * `application/vnd.darkbeacon.map+json` (up to 32 MB).
   */
  mapFiles: {
    export: route({
      method: 'GET',
      path: '/api/maps/:mapId/export',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      query: dto.MapExportQuery,
      download: true,
      response: dto.MapExportDocument,
    }),
    import: route({
      method: 'POST',
      path: '/api/maps/import',
      auth: 'account',
      scope: { resource: 'maps', action: 'write', global: true },
      body: dto.ImportMapRequest,
      response: dto.ImportMapResultDto,
    }),
    exportSettings: route({
      method: 'GET',
      path: '/api/maps/:mapId/settings/export',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      download: true,
      response: dto.MapSettingsExportDocument,
    }),
    importSettings: route({
      method: 'POST',
      path: '/api/maps/:mapId/settings/import',
      auth: 'account',
      scope: { resource: 'maps', action: 'manage' },
      mapRole: 'admin',
      status: 200,
      body: dto.ImportMapSettingsRequest,
      response: dto.MapDto,
    }),
  },

  /**
   * Wanderer's legacy public map API, answered from Darkbeacon data so bots written for Wanderer
   * keep working (read-only; Wanderer's JSON shapes and errors, not Darkbeacon's). The Bearer
   * token is a Darkbeacon API key reaching the map with read scopes; the map is `?map_id=` (an
   * id) or `?slug=`, or the `:mapId` segment (an id or a slug). The use cases check the key's map
   * role and the controller its scope per resource, so the routes themselves ask for nothing.
   */
  wandererCompat: {
    systems: route({
      method: 'GET',
      path: '/api/map/systems',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: visible systems and connections of a map',
      response: dto.WandererSystemsDto,
    }),
    system: route({
      method: 'GET',
      path: '/api/map/system',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: one system by `id` (solar system id)',
      response: dto.WandererSystemResponseDto,
    }),
    connections: route({
      method: 'GET',
      path: '/api/map/connections',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: connections of a map',
      response: dto.WandererConnectionsDto,
    }),
    characters: route({
      method: 'GET',
      path: '/api/map/characters',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: tracked characters of a map',
      response: dto.WandererTrackedCharactersDto,
    }),
    userCharacters: route({
      method: 'GET',
      path: '/api/map/user_characters',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: characters on a map grouped by person',
      response: dto.WandererUserCharactersDto,
    }),
    mapSystems: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: systems and connections (`:mapId` may be a slug)',
      response: dto.WandererSystemsDto,
    }),
    mapConnections: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: connections, optionally by `solar_system_source`/`_target`',
      response: dto.WandererConnectionsDto,
    }),
    mapTrackedCharacters: route({
      method: 'GET',
      path: '/api/maps/:mapId/tracked-characters',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: tracked characters (`:mapId` may be a slug)',
      response: dto.WandererTrackedCharactersDto,
    }),
    /** Wanderer's SSE stream: `events=` names, `last_event_id=` (a ULID) backfill, a `connected` frame first. */
    eventsStream: route({
      method: 'GET',
      path: '/api/maps/:mapId/events/stream',
      auth: 'account',
      scope: 'none',
      summary: 'Wanderer-compatible: Server-Sent Events with Wanderer event names',
      contentType: 'text/event-stream',
    }),
  },

  /** People and characters for instance admins: disable accounts, unlink characters, invites. */
  adminIdentity: {
    /** Every linked EVE character with its account. */
    characters: route({
      method: 'GET',
      path: '/api/admin/characters',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: z.array(dto.AdminCharacterDto),
    }),
    /** Takes a character off its account (its owner can link it again). */
    unlinkCharacter: route({
      method: 'DELETE',
      path: '/api/admin/characters/:characterId',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
    /** Disables or enables an account: no sign-in, sessions, keys or map roles while disabled. */
    setDisabled: route({
      method: 'PUT',
      path: '/api/admin/accounts/:accountId/disabled',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.SetAccountDisabledRequest,
      response: dto.AdminAccountDto,
    }),
    invites: route({
      method: 'GET',
      path: '/api/admin/invites',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: z.array(dto.InviteDto),
    }),
    /** A new invite link (shown once) for restricted sign-up. */
    createInvite: route({
      method: 'POST',
      path: '/api/admin/invites',
      auth: 'admin',
      scope: 'session',
      body: dto.CreateInviteRequest,
      response: dto.CreatedInviteDto,
    }),
    revokeInvite: route({
      method: 'DELETE',
      path: '/api/admin/invites/:inviteId',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
  },

  /** The map's characters page (managers): every tracked character by person; untrack any. */
  mapCharacters: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/tracking/characters',
      auth: 'account',
      scope: { resource: 'tracking', action: 'read' },
      mapRole: 'manager',
      response: z.array(dto.MapTrackedCharacterDto),
    }),
    untrack: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/tracking/characters/:characterId',
      auth: 'account',
      scope: { resource: 'tracking', action: 'write' },
      mapRole: 'manager',
    }),
  },

  /** Integration helpers: batches, connections by their systems, events since a seq, SSE. */
  mapApi: {
    /** Systems and connections added or changed in one transaction (all or nothing). */
    batchUpsert: route({
      method: 'POST',
      path: '/api/maps/:mapId/batch',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      status: 200,
      body: dto.BatchUpsertRequest,
      response: dto.BatchUpsertResultDto,
    }),
    /** Connections removed and systems taken off in one transaction. */
    batchDelete: route({
      method: 'POST',
      path: '/api/maps/:mapId/batch/delete',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      status: 200,
      body: dto.BatchDeleteRequest,
      response: dto.BatchDeleteResultDto,
    }),
    /** The connection between two systems (either direction). */
    connectionByPair: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/between/:source/:target',
      auth: 'account',
      scope: { resource: 'connections', action: 'read' },
      mapRole: 'viewer',
      response: dto.ConnectionDto,
    }),
    updateConnectionByPair: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/connections/between/:source/:target',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
      body: dto.UpdateConnectionRequest,
      response: dto.ConnectionDto,
    }),
    removeConnectionByPair: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/connections/between/:source/:target',
      auth: 'account',
      scope: { resource: 'connections', action: 'write' },
      mapRole: 'member',
    }),
    /** The map's events after a seq, from the durable log (what the WebSocket and webhooks carry). */
    events: route({
      method: 'GET',
      path: '/api/maps/:mapId/events',
      auth: 'account',
      scope: { resource: '*', action: 'read' },
      mapRole: 'viewer',
      query: dto.EventsQuery,
      response: dto.EventsPageDto,
    }),
    /**
     * Server-Sent Events of a stream (`map:<id>`): `event: <type>`, `id: <seq>`, `data: <event>`;
     * `snapshot`, `subscribed` and `error` frames as on the WebSocket; a comment every 25 s.
     */
    sse: route({
      method: 'GET',
      path: '/api/streams/:stream/sse',
      auth: 'public',
      scope: { resource: '*', action: 'read' },
      query: dto.SseQuery,
      contentType: 'text/event-stream',
    }),
  },

  /**
   * Every map of the instance, for instance admins: who owns it, how big it is, deleted maps to
   * restore or purge. Never what is on a map: being instance admin grants no map role.
   */
  adminMaps: {
    list: route({
      method: 'GET',
      path: '/api/admin/maps',
      auth: 'admin',
      scope: { resource: 'admin', action: 'read' },
      response: z.array(dto.AdminMapDto),
    }),
    transferOwner: route({
      method: 'PUT',
      path: '/api/admin/maps/:mapId/owner',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      body: dto.TransferMapOwnerRequest,
      response: dto.MapDto,
    }),
    /** Deletes a map softly, as its admins would. */
    trash: route({
      method: 'POST',
      path: '/api/admin/maps/:mapId/trash',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
    restore: route({
      method: 'POST',
      path: '/api/admin/maps/:mapId/restore',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
      status: 200,
      response: dto.MapDto,
    }),
    /** Removes a deleted map for good, with everything on it (rules, shares, webhooks follow). */
    purge: route({
      method: 'DELETE',
      path: '/api/admin/maps/:mapId',
      auth: 'admin',
      scope: { resource: 'admin', action: 'write' },
    }),
  },

  intel: {
    /** Sovereignty and kills of the last hour of every system on the map. */
    map: route({
      method: 'GET',
      path: '/api/maps/:mapId/intel',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      response: dto.MapIntelDto,
    }),
    /** One system on the map: hourly figures, recent killmails and who is active there. */
    system: route({
      method: 'GET',
      path: '/api/maps/:mapId/intel/systems/:solarSystemId',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      response: dto.SystemActivityDto,
    }),
    /** Killmails of the map's visible systems (or some of them), newest first. */
    kills: route({
      method: 'GET',
      path: '/api/maps/:mapId/kills',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      query: dto.MapKillsQuery,
      response: dto.MapKillsDto,
    }),
    /** The signed-in account's standings (contacts of its characters). */
    standings: route({
      method: 'GET',
      path: '/api/accounts/me/standings',
      auth: 'account',
      scope: { resource: 'account', action: 'read' },
      response: dto.StandingsDto,
    }),
    /** Sets the account's standing towards an alliance or corporation by hand (null: from contacts). */
    setStanding: route({
      method: 'PUT',
      path: '/api/accounts/me/standings/:entityId',
      auth: 'account',
      scope: { resource: 'account', action: 'write' },
      body: dto.SetStandingRequest,
      response: dto.StandingsDto,
    }),
    /** Sovereignty and kills of the last hour of the systems a public link shows (public data). */
    publicMap: route({
      method: 'GET',
      path: '/api/public/maps/:token/intel',
      auth: 'public',
      scope: 'none',
      summary: 'Sovereignty and kills of the last hour of the systems a public map shows',
      response: dto.MapIntelDto,
    }),
  },
  undo: {
    /**
     * Undoes one gesture of the caller on the map (every change made with its `x-darkbeacon-action`
     * header), newest first, each through the history's revert. Changes that changed again since
     * stay and are listed; 409 when none could be undone.
     */
    action: route({
      method: 'POST',
      path: '/api/maps/:mapId/history/undo',
      auth: 'account',
      scope: { resource: 'audit', action: 'write' },
      status: 200,
      mapRole: 'member',
      body: dto.UndoActionRequest,
      response: dto.UndoResultDto,
      summary: 'Undo one gesture of the caller (all changes made with one action id)',
    }),
  },

  /** Rally pings: one system of the map everyone is called to (Wanderer's rally points). */
  pings: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/pings',
      auth: 'account',
      scope: { resource: 'systems', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.MapPingDto),
    }),
    /** Calls a rally on a system; it replaces the map's ping before it (`ping.created`). */
    create: route({
      method: 'POST',
      path: '/api/maps/:mapId/pings',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      body: dto.CreatePingRequest,
      response: dto.MapPingDto,
    }),
    /** Cancels a ping (`ping.removed`). */
    remove: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/pings/:pingId',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
    }),
  },

  /** Copy and paste of systems between maps, keeping their attributes. */
  clipboard: {
    /**
     * Places copied systems (a `darkbeacon/systems` clipboard) with their status, names, notes,
     * Labels and Tags (by name) and connects them with their flags, in one transaction. Who may
     * paste is the map's `settings.clipboard.paste` (members by default).
     */
    paste: route({
      method: 'POST',
      path: '/api/maps/:mapId/paste',
      auth: 'account',
      scope: { resource: 'systems', action: 'write' },
      mapRole: 'member',
      status: 200,
      body: dto.PasteSystemsRequest,
      response: dto.PasteSystemsResultDto,
    }),
    /** Who may copy systems off the map and paste onto it (manager+). */
    setRoles: route({
      method: 'PUT',
      path: '/api/maps/:mapId/clipboard-roles',
      auth: 'account',
      scope: { resource: 'maps', action: 'write' },
      mapRole: 'manager',
      body: dto.ClipboardRolesRequest,
      response: dto.MapDto,
    }),
  },

  /** The other maps a system is on (Wanderer's "Also on <map>"), for a read-only preview. */
  linkedMaps: {
    elsewhere: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/elsewhere',
      auth: 'account',
      scope: { resource: 'maps', action: 'read' },
      mapRole: 'viewer',
      response: z.array(dto.LinkedMapDto),
    }),
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
