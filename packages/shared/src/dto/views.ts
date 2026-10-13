import { z } from 'zod';
import { Id, Timestamp } from './common.js';

/*
 * Saved views of the map screen: a named preset of the widget windows (the web app's
 * `WidgetsLayout`) and the canvas options that change what the screen looks like (minimap,
 * background, the rally card's corner). A person keeps their own in their preferences; map
 * managers publish the map's own, which every member gets and which fill the quick slots 1, 2, 3.
 * The format is versioned: readers take the versions they know and refuse the rest.
 */

/** The version of a saved view; a reader refuses a newer one. */
export const VIEW_FORMAT_VERSION = 1;
/** The widget layout version a view holds (the web app's `LAYOUT_VERSION`). */
export const VIEW_LAYOUT_VERSION = 2;
/** Quick slots in the map's top bar (Alt+1, Alt+2, Alt+3). */
export const VIEW_SLOTS = [1, 2, 3] as const;
export type ViewSlot = (typeof VIEW_SLOTS)[number];
/** Most views a map publishes. */
export const MAP_VIEWS_MAX = 12;
/** Longest view name. */
export const VIEW_NAME_MAX = 32;

const WidgetId = z.string().min(1).max(200);
const Finite = z.number().finite();

const ViewBox = z.object({
  x: Finite,
  y: Finite,
  w: Finite,
  h: Finite,
  right: z.literal(true).optional(),
  bottom: z.literal(true).optional(),
  /** Resized by hand: it keeps this height and its content scrolls. */
  fixed: z.literal(true).optional(),
  /** Snapped under this window: it moves with it. */
  below: WidgetId.optional(),
});

/** The widget windows: which show, which float where, their order, heights and the column's width. */
export const ViewLayoutDto = z.object({
  version: z.literal(VIEW_LAYOUT_VERSION),
  visible: z.array(WidgetId).max(64).nullable(),
  boxes: z.record(WidgetId, ViewBox),
  order: z.array(WidgetId).max(64),
  caps: z.record(WidgetId, Finite).optional(),
  dockWidth: Finite.optional(),
});
export type ViewLayoutDto = z.infer<typeof ViewLayoutDto>;

const Corner = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

/** Canvas options a view sets; one it leaves out stays as the viewer has it. */
export const ViewCanvasDto = z.object({
  minimap: z.union([Corner, z.literal('off')]).optional(),
  pings: Corner.optional(),
  background: z.enum(['dots', 'lines', 'none']).optional(),
  softBackground: z.boolean().optional(),
});
export type ViewCanvasDto = z.infer<typeof ViewCanvasDto>;

/** What a view puts on the screen. */
export const ViewPresetDto = z.object({
  version: z.literal(VIEW_FORMAT_VERSION),
  layout: ViewLayoutDto,
  canvas: ViewCanvasDto,
});
export type ViewPresetDto = z.infer<typeof ViewPresetDto>;

const ViewName = z.string().trim().min(1).max(VIEW_NAME_MAX);
const Slot = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/**
 * One of the map's views (`MapDto.views`), published by a manager. `slot` pins it to a quick slot
 * for everyone on the map (one view per slot); members may pin something else for themselves.
 */
export const MapViewDto = z.object({
  id: Id.max(40),
  name: ViewName,
  slot: Slot.optional(),
  view: ViewPresetDto,
  /** When it was last published or changed. */
  updatedAt: Timestamp,
});
export type MapViewDto = z.infer<typeof MapViewDto>;

/** PUT /api/maps/:mapId/views replaces the map's views (manager+). */
export const SetMapViewsRequest = z.object({ views: z.array(MapViewDto).max(MAP_VIEWS_MAX) });
export type SetMapViewsRequest = z.infer<typeof SetMapViewsRequest>;
