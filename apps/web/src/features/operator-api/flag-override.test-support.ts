import type { Database } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { ReleaseFlagKey } from '../flags/catalogue';
import { changeFlag } from './flags';

const operator: AuthorizationPrincipal = {
  kind: 'operator_service',
  serviceId: 'test-suite',
  keyId: 'test-suite',
  operatorRef: 'test-suite',
  capabilities: ['flag.override.update'],
};

/**
 * Turns a release flag on for one account exactly as an operator does
 * (`flag.override.update` through the operator API's own command), never a
 * test bypass. The flag's revision is shared by every override, so a
 * concurrent grant can move it: a conflict rereads and asks again.
 */
export async function grantReleaseOverride(input: {
  readonly store: Pick<Database, 'flagCommand' | 'readFlagSnapshot'>;
  readonly key: ReleaseFlagKey;
  readonly userId: string;
  readonly nextId: () => string;
  /** How long the override lasts; never past the flag's own expiry. */
  readonly forMs?: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { snapshot, now } = await input.store.readFlagSnapshot(null, [
      input.key,
    ]);
    const revision =
      snapshot.kind === 'available' ? (snapshot.flags[0]?.revision ?? 0) : 0;
    const body = new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        commandId: input.nextId(),
        expectedRevision: revision,
        adminAuditHead: '0'.repeat(64),
        accountId: input.userId,
        override: {
          enabled: true,
          expiresAt: new Date(now + (input.forMs ?? 86_400_000)).toISOString(),
        },
      }),
    );
    try {
      await changeFlag(
        { store: input.store, nextId: input.nextId, nowMs: Date.now },
        operator,
        'setFlagOverride',
        input.key,
        { body, signedAtMs: Date.now() },
      );
      return;
    } catch (error) {
      if (!isAppError(error) || error.code !== 'CONFLICT') throw error;
    }
  }
  throw new Error(`The ${input.key} override kept conflicting`);
}
