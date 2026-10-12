import { NotFoundError, type Actor } from '@darkbeacon/core';

export type CommandHandler = (actor: Actor, input: unknown) => Promise<unknown>;

/**
 * Core commands plugins may run with `ctx.commands.run(name, input)`. Modules register theirs
 * at startup; the handler receives the plugin actor and authorizes it like any other caller.
 */
export class PluginCommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  register(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
  }

  names(): string[] {
    return [...this.handlers.keys()].sort();
  }

  run(actor: Actor, name: string, input: unknown): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new NotFoundError(`Command "${name}"`);
    return handler(actor, input);
  }
}
