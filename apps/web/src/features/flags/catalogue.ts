import type { FlagDefinition } from './model';

/** Keys are permanent identities; removal retires the key in the policy ledger. */
export const flagCatalogue = [
  {
    key: 'premium-checkout',
    kind: 'release',
    owner: 'Billing (@2witstudios)',
    taskCode: 'FLAGS-15',
    expiresOn: '2026-12-04',
    safeDefault: false,
    dependencies: [],
  },
] as const satisfies readonly FlagDefinition[];

export type ReleaseFlagKey = Extract<
  (typeof flagCatalogue)[number],
  { kind: 'release' }
>['key'];

/** A display decision, never durable authority to create a purchase intent. */
export type ReleaseFlagReader = (
  key: ReleaseFlagKey,
  accountId: string | null,
) => Promise<boolean>;
