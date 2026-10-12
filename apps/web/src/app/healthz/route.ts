/** Liveness of this server, asked by the API server's health check. Prerendered, so it is cheap. */
export function GET(): Response {
  return new Response('ok', { headers: { 'content-type': 'text/plain' } });
}
