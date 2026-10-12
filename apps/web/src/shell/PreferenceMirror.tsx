'use client';

import { usePreferenceMirror } from '../lib/preferences';

/** Keeps this browser's map options and my preferences on the server in step (see lib/preferences). */
export function PreferenceMirror() {
  usePreferenceMirror(true);
  return null;
}
