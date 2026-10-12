import type { AuditContext, NewEvent } from '@darkbeacon/core';
import {
  buildAuditRecord,
  NO_FACTS,
  subjectCharacter,
  type ActorFacts,
  type AuditRecord,
} from '../domain/record.js';
import type { AuditDirectory } from '../ports/index.js';

/** A directory that knows nobody (tests, tools). */
export const EMPTY_DIRECTORY: AuditDirectory = {
  account: () => Promise.resolve(null),
  character: () => Promise.resolve(null),
};

/**
 * Builds the audit records of events about to be appended: who (account, character in use,
 * names as they are now), how (channel), from where (origin) and what changed (diff/snapshot).
 * Runs inside the appending transaction.
 */
export class AuditStamper {
  constructor(private readonly directory: AuditDirectory = EMPTY_DIRECTORY) {}

  async stamp(
    events: readonly NewEvent[],
    context: AuditContext,
  ): Promise<Array<{ record: AuditRecord; refs: string[] }>> {
    const cache = new Map<string, Promise<ActorFacts>>();
    const factsFor = (event: NewEvent): Promise<ActorFacts> => {
      const subject = event.actor.kind === 'account' ? null : subjectCharacter(event);
      const key = `${event.actor.kind}:${event.actor.id}:${subject ?? ''}`;
      let facts = cache.get(key);
      if (!facts) cache.set(key, (facts = this.facts(event, context, subject)));
      return facts;
    };
    const out = [];
    for (const event of events) out.push(buildAuditRecord(event, context, await factsFor(event)));
    return out;
  }

  private async facts(event: NewEvent, context: AuditContext, subject: number | null): Promise<ActorFacts> {
    if (event.actor.kind === 'account') {
      const account = await this.directory.account(event.actor.id);
      const characterId = context.characterId ?? account?.mainCharacterId ?? null;
      const characterName =
        characterId === null
          ? null
          : characterId === account?.mainCharacterId
            ? account.mainCharacterName
            : ((await this.directory.character(characterId))?.name ?? null);
      return { accountId: event.actor.id, accountName: account?.name ?? null, characterId, characterName };
    }
    // A system process or plugin acting about a character (tracking): that character's owner.
    const characterId = context.characterId ?? subject;
    if (characterId === null) return NO_FACTS;
    const character = await this.directory.character(characterId);
    return {
      accountId: character?.accountId ?? null,
      accountName: character?.accountName ?? null,
      characterId,
      characterName: character?.name ?? null,
    };
  }
}
