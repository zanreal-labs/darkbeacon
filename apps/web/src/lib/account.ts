import type { MeDto } from '@darkbeacon/shared';

/** The picture of an account: its Discord avatar, else its main character's portrait. */
export function accountImage(me: MeDto): string | null {
  const main = me.characters.find((c) => c.id === me.account.mainCharacterId);
  return accountImageOf({ avatarUrl: me.account.avatarUrl, mainCharacterId: main?.id ?? null });
}

/** The same for any account summary (people lists). */
export function accountImageOf(account: {
  avatarUrl: string | null;
  mainCharacterId?: number | null;
}): string | null {
  return (
    account.avatarUrl ??
    (account.mainCharacterId
      ? `https://images.evetech.net/characters/${account.mainCharacterId}/portrait?size=128`
      : null)
  );
}
