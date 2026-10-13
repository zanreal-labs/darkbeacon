import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);

/**
 * Runs in a worker thread; plain CommonJS for `eval`. `state` is shared with the owner:
 * [0] paused, [1] busy. Each round opens the file, checkpoints and closes it again, so no
 * connection is left open while the owner swaps files (a restore).
 */
const SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const Database = require(workerData.driver);
const state = new Int32Array(workerData.state);
setInterval(() => {
  if (Atomics.load(state, 0) === 1) return;
  Atomics.store(state, 1, 1);
  try {
    if (Atomics.load(state, 0) === 1) return;
    const db = new Database(workerData.filename, { fileMustExist: true });
    try {
      db.pragma('busy_timeout = 1000');
      db.pragma('wal_checkpoint(PASSIVE)');
    } finally {
      db.close();
    }
  } catch (error) {
    parentPort.postMessage(String(error));
  } finally {
    Atomics.store(state, 1, 0);
    Atomics.notify(state, 1);
  }
}, workerData.intervalMs);
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
  private readonly state = new Int32Array(new SharedArrayBuffer(8));

  constructor(filename: string, intervalMs = 1_000, onError: (message: string) => void = () => {}) {
    this.worker = new Worker(SCRIPT, {
      eval: true,
      workerData: {
        filename,
        intervalMs,
        driver: require.resolve('better-sqlite3'),
        state: this.state.buffer,
      },
    });
    this.worker.on('message', (message: string) => onError(message));
    this.worker.on('error', (error) => onError(String(error)));
    this.worker.unref();
  }

  /** Stops checkpointing and waits (synchronously) for a round in progress to finish. */
  pause(): void {
    Atomics.store(this.state, 0, 1);
    while (Atomics.load(this.state, 1) === 1) Atomics.wait(this.state, 1, 1, 100);
  }

  resume(): void {
    Atomics.store(this.state, 0, 0);
  }

  async stop(): Promise<void> {
    this.pause();
    await this.worker.terminate();
  }
}

/** Runs in a worker thread: one consistent copy of the database, then the thread ends. */
const COPY_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const Database = require(workerData.driver);
const db = new Database(workerData.filename, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');
// One step: the copy reads a single snapshot, so writes meanwhile never restart it.
db.backup(workerData.destination, { progress: () => 0x7fffffff })
  .then(() => parentPort.postMessage({ ok: true }))
  .catch((error) => parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }))
  .finally(() => db.close());
`;

/**
 * Copies the database into `destination` (a new file) on a thread of its own, through a read-only
 * connection: SQLite's online backup in one step reads one WAL snapshot, so the copy is the
 * database between two transactions, while the server goes on reading and writing. (Run on the
 * server's own connection it had to hold every connection for the whole copy, stepping between
 * turns of a busy event loop; under load that took minutes.)
 */
export function copyInWorker(filename: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(COPY_SCRIPT, {
      eval: true,
      workerData: { filename, destination, driver: require.resolve('better-sqlite3') },
    });
    let settled = false;
    worker.once('message', (message: { ok: boolean; error?: string }) => {
      settled = true;
      if (message.ok) resolve();
      else reject(new Error(message.error ?? 'copy failed'));
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`copy worker exited with ${code}`));
    });
  });
}
