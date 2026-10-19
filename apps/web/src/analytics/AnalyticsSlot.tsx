import { connection } from 'next/server';
import { AnalyticsClient } from './AnalyticsClient';
import { gaMeasurementId } from './ga';

/**
 * The `GA_MEASUREMENT_ID` opt-in, read per request (a dynamic hole in the prerendered root
 * layout, like PwaSlot), so the shared image needs no rebuild. Unset: nothing is rendered and no
 * Google code reaches the browser.
 */
export async function AnalyticsSlot() {
  await connection();
  const id = gaMeasurementId(process.env);
  return id ? <AnalyticsClient id={id} /> : null;
}
