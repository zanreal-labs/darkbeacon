import { expect } from 'vitest';

/** A browser for HTTP tests: keeps cookies per name and never follows redirects. */
export class Browser {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly base: string,
    private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  ) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const { json, ...rest } = init;
    const response = await fetch(`http://${this.base}${path}`, {
      redirect: 'manual',
      ...rest,
      headers: {
        cookie: this.cookieHeader,
        'user-agent': this.userAgent,
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split('; ');
      const [name, value] = pair!.split('=') as [string, string];
      if (attributes.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async json<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const response = await this.request(path, init);
    expect(response.status, `${init.method ?? 'GET'} ${path}`).toBeLessThan(300);
    return (await response.json()) as T;
  }

  /** Follows an OAuth round trip: our redirect, the provider's approval, our callback. */
  async oauth(start: string, approve: (challenge: string | null) => string): Promise<string> {
    const begin = await this.request(start);
    expect(begin.status).toBe(302);
    const provider = new URL(begin.headers.get('location')!);
    const code = approve(provider.searchParams.get('code_challenge'));
    const redirectUri = new URL(provider.searchParams.get('redirect_uri')!);
    const callback = await this.request(
      `${redirectUri.pathname}?code=${code}&state=${provider.searchParams.get('state')}`,
    );
    expect(callback.status).toBe(302);
    return callback.headers.get('location')!;
  }
}
