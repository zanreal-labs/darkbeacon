import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Actor } from '@wormwright/core';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** Turns request headers (session cookie, API token) into an Actor; null = anonymous. */
export type ActorResolver = (request: RequestLike) => Promise<Actor | null>;

/**
 * Extension point for authentication, used by both HTTP and WebSocket. The identity module
 * installs its resolver with `registry.use(...)` in `onModuleInit`; until then everyone is anonymous.
 */
@Injectable()
export class ActorResolverRegistry {
  private resolver: ActorResolver = () => Promise.resolve(null);

  use(resolver: ActorResolver): void {
    this.resolver = resolver;
  }

  resolve(request: RequestLike): Promise<Actor | null> {
    return this.resolver(request);
  }
}

type WithActor = RequestLike & { actor?: Actor | null };

/** Global guard: resolves the actor once per HTTP request. Never rejects; use cases authorize. */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(@Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<WithActor>();
    request.actor = await this.actors.resolve(request);
    return true;
  }
}

/** `@CurrentActor() actor: Actor | null` in a controller method. */
export const CurrentActor = createParamDecorator(
  (_: unknown, context: ExecutionContext): Actor | null =>
    context.switchToHttp().getRequest<WithActor>().actor ?? null,
);
