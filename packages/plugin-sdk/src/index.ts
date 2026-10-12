export * from './context.js';
export * from './manifest.js';
export * from './settings.js';
export * from './web.js';
// Event and DTO types, so plugins depend on the SDK alone.
export type { DomainEvent } from '@darkbeacon/core';
export type {
  ConnectionDto,
  DiscordMention,
  DiscordNotifyKind,
  DiscordNotifySettings,
  DiscordNotifyStateDto,
  DiscordNotifyTargetDto,
  DiscordNotifyTargetInput,
  DiscordNotifyTestDto,
  PingDto,
  QuietHours,
  UpdateDiscordNotifyRequest,
  EventPayloads,
  EventType,
  KillmailDto,
  MapDto,
  MapSystemDto,
  SignatureDto,
  TypedEvent,
  UniverseSystemDto,
  WayHomeDto,
} from '@darkbeacon/shared';
