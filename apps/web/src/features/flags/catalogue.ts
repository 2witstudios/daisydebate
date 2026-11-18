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
  {
    key: 'daisy-tab',
    kind: 'release',
    owner: 'Daisy Tab (@2witstudios)',
    taskCode: 'TAB-3.13',
    expiresOn: '2027-03-31',
    safeDefault: false,
    dependencies: [],
  },
  {
    // Minors' accounts and guardian links, closed until counsel answers.
    key: 'daisy-tab-minors',
    kind: 'release',
    owner: 'Daisy Tab (@2witstudios)',
    taskCode: 'TAB-8.2',
    expiresOn: '2027-03-31',
    safeDefault: false,
    dependencies: ['daisy-tab'],
  },
  {
    // /pricing and the links to it; opens once the owner approves pricing
    // in production (epic PYL win condition 5).
    key: 'pricing-page',
    kind: 'release',
    owner: 'Billing (@2witstudios)',
    taskCode: 'PYL-12',
    expiresOn: '2027-03-31',
    safeDefault: false,
    dependencies: [],
  },
  {
    // Start a Club on /pricing; S7 opens it with /clubs/new.
    key: 'club-seats',
    kind: 'release',
    owner: 'Billing (@2witstudios)',
    taskCode: 'PYL-13',
    expiresOn: '2027-03-31',
    safeDefault: false,
    dependencies: [],
  },
  {
    // League's Talk to us on /pricing; S9 opens it with /contact/league.
    key: 'league-requests',
    kind: 'release',
    owner: 'Daisy Tab (@2witstudios)',
    taskCode: 'PYL-17',
    expiresOn: '2027-03-31',
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
