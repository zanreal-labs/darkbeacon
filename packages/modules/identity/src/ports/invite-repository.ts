import type { Invite } from '../domain/account.js';
import type { SignInPolicy } from '@darkbeacon/shared';

export interface InviteRepository {
  insert(invite: Invite): Promise<void>;
  /** Newest first. */
  list(): Promise<Invite[]>;
  findById(id: string): Promise<Invite | null>;
  findByTokenHash(hash: string): Promise<Invite | null>;
  update(invite: Invite): Promise<void>;
  /**
   * Counts one use while the invite still has one left (not revoked, not expired at `now`, under
   * its maximum). False when it had none left, so two sign-ups can never share the last use.
   */
  use(id: string, now: number): Promise<boolean>;
}

/** Who may sign up (an instance setting kept by access); identity only asks. */
export interface SignUpRules {
  signInPolicy(): Promise<SignInPolicy>;
}
