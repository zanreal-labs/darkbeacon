import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountService, DemoLogin, type SignedIn } from '@darkbeacon/identity';
import { ConnectionUseCases, MapUseCases, SignatureUseCases, SystemUseCases } from '@darkbeacon/mapping';
import { seedDemoChain } from './demo-chain.js';

/**
 * Demo mode: signs a visit in as the demo account and seeds the demo map the first time that
 * account has no map at all (so it comes back if every map was deleted).
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger('Demo');
  /** Visits arrive in bursts (several tabs, StrictMode); seeding runs one at a time. */
  private seeding: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DemoLogin) private readonly login: DemoLogin,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(MapUseCases) private readonly maps: MapUseCases,
    @Inject(SystemUseCases) private readonly systems: SystemUseCases,
    @Inject(ConnectionUseCases) private readonly connections: ConnectionUseCases,
    @Inject(SignatureUseCases) private readonly signatures: SignatureUseCases,
  ) {}

  get enabled(): boolean {
    return this.login.enabled;
  }

  async signIn(userAgent: string | null): Promise<SignedIn> {
    const signedIn = await this.login.signInDemo(userAgent);
    const actor = await this.accounts.actorFor(signedIn.account);
    const run = this.seeding.then(async () => {
      if ((await this.maps.list(actor)).length > 0) return;
      await seedDemoChain(actor, {
        maps: this.maps,
        systems: this.systems,
        connections: this.connections,
        signatures: this.signatures,
      });
      this.logger.log('seeded the demo map');
    });
    // A failed seed must not block the next visit from trying again.
    this.seeding = run.catch(() => undefined);
    await run;
    return signedIn;
  }
}
