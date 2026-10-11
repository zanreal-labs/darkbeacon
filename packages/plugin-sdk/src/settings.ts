import { z } from 'zod';

export type SettingsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: Array<{ path: string; message: string }> };

export type SettingsValidator = (values: unknown) => SettingsResult;

/**
 * Builds a validator from a plugin's settings JSON Schema (the object at the root). Defaults
 * declared in the schema are applied. Throws when the schema itself is not usable.
 */
export function settingsValidator(schema: unknown): SettingsValidator {
  if (typeof schema !== 'object' || schema === null || (schema as { type?: unknown }).type !== 'object') {
    throw new Error('settings schema must be a JSON Schema with type "object"');
  }
  const parser = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  return (values) => {
    const parsed = parser.safeParse(values ?? {});
    if (parsed.success) return { ok: true, value: parsed.data as Record<string, unknown> };
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  };
}
