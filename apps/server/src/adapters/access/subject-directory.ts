import { subjectKey, type AccessSubjectDirectory, type SubjectDescription } from '@darkbeacon/access';
import type { AccountService, DiscordBotService, EveDirectoryService } from '@darkbeacon/identity';
import type { AccessSubjectKind } from '@darkbeacon/shared';

const IMAGE = 'https://images.evetech.net';

/** Names of access rule subjects from identity's lookups (ESI, accounts, the Discord bot). */
export class IdentitySubjectDirectory implements AccessSubjectDirectory {
  constructor(
    private readonly eve: EveDirectoryService,
    private readonly accounts: AccountService,
    private readonly bot: DiscordBotService,
  ) {}

  async describe(
    subjects: ReadonlyArray<{ kind: AccessSubjectKind; id: string; guildId: string | null }>,
  ): Promise<Map<string, SubjectDescription>> {
    const result = new Map<string, SubjectDescription>();
    const eveIds = subjects
      .filter((s) => s.kind === 'character' || s.kind === 'corporation' || s.kind === 'alliance')
      .map((s) => Number(s.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const [entities, accounts] = await Promise.all([
      eveIds.length > 0 ? this.eve.entities(eveIds).catch(() => []) : [],
      this.accounts.names(subjects.filter((s) => s.kind === 'account').map((s) => s.id)),
    ]);
    for (const e of entities) {
      const image =
        e.category === 'character'
          ? `${IMAGE}/characters/${e.id}/portrait?size=64`
          : `${IMAGE}/${e.category === 'corporation' ? 'corporations' : 'alliances'}/${e.id}/logo?size=64`;
      result.set(subjectKey(e.category, String(e.id)), {
        name: e.name,
        detail: e.ticker ? `[${e.ticker}]` : null,
        imageUrl: image,
      });
    }
    for (const [id, account] of accounts) {
      result.set(subjectKey('account', id), {
        name: account.name,
        detail: null,
        imageUrl: account.avatarUrl,
      });
    }
    const discord = subjects.filter((s) => s.kind === 'discordRole' && s.guildId);
    if (discord.length > 0) {
      const guilds = await this.bot.guilds().catch(() => []);
      for (const guildId of new Set(discord.map((s) => s.guildId!))) {
        const guild = guilds.find((g) => g.id === guildId);
        const roles = guild ? await this.bot.roles(guildId).catch(() => []) : [];
        for (const s of discord.filter((d) => d.guildId === guildId)) {
          const role = roles.find((r) => r.id === s.id);
          if (role) {
            result.set(subjectKey('discordRole', s.id), {
              name: `@${role.name}`,
              detail: guild?.name ?? null,
              imageUrl: guild?.iconUrl ?? null,
            });
          }
        }
      }
    }
    return result;
  }
}
