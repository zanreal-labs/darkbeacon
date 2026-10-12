import type { FastifyInstance } from 'fastify';
import { MAX_WANDERER_EXPORT_BYTES, WANDERER_EXPORT_CONTENT_TYPE } from '@darkbeacon/shared';

/** A Wanderer export file read from a request body: the parsed document, or why it was refused. */
export class UploadedExport {
  private constructor(
    readonly document: unknown,
    readonly error: string | null,
  ) {}

  static of(document: unknown): UploadedExport {
    return new UploadedExport(document, null);
  }

  static refused(error: string): UploadedExport {
    return new UploadedExport(null, error);
  }
}

/**
 * Accepts Wanderer export files as request bodies of their own content type: read as a stream,
 * counted as it arrives and dropped (not buffered) past MAX_WANDERER_EXPORT_BYTES, then parsed.
 * The parser never fails the request itself, so the controller answers with the usual error body.
 */
export function acceptExportUploads(fastify: FastifyInstance, maxBytes = MAX_WANDERER_EXPORT_BYTES): void {
  if (fastify.hasContentTypeParser(WANDERER_EXPORT_CONTENT_TYPE)) return;
  fastify.addContentTypeParser(
    WANDERER_EXPORT_CONTENT_TYPE,
    // Fastify's own body limit would end the request before the controller could say why.
    { bodyLimit: Number.MAX_SAFE_INTEGER },
    (_request, payload, done) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let over = false;
      payload.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          over = true;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      payload.on('error', (error) => done(error, undefined));
      payload.on('end', () => {
        if (over) {
          done(null, UploadedExport.refused(`The file is larger than ${Math.round(maxBytes / 1048576)} MB`));
          return;
        }
        try {
          done(null, UploadedExport.of(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        } catch {
          done(
            null,
            UploadedExport.refused('The file is not JSON. Upload the .json file Wanderer exported.'),
          );
        }
      });
    },
  );
}
