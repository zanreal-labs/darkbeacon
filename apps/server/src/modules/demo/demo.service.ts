import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountService, DemoLogin, type SignedIn } from '@darkbeacon/identity';
import {
  CommentUseCases,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  StructureUseCases,
  SystemUseCases,
} from '@darkbeacon/mapping';
import { AsyncAuditScope } from '../../platform/audit.js';
import { SharingUseCases } from '@darkbeacon/sharing';
import { seedDemoAlliance } from './demo-alliance.js';
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
    @Inject(AsyncAuditScope) private readonly audit: AsyncAuditScope,
    @Inject(SharingUseCases) private readonly sharing: SharingUseCases,
    @Inject(CommentUseCases) private readonly comments: CommentUseCases,
    @Inject(StructureUseCases) private readonly structures: StructureUseCases,
  ) {}

  get enabled(): boolean {
    return this.login.enabled;
  }

  async signIn(userAgent: string | null): Promise<SignedIn> {
    const signedIn = await this.login.signInDemo(userAgent);
    const actor = await this.accounts.actorFor(signedIn.account);
    const run = this.seeding.then(async () => {
      if ((await this.maps.list(actor)).length > 0) return;
      // The demo map is made by the server, not by whoever happened to visit first.
      const mapping = {
        maps: this.maps,
        systems: this.systems,
        connections: this.connections,
        signatures: this.signatures,
        comments: this.comments,
        structures: this.structures,
      };
      const demoMapId = await this.audit.run(
        { channel: { kind: 'system', id: 'demo' }, origin: undefined },
        async () => {
          const id = await seedDemoChain(actor, mapping);
          // Two corporations' maps and the alliance chain merging them (shares between maps).
          await seedDemoAlliance(actor, mapping, this.sharing);
          return id;
        },
      );
      // `/` keeps opening the demo chain; the others are a click away in the map switcher.
      await this.accounts.recordMapOpened(actor, demoMapId);
      this.logger.log('seeded the demo maps');
    });
    // A failed seed must not block the next visit from trying again.
    this.seeding = run.catch(() => undefined);
    await run;
    return signedIn;
  }
}
