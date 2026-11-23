import type { FlagsStore } from '@daisy/db/stores/flags';
import { isAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { instantMs } from '@daisy/clock';
import { flagCatalogue, type ReleaseFlagKey } from '../flags/catalogue';
import { changeFlag } from './flags';

const operator: AuthorizationPrincipal = {
  kind: 'operator_service',
  serviceId: 'test-suite',
  keyId: 'test-suite',
  operatorRef: 'test-suite',
  capabilities: ['flag.override.update'],
};

/**
 * Turns a release flag on (or off) for one account exactly as an operator does
 * (`flag.override.update` through the operator API's own command), never a
 * test bypass. The flag's revision is shared by every override, so a
 * concurrent grant can move it: a conflict rereads and asks again. Returns
 * the applied command's id, so a suite can remove the change event it wrote.
 */
export async function grantReleaseOverride(input: {
  readonly store: Pick<FlagsStore, 'flagCommand' | 'readFlagSnapshot'>;
  readonly key: ReleaseFlagKey;
  readonly userId: string;
  readonly nextId: () => string;
  /** How long the override lasts; never past the flag's own expiry. */
  readonly forMs?: number;
  /** False turns the flag off for this account, as an operator can. */
  readonly enabled?: boolean;
}): Promise<string> {
  const entry = flagCatalogue.find((flag) => flag.key === input.key);
  if (!entry) throw new Error(`No catalogue entry for ${input.key}`);
  // The flag's effective expiry, as decideFlagChange bounds an override.
  const expiry = instantMs(`${entry.expiresOn}T00:00:00Z`) + 86_400_000;
  for (let attempt = 0; attempt < 20; attempt++) {
    const { snapshot, now } = await input.store.readFlagSnapshot(null, [
      input.key,
    ]);
    const revision = snapshot.flags[0]?.revision ?? 0;
    const commandId = input.nextId();
    const body = new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        commandId,
        expectedRevision: revision,
        adminAuditHead: '0'.repeat(64),
        accountId: input.userId,
        override: {
          enabled: input.enabled ?? true,
          expiresAt: new Date(
            Math.min(now + (input.forMs ?? 86_400_000), expiry),
          ).toISOString(),
        },
      }),
    );
    try {
      // Signed and checked at the database's own instant: no host clock.
      await changeFlag(
        { store: input.store, nextId: input.nextId, nowMs: () => now },
        operator,
        'setFlagOverride',
        input.key,
        { body, signedAtMs: now },
      );
      return commandId;
    } catch (error) {
      if (!isAppError(error) || error.code !== 'CONFLICT') throw error;
    }
  }
  throw new Error(`The ${input.key} override kept conflicting`);
}
