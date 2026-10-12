import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);

/** Runs in a worker thread with a connection of its own; plain CommonJS for `eval`. */
const SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const Database = require(workerData.driver);
const db = new Database(workerData.filename);
db.pragma('busy_timeout = 1000');
const timer = setInterval(() => {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (error) {
    parentPort.postMessage(String(error));
  }
}, workerData.intervalMs);
parentPort.on('message', (message) => {
  if (message !== 'stop') return;
  clearInterval(timer);
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}
  db.close();
  parentPort.postMessage('stopped');
});
`;

/**
 * Copies the WAL back into the database file on a thread of its own. SQLite otherwise does it
 * inside the commit that crosses `wal_autocheckpoint` pages, and better-sqlite3 runs commits on
 * the event loop: under write load every such commit stopped the server for up to half a second.
 * PASSIVE never waits for readers or blocks the writer; what it cannot copy yet it copies on a
 * later round.
 */
export class WalCheckpointer {
  private readonly worker: Worker;

  constructor(filename: string, intervalMs = 1_000, onError: (message: string) => void = () => {}) {
    this.worker = new Worker(SCRIPT, {
      eval: true,
      workerData: { filename, intervalMs, driver: require.resolve('better-sqlite3') },
    });
    this.worker.on('message', (message: string) => {
      if (message !== 'stopped') onError(message);
    });
    this.worker.on('error', (error) => onError(String(error)));
    this.worker.unref();
  }

  async stop(): Promise<void> {
    const stopped = new Promise<void>((resolve) => {
      this.worker.once('message', () => resolve());
      this.worker.once('exit', () => resolve());
    });
    this.worker.postMessage('stop');
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    await this.worker.terminate();
  }
}
