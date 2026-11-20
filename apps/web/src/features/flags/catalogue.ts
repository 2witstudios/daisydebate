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
    key: 'parental-controls',
    kind: 'release',
    owner: 'Daisy Tab (@2witstudios)',
    taskCode: 'PC-1.3',
    expiresOn: '2027-03-31',
    safeDefault: false,
    dependencies: [],
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
    // The host home at /host, event upgrades and Host a tournament on /pricing (ADR 0149).
    key: 'host-tiers',
    kind: 'release',
    owner: 'Daisy Tab (@2witstudios)',
    taskCode: 'PYL-14',
    expiresOn: '2027-03-31',
    safeDefault: false,
    dependencies: ['daisy-tab'],
  },
  {
    // Club seats (ADR 0148): Start a Club on /pricing opens /clubs/new, then
    // the club's seats and billing, and seat invitations.
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
  {
    // Media releases and publishing Youth Rounds (PYL-5, ADR 0151): the
    // minor's request, the parent's pages, a club's confirmation and Share
    // publicly; closed in production until counsel approves the release
    // wording (decision 81, PYL-8). An opt-out from release requests works
    // whatever it says.
    key: 'youth-publishing',
    kind: 'release',
    owner: 'Recording (@2witstudios)',
    taskCode: 'PYL-8',
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
