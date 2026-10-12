import { z } from 'zod';
import * as dto from './dto/index.js';
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
}

const route = <const R extends RouteDef>(r: R): R => r;

/**
 * Every REST endpoint of the MVP. Server controllers implement these paths; the web app
 * calls them through `buildPath`. Changing a route here is a contract change.
 */
export const routes = {
  health: route({ method: 'GET', path: '/api/health', auth: 'public', response: dto.HealthDto }),
  /** Readiness: the database answers and every migration is applied (503 otherwise). */
  ready: route({ method: 'GET', path: '/api/ready', auth: 'public', response: dto.ReadyDto }),

  realtime: {
    /**
     * Snapshot of a stream (`map:<id>`, `instance`) for whoever may follow it over /ws. Streams the
     * caller cannot follow answer 404 (signed in) or 401 (anonymous).
     */
    snapshot: route({
      method: 'GET',
      path: '/api/streams/:stream/snapshot',
      auth: 'public',
      response: dto.StreamSnapshotDto,
    }),
  },

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
    /**
     * Connects a Discord user to the signed-in account (EVE sign-in instances), so Discord roles
     * and the account's Discord name come along. Returns to `returnTo`.
     */
    discordConnect: route({
      method: 'GET',
      path: '/api/auth/discord/connect',
      auth: 'account',
      redirect: true,
    }),
    /**
     * Signs in with an EVE character (instances whose login method is `eve`). A linked character
     * opens its account; an unknown one creates a new account (see docs/decisions.md).
     */
    eveSignIn: route({ method: 'GET', path: '/api/auth/eve/signin', auth: 'public', redirect: true }),
    /** Links an EVE character to the signed-in account (EVE SSO v2, PKCE). */
    eveLogin: route({ method: 'GET', path: '/api/auth/eve/login', auth: 'account', redirect: true }),
    eveCallback: route({ method: 'GET', path: '/api/auth/eve/callback', auth: 'account', redirect: true }),
    /** Demo mode: signs in as the demo account (seeding the demo map once). */
    demo: route({ method: 'POST', path: '/api/auth/demo', auth: 'public', response: dto.MeDto }),
    /** Demo mode: signs in a named local account (scripts and tests). */
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
    setMainCharacter: route({
      method: 'PUT',
      path: '/api/accounts/me/main-character',
      auth: 'account',
      body: dto.SetMainCharacterRequest,
      response: dto.MeDto,
    }),
    unlinkCharacter: route({
      method: 'DELETE',
      path: '/api/accounts/me/characters/:characterId',
      auth: 'account',
    }),
    setDefaultMap: route({
      method: 'PUT',
      path: '/api/accounts/me/default-map',
      auth: 'account',
      body: dto.SetDefaultMapRequest,
      response: dto.MeDto,
    }),
    /** Remembers the map the account opened (the map page calls it). */
    recordMapOpened: route({
      method: 'PUT',
      path: '/api/accounts/me/recent-map',
      auth: 'account',
      body: dto.RecordMapOpenedRequest,
    }),
    /** Where `/` goes: account default, instance default, last opened, the only map. */
    landing: route({
      method: 'GET',
      path: '/api/accounts/me/landing',
      auth: 'account',
      response: dto.LandingDto,
    }),
    sessions: route({
      method: 'GET',
      path: '/api/accounts/me/sessions',
      auth: 'account',
      response: z.array(dto.SessionDto),
    }),
    revokeSession: route({
      method: 'DELETE',
      path: '/api/accounts/me/sessions/:sessionId',
      auth: 'account',
    }),
    /** Disconnects the account's Discord user (EVE sign-in instances only). */
    disconnectDiscord: route({ method: 'DELETE', path: '/api/accounts/me/discord', auth: 'account' }),
    /** Accounts by name, for map admins (people who are admin of a map, or instance admins). */
    search: route({
      method: 'GET',
      path: '/api/accounts/search',
      auth: 'account',
      query: dto.AccountSearchQuery,
      response: z.array(dto.AccountSummaryDto),
    }),
  },

  instance: {
    info: route({ method: 'GET', path: '/api/instance', auth: 'account', response: dto.InstanceInfoDto }),
  },

  eve: {
    /** ESI search through one of the caller's characters, or exact names (POST /universe/ids). */
    search: route({
      method: 'GET',
      path: '/api/eve/search',
      auth: 'account',
      query: dto.EveSearchQuery,
      response: dto.EveSearchResultDto,
    }),
    entities: route({
      method: 'GET',
      path: '/api/eve/entities',
      auth: 'account',
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
      response: z.array(dto.DiscordGuildDto),
    }),
    roles: route({
      method: 'GET',
      path: '/api/discord/guilds/:guildId/roles',
      auth: 'account',
      response: z.array(dto.DiscordRoleDto),
    }),
    channels: route({
      method: 'GET',
      path: '/api/discord/guilds/:guildId/channels',
      auth: 'account',
      response: z.array(dto.DiscordChannelDto),
    }),
  },

  /** Served by the bundled `discord-notify` plugin (map admins). */
  discordNotify: {
    get: route({
      method: 'GET',
      path: '/api/plugins/discord-notify/maps/:mapId',
      auth: 'account',
      mapRole: 'admin',
      response: dto.DiscordNotifyStateDto,
    }),
    update: route({
      method: 'PUT',
      path: '/api/plugins/discord-notify/maps/:mapId',
      auth: 'account',
      mapRole: 'admin',
      body: dto.UpdateDiscordNotifyRequest,
      response: dto.DiscordNotifyStateDto,
    }),
    test: route({
      method: 'POST',
      path: '/api/plugins/discord-notify/maps/:mapId/test',
      auth: 'account',
      mapRole: 'admin',
      response: dto.DiscordNotifyTestDto,
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
    settings: route({
      method: 'GET',
      path: '/api/admin/settings',
      auth: 'admin',
      response: dto.InstanceSettingsDto,
    }),
    updateSettings: route({
      method: 'PATCH',
      path: '/api/admin/settings',
      auth: 'admin',
      body: dto.UpdateInstanceSettingsRequest,
      response: dto.InstanceSettingsDto,
    }),
    discordBot: route({
      method: 'GET',
      path: '/api/admin/discord-bot',
      auth: 'admin',
      response: dto.DiscordBotDto,
    }),
    /** Connects the bot: the token is checked with Discord, then stored encrypted and never shown. */
    setDiscordBot: route({
      method: 'PUT',
      path: '/api/admin/discord-bot',
      auth: 'admin',
      body: dto.SetDiscordBotRequest,
      response: dto.DiscordBotDto,
    }),
    removeDiscordBot: route({ method: 'DELETE', path: '/api/admin/discord-bot', auth: 'admin' }),
    /** What the instance exports for monitoring (OpenTelemetry); set through the environment only. */
    observability: route({
      method: 'GET',
      path: '/api/admin/observability',
      auth: 'admin',
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
      response: dto.BackupStatusDto,
    }),
    create: route({ method: 'POST', path: '/api/admin/backups', auth: 'admin', response: dto.BackupDto }),
    updateSettings: route({
      method: 'PATCH',
      path: '/api/admin/backups/settings',
      auth: 'admin',
      body: dto.UpdateBackupSettingsRequest,
      response: dto.BackupSettingsDto,
    }),
    /** Streams the `.db.gz` file as an attachment. */
    download: route({ method: 'GET', path: '/api/admin/backups/:name/download', auth: 'admin' }),
    remove: route({ method: 'DELETE', path: '/api/admin/backups/:name', auth: 'admin' }),
    restore: route({
      method: 'POST',
      path: '/api/admin/backups/:name/restore',
      auth: 'admin',
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
      response: dto.RestoreResultDto,
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
    /** Several systems at once (unknown ids are left out), e.g. every system on a map. */
    lookup: route({
      method: 'GET',
      path: '/api/universe/lookup',
      auth: 'account',
      query: dto.UniverseLookupQuery,
      response: z.array(dto.UniverseSystemDto),
    }),
    /** Published ships by name with what changes their jump mass (SDE). */
    searchShips: route({
      method: 'GET',
      path: '/api/universe/ships',
      auth: 'account',
      query: dto.ShipSearchQuery,
      response: z.array(dto.ShipTypeDto),
    }),
    /** What prop modules, Higgs Anchors and the mass entangler do, and ships people roll with. */
    shipCatalog: route({
      method: 'GET',
      path: '/api/universe/ships/catalog',
      auth: 'account',
      response: dto.ShipCatalogDto,
    }),
    getShip: route({
      method: 'GET',
      path: '/api/universe/ships/:shipTypeId',
      auth: 'account',
      response: dto.ShipTypeDto,
    }),
    /** Every wormhole type with its SDE attributes, and the hull classes "fits" refers to. */
    wormholes: route({
      method: 'GET',
      path: '/api/universe/wormholes',
      auth: 'account',
      response: dto.WormholeCatalogDto,
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
    /** The map's default bookmark label template (manager+); published as `map.settings_changed`. */
    setBookmarkTemplate: route({
      method: 'PUT',
      path: '/api/maps/:mapId/bookmark-template',
      auth: 'account',
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
      mapRole: 'manager',
      body: dto.SetBookmarkNumberingRequest,
      response: dto.MapDto,
    }),
    /** Numbers wormholes 1, 2, 3 again in the map's order; changes arrive as `connection.updated`. */
    renumberBookmarks: route({
      method: 'POST',
      path: '/api/maps/:mapId/bookmark-numbers/renumber',
      auth: 'account',
      mapRole: 'member',
      body: dto.RenumberBookmarksRequest,
    }),
    /** The caller's own view of the map: last viewport and bookmark template override. */
    getPreferences: route({
      method: 'GET',
      path: '/api/maps/:mapId/preferences',
      auth: 'account',
      mapRole: 'viewer',
      response: dto.MapPreferencesDto,
    }),
    updatePreferences: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/preferences',
      auth: 'account',
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
    /** A wormhole's `{n}` set by hand; the sibling that had the number swaps with it. */
    setBookmarkNumber: route({
      method: 'PUT',
      path: '/api/maps/:mapId/connections/:connectionId/bookmark-number',
      auth: 'account',
      mapRole: 'member',
      body: dto.SetBookmarkNumberRequest,
      response: dto.ConnectionDto,
    }),
    /** The connections panel: every visible connection with type, mass and time estimates, most urgent first. */
    intel: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/intel',
      auth: 'account',
      mapRole: 'viewer',
      response: z.array(dto.ConnectionIntelDto),
    }),
    /** One connection with its type, mass and time estimates (the sidebar's Connection section). */
    intelOne: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/:connectionId/intel',
      auth: 'account',
      mapRole: 'viewer',
      response: dto.ConnectionIntelDto,
    }),
    /** Ships recorded going through a connection, newest first. */
    passages: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/:connectionId/passages',
      auth: 'account',
      mapRole: 'viewer',
      response: z.array(dto.PassageDto),
    }),
    /** "Log a jump" for pilots nobody tracks; on a merged map it goes to the map that takes new objects. */
    logPassages: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections/:connectionId/passages',
      auth: 'account',
      mapRole: 'member',
      body: dto.LogPassagesRequest,
      response: z.array(dto.PassageDto),
    }),
    /** Passages count from now on, against the mass status as it is (earlier ones stay in the log). */
    resetPassages: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections/:connectionId/passages/reset',
      auth: 'account',
      mapRole: 'member',
    }),
    /** How a passage's mass counts (cold, hot, custom), its modules and note. */
    updatePassage: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/connections/:connectionId/passages/:passageId',
      auth: 'account',
      mapRole: 'member',
      body: dto.UpdatePassageRequest,
      response: dto.PassageDto,
    }),
    removePassage: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/connections/:connectionId/passages/:passageId',
      auth: 'account',
      mapRole: 'member',
    }),
    /** A rolling plan for the connection with the crew's ships. */
    rollPlan: route({
      method: 'POST',
      path: '/api/maps/:mapId/connections/:connectionId/roll-plan',
      auth: 'account',
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
      mapRole: 'viewer',
      query: dto.RouteQuery,
      response: dto.RouteDto,
    }),
    /** Ways out of the chain with the nearest hub and jumps. */
    exits: route({
      method: 'GET',
      path: '/api/maps/:mapId/exits',
      auth: 'account',
      mapRole: 'viewer',
      query: dto.ExitsQuery,
      response: dto.MapExitsDto,
    }),
    hubs: route({
      method: 'GET',
      path: '/api/maps/:mapId/hubs',
      auth: 'account',
      mapRole: 'viewer',
      response: dto.HubsDto,
    }),
    setMapHubs: route({
      method: 'PUT',
      path: '/api/maps/:mapId/hubs',
      auth: 'account',
      mapRole: 'manager',
      body: dto.SetHubsRequest,
      response: z.array(dto.HubDto),
    }),
    /** Jumps from one system to every hub of the viewer, nearest first. */
    hubDistances: route({
      method: 'GET',
      path: '/api/maps/:mapId/hubs/distances',
      auth: 'account',
      mapRole: 'viewer',
      query: dto.HubDistancesQuery,
      response: z.array(dto.HubDistanceDto),
    }),
    personalHubs: route({
      method: 'GET',
      path: '/api/accounts/me/hubs',
      auth: 'account',
      response: z.array(dto.HubDto),
    }),
    setPersonalHubs: route({
      method: 'PUT',
      path: '/api/accounts/me/hubs',
      auth: 'account',
      body: dto.SetHubsRequest,
      response: z.array(dto.HubDto),
    }),
    /** Sets the in-game destination or adds a waypoint (ESI, `esi-ui.write_waypoint.v1`). */
    waypoint: route({
      method: 'POST',
      path: '/api/accounts/me/characters/:characterId/waypoint',
      auth: 'account',
      body: dto.WaypointRequest,
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

  /** Shares between maps: a source map's admins offer, the target map's admins accept. */
  sharing: {
    list: route({
      method: 'GET',
      path: '/api/maps/:mapId/shares',
      auth: 'account',
      mapRole: 'admin',
      response: dto.MapSharesDto,
    }),
    offer: route({
      method: 'POST',
      path: '/api/maps/:mapId/shares',
      auth: 'account',
      mapRole: 'admin',
      body: dto.OfferShareRequest,
      response: dto.MapShareDto,
    }),
    update: route({
      method: 'PATCH',
      path: '/api/maps/:mapId/shares/:shareId',
      auth: 'account',
      mapRole: 'admin',
      body: dto.UpdateShareRequest,
      response: dto.MapShareDto,
    }),
    accept: route({
      method: 'POST',
      path: '/api/maps/:mapId/shares/:shareId/accept',
      auth: 'account',
      mapRole: 'admin',
      body: dto.AcceptShareRequest,
      response: dto.MapShareDto,
    }),
    /** Revokes a share or declines an offer (either side's admins). */
    revoke: route({
      method: 'DELETE',
      path: '/api/maps/:mapId/shares/:shareId',
      auth: 'account',
      mapRole: 'admin',
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

  /**
   * History of changes (the event log with its audit records). Map histories are open to map
   * viewers; the request origin is shown to map admins only. Newest first, paged with `before`.
   */
  audit: {
    mapHistory: route({
      method: 'GET',
      path: '/api/maps/:mapId/history',
      auth: 'account',
      mapRole: 'viewer',
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    /** The system, its signatures and the connections touching it. */
    systemHistory: route({
      method: 'GET',
      path: '/api/maps/:mapId/systems/:solarSystemId/history',
      auth: 'account',
      mapRole: 'viewer',
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    connectionHistory: route({
      method: 'GET',
      path: '/api/maps/:mapId/connections/:connectionId/history',
      auth: 'account',
      mapRole: 'viewer',
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    /** `format=csv|json`; a file download (`content-disposition: attachment`). */
    mapExport: route({
      method: 'GET',
      path: '/api/maps/:mapId/history/export',
      auth: 'account',
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
      query: dto.AuditQuery,
      response: dto.AuditPageDto,
    }),
    instanceExport: route({
      method: 'GET',
      path: '/api/admin/audit/export',
      auth: 'admin',
      query: dto.AuditExportQuery,
    }),
    /** Checks the hash chain of every stream (or `?stream=`). */
    verify: route({
      method: 'POST',
      path: '/api/admin/audit/verify',
      auth: 'admin',
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
      body: telemetry.TelemetryIngestRequest,
      response: telemetry.TelemetryIngestResultDto,
    }),
    /** Status, instance id, the last payloads sent and the heartbeat as it would be sent now. */
    status: route({
      method: 'GET',
      path: '/api/admin/telemetry',
      auth: 'admin',
      response: telemetry.TelemetryStatusDto,
    }),
    /** The admin switch; recorded on the instance audit as `telemetry.changed`. */
    setEnabled: route({
      method: 'PUT',
      path: '/api/admin/telemetry/enabled',
      auth: 'admin',
      body: telemetry.SetTelemetryEnabledRequest,
      response: telemetry.TelemetryStatusDto,
    }),
    /** The admin has read the notice about telemetry; it is not shown to them again. */
    dismissNotice: route({ method: 'POST', path: '/api/admin/telemetry/notice', auth: 'admin' }),
  },

  presence: {
    settings: route({
      method: 'GET',
      path: '/api/accounts/me/presence',
      auth: 'account',
      response: dto.PresenceSettingsDto,
    }),
    updateSettings: route({
      method: 'PUT',
      path: '/api/accounts/me/presence',
      auth: 'account',
      body: dto.UpdatePresenceSettingsRequest,
      response: dto.PresenceSettingsDto,
    }),
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
