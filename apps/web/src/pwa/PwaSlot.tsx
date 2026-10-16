import { connection } from 'next/server';
import { pwaEnabled } from './config';
import { PwaClient } from './PwaClient';

/**
 * The `PWA` switch, read per request (a dynamic hole in the prerendered root layout, so it needs
 * no rebuild), handed to the client part.
 */
export async function PwaSlot() {
  await connection();
  return <PwaClient enabled={pwaEnabled(process.env)} />;
}
