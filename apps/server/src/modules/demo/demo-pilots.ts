import type { AccessRules } from '@darkbeacon/access';
import type { Actor } from '@darkbeacon/core';
import { DEMO_CHARACTERS, devCharacterId, type DemoLogin } from '@darkbeacon/identity';
import type { CharacterPresence, TrackingRepository } from '@darkbeacon/tracking';

/** The NPC corporation every demo character starts in; it is a member of the demo chain. */
const DEMO_CORPORATION = 1000169;

const HOME = 31002531; // J014348
const MAGNETAR = 31000399; // J130256
const PULSAR = 31001924; // J130026
const NOURVUKAIKEN = 30001376;
const AMAMAKE = 30002537;

const LOKI = 29990;
const PROTEUS = 29988;
const SABRE = 22456;
const BUZZARD = 11192;
const ORCA = 28606;
const HERON = 605;

interface PilotSeed {
  /** The account it belongs to; absent: the demo account itself. */
  account?: string;
  name: string;
  at: number | null;
  ship: number | null;
  shipName: string | null;
  online: boolean;
  docked?: boolean;
}

/** The demo account's own characters first (main online at home), then corp mates. */
const PILOTS: readonly PilotSeed[] = [
  { name: DEMO_CHARACTERS[0]!, at: HOME, ship: LOKI, shipName: 'Quiet Hours', online: true },
  { name: DEMO_CHARACTERS[1]!, at: AMAMAKE, ship: HERON, shipName: 'Scout', online: false },
  { account: 'Kaelen Rho', name: 'Kaelen Rho', at: HOME, ship: SABRE, shipName: 'Bubble Wrap', online: true },
  { account: 'Mira Osk', name: 'Mira Osk', at: MAGNETAR, ship: PROTEUS, shipName: 'Proteus', online: true },
  { account: 'Dax Verin', name: 'Dax Verin', at: PULSAR, ship: BUZZARD, shipName: 'Eyes Only', online: true },
  {
    account: 'Sela Thorne',
    name: 'Sela Thorne',
    at: NOURVUKAIKEN,
    ship: ORCA,
    shipName: 'Hauler',
    online: true,
    docked: true,
  },
  { account: 'Orin Vale', name: 'Orin Vale', at: MAGNETAR, ship: null, shipName: null, online: false },
];

/**
 * Tracked pilots on the demo chain, so its top bar, Local and "On the map" have someone to
 * show: the demo account's two characters and a few corp mates, made members of the chain
 * through their corporation. Their places are made up; nothing polls ESI for them.
 */
export async function seedDemoPilots(
  owner: Actor & { kind: 'account' },
  mapId: string,
  deps: { login: DemoLogin; rules: AccessRules; tracking: TrackingRepository; now: number },
): Promise<void> {
  await deps.rules.add(owner, mapId, {
    subjectKind: 'corporation',
    subjectId: String(DEMO_CORPORATION),
    role: 'member',
  });
  for (const pilot of PILOTS) {
    const { accountId, characterId } = pilot.account
      ? await deps.login.ensurePilot(pilot.account, { name: pilot.name })
      : { accountId: owner.id, characterId: devCharacterId(pilot.name) };
    await deps.tracking.setTracked({ mapId, characterId, accountId, since: deps.now }, true);
    const presence: CharacterPresence = {
      characterId,
      accountId,
      name: pilot.name,
      solarSystemId: pilot.at,
      shipTypeId: pilot.ship,
      shipName: pilot.shipName,
      online: pilot.online,
      docked: pilot.docked ?? false,
      updatedAt: deps.now - (pilot.online ? 60_000 : 3 * 60 * 60_000),
    };
    await deps.tracking.savePresence(presence);
  }
}
