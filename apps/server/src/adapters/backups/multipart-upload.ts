import { createWriteStream } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Busboy } from '@fastify/busboy';
import { ValidationError } from '@darkbeacon/core';
import type { LocalFile } from '@darkbeacon/backups';
import { scratchFile } from './files.js';

export interface ReceivedUpload {
  file: LocalFile;
  /** Other fields of the form (`confirm`). */
  fields: Record<string, string>;
}

/**
 * Streams the one `file` part of a multipart/form-data request to a scratch file, refusing
 * anything above `maxBytes`. Nothing is held in memory.
 */
export function receiveUpload(
  request: IncomingMessage,
  dir: string,
  maxBytes: number,
): Promise<ReceivedUpload> {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return Promise.reject(new ValidationError('Send the backup as multipart/form-data with a "file" field'));
  }
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > maxBytes + 64 * 1024) {
    request.resume();
    return Promise.reject(tooLarge(maxBytes));
  }
  const target = scratchFile(dir, 'upload', '.upload');
  const fields: Record<string, string> = {};
  return new Promise<ReceivedUpload>((resolve, reject) => {
    let saving: Promise<void> | null = null;
    let failure: Error | null = null;
    let settled = false;
    const fail = (error: Error) => {
      failure ??= error;
    };
    const busboy = Busboy({
      headers: { ...request.headers, 'content-type': contentType },
      limits: { files: 1, fields: 10, fieldSize: 1024, fileSize: maxBytes },
    });
    busboy.on('field', (name, value) => {
      fields[name] = value;
    });
    busboy.on('file', (name, stream) => {
      if (name !== 'file' || saving) {
        stream.resume();
        return;
      }
      stream.on('limit', () => fail(tooLarge(maxBytes)));
      saving = pipeline(stream, createWriteStream(target.path)).catch((error: unknown) =>
        fail(error instanceof Error ? error : new Error(String(error))),
      );
    });
    busboy.on('error', (error) => {
      if (settled) return;
      settled = true;
      request.unpipe(busboy);
      request.resume();
      void target.dispose();
      reject(
        new ValidationError(
          `The upload is not a valid form: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    busboy.on('finish', () => {
      void (async () => {
        await saving;
        if (!saving) fail(new ValidationError('The form has no "file" field'));
        if (settled) return;
        settled = true;
        if (failure) {
          await target.dispose();
          reject(failure);
        } else resolve({ file: target, fields });
      })();
    });
    request.on('aborted', () => {
      if (settled) return;
      settled = true;
      void target.dispose();
      reject(new ValidationError('The upload was interrupted'));
    });
    request.pipe(busboy);
  });
}

function tooLarge(maxBytes: number): ValidationError {
  return new ValidationError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`, {
    reason: 'too_large',
  });
}
