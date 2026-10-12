import { z } from 'zod';
import { EveId, Id } from './common.js';
import { Slug } from './mapping.js';

/** Another map a system is on, that the viewer may open; `home` is that map's home system. */
export const LinkedMapDto = z.object({
  mapId: Id,
  slug: Slug,
  name: z.string(),
  home: EveId.nullable(),
});
export type LinkedMapDto = z.infer<typeof LinkedMapDto>;
