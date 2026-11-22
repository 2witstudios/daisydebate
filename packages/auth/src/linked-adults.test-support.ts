import type { AgeBand, RatingDivision } from '@daisy/protocol/ladder';
import type { LinkedAdultFacts } from './linked-adults';

/**
 * The shared fixtures the linked-adult rule is held to (ADR 0158): the
 * TypeScript statement (`linkedAdultsOfRound`) in a unit test, and the SQL
 * functions on the same people seeded into PostgreSQL. People, schools and
 * seats are named; each side gives the names its own ids.
 */
export type LinkedAdultFixture = {
  readonly given: string;
  readonly should: string;
  readonly round: {
    readonly room: RatingDivision | null;
    /** A ranked Round's frozen ladder division; null for a casual one. */
    readonly ladder: RatingDivision | null;
  };
  /** Each person's age band; null when they have no age record. */
  readonly people: Readonly<Record<string, AgeBand | null>>;
  /** A debater's seat, or an official's: a moderator, who never debates. */
  readonly seats: readonly {
    readonly person: string;
    readonly kind: 'debater' | 'moderator';
  }[];
  readonly guardianLinks?: readonly {
    readonly guardian: string;
    readonly minor: string;
    readonly active: boolean;
  }[];
  readonly organizations?: readonly {
    readonly name: string;
    readonly school: boolean;
    readonly open: boolean;
    readonly owner: string | null;
  }[];
  readonly memberships?: readonly {
    readonly organization: string;
    readonly person: string;
    readonly active: boolean;
  }[];
  readonly grants?: readonly {
    readonly organization: string;
    readonly person: string;
    /** Live, revoked, or past its `expires_at`. */
    readonly state: 'live' | 'revoked' | 'expired';
    readonly rosterManage: boolean;
  }[];
  /** Each youth debater's linked adults, by name. */
  readonly expected: Readonly<Record<string, readonly string[]>>;
};

/** One actor per person, both named by the caller's ids. */
export type FixtureIds = Readonly<
  Record<string, { readonly userId: string; readonly actorId: string }>
>;

/** A fixture's facts under the given ids, as the rule reads them. */
export const linkedAdultFactsOf = (
  fixture: LinkedAdultFixture,
  people: FixtureIds,
  organizations: Readonly<Record<string, string>>,
): LinkedAdultFacts => {
  const user = (name: string) => people[name]!.userId;
  const openRoom = fixture.round.room === 'open';
  const youthDebaterUserIds = fixture.seats.flatMap(({ person, kind }) => {
    const age = fixture.people[person];
    return kind === 'debater' && age != null && age !== 'adult'
      ? [user(person)]
      : [];
  });
  return {
    round: {
      ladderDivision: fixture.round.ladder,
      roomYouth:
        fixture.round.room === null
          ? null
          : fixture.round.room === 'youth' ||
            (openRoom && youthDebaterUserIds.length > 0),
      youthDebaterUserIds: openRoom ? youthDebaterUserIds : null,
    },
    seats: fixture.seats.map((seat) => ({
      actorId: people[seat.person]!.actorId,
      debating: seat.kind === 'debater',
      current: true,
    })),
    actors: Object.values(people).map((ids) => ({
      id: ids.actorId,
      userId: ids.userId,
    })),
    ageBands: Object.entries(fixture.people).flatMap(([name, band]) =>
      band === null ? [] : [{ userId: user(name), band }],
    ),
    guardianLinks: (fixture.guardianLinks ?? []).map((link) => ({
      guardianUserId: user(link.guardian),
      minorUserId: user(link.minor),
      active: link.active,
    })),
    organizations: (fixture.organizations ?? []).map((o) => ({
      id: organizations[o.name]!,
      school: o.school,
      open: o.open,
      ownerUserId: o.owner === null ? null : user(o.owner),
    })),
    memberships: (fixture.memberships ?? []).map((m) => ({
      organizationId: organizations[m.organization]!,
      userId: user(m.person),
      active: m.active,
    })),
    grants: (fixture.grants ?? []).map((g) => ({
      organizationId: organizations[g.organization]!,
      userId: user(g.person),
      live: g.state === 'live',
      rosterManage: g.rosterManage,
    })),
  };
};

/** A fixture's expected answer under the given ids. */
export const linkedAdultExpectationOf = (
  fixture: LinkedAdultFixture,
  people: FixtureIds,
) => ({
  debaters: Object.entries(fixture.expected)
    .map(([name, adults]) => ({
      actorId: people[name]!.actorId,
      userId: people[name]!.userId,
      linkedAdultActorIds: adults.map((adult) => people[adult]!.actorId).sort(),
    }))
    .sort((a, b) => (a.actorId < b.actorId ? -1 : 1)),
});

const riverside = {
  name: 'riverside',
  school: true,
  open: true,
  owner: 'owner',
} as const;

/** A student in a school with every kind of linked adult. */
const everyKind = {
  people: {
    student: '16-17',
    opponent: '13-15',
    parent: 'adult',
    owner: 'adult',
    coach: 'adult',
  },
  seats: [
    { person: 'student', kind: 'debater' },
    { person: 'opponent', kind: 'debater' },
  ],
  guardianLinks: [{ guardian: 'parent', minor: 'student', active: true }],
  organizations: [riverside],
  memberships: [
    { organization: 'riverside', person: 'student', active: true },
    { organization: 'riverside', person: 'coach', active: true },
  ],
  grants: [
    {
      organization: 'riverside',
      person: 'coach',
      state: 'live',
      rosterManage: true,
    },
  ],
} as const;

export const linkedAdultFixtures: readonly LinkedAdultFixture[] = [
  {
    given:
      'a casual Youth Room Round seating a student with a parent, a school owner and a roster coach, and an opponent with nobody',
    should:
      'name each kind of linked adult for the student, nobody for the opponent',
    round: { room: 'youth', ladder: null },
    ...everyKind,
    expected: { student: ['coach', 'owner', 'parent'], opponent: [] },
  },
  {
    given: 'the same people in a ranked Youth Room Round',
    should: 'name the same linked adults',
    round: { room: 'youth', ladder: 'youth' },
    ...everyKind,
    expected: { student: ['coach', 'owner', 'parent'], opponent: [] },
  },
  {
    given: 'the same youth debaters in a casual Open Room Round',
    should: 'name their linked adults as in a Youth Round',
    round: { room: 'open', ladder: null },
    ...everyKind,
    expected: { student: ['coach', 'owner', 'parent'], opponent: [] },
  },
  {
    given: 'a youth debater and adult opponent in a ranked Open Room Round',
    should: 'name only the youth debater and their linked adults',
    round: { room: 'open', ladder: 'open' },
    ...everyKind,
    people: { ...everyKind.people, opponent: 'adult' },
    expected: { student: ['coach', 'owner', 'parent'] },
  },
  {
    given: 'two adult debaters in a ranked Open Room Round',
    should: 'return an empty list of linked adults',
    round: { room: 'open', ladder: 'open' },
    ...everyKind,
    people: { ...everyKind.people, student: 'adult', opponent: 'adult' },
    expected: {},
  },
  {
    given: 'the same people in a ranked Youth Round with no Room',
    should: 'name the same linked adults: its frozen ladder makes it Youth',
    round: { room: null, ladder: 'youth' },
    ...everyKind,
    expected: { student: ['coach', 'owner', 'parent'], opponent: [] },
  },
  {
    given: 'the same people in a ranked Open Round with no Room',
    should: 'name no debater at all',
    round: { room: null, ladder: 'open' },
    ...everyKind,
    expected: {},
  },
  {
    given:
      'people who are not linked: an ended guardian link, a guardian with no age record, a minor owner, a minor, a revoked and an expired coach, a member without the roster permission, a grant holder who left, another school’s coach, a closed school’s and a family’s owner, and the owner of a school the student left',
    should: 'name none of them',
    round: { room: 'youth', ladder: null },
    people: {
      student: '16-17',
      minorOwner: '16-17',
      formerParent: 'adult',
      unagedParent: null,
      minorStaff: '16-17',
      revokedCoach: 'adult',
      expiredCoach: 'adult',
      plainMember: 'adult',
      leftCoach: 'adult',
      otherCoach: 'adult',
      closedOwner: 'adult',
      familyOwner: 'adult',
      formerOwner: 'adult',
      owner: 'adult',
      stranger: 'adult',
    },
    seats: [{ person: 'student', kind: 'debater' }],
    guardianLinks: [
      { guardian: 'formerParent', minor: 'student', active: false },
      { guardian: 'unagedParent', minor: 'student', active: true },
    ],
    organizations: [
      { name: 'riverside', school: true, open: true, owner: 'minorOwner' },
      { name: 'elsewhere', school: true, open: true, owner: 'owner' },
      { name: 'closed', school: true, open: false, owner: 'closedOwner' },
      { name: 'family', school: false, open: true, owner: 'familyOwner' },
      { name: 'former', school: true, open: true, owner: 'formerOwner' },
    ],
    memberships: [
      { organization: 'riverside', person: 'student', active: true },
      { organization: 'riverside', person: 'minorStaff', active: true },
      { organization: 'riverside', person: 'revokedCoach', active: true },
      { organization: 'riverside', person: 'expiredCoach', active: true },
      { organization: 'riverside', person: 'plainMember', active: true },
      { organization: 'riverside', person: 'leftCoach', active: false },
      { organization: 'elsewhere', person: 'otherCoach', active: true },
      { organization: 'closed', person: 'student', active: true },
      { organization: 'family', person: 'student', active: true },
      { organization: 'former', person: 'student', active: false },
    ],
    grants: [
      {
        organization: 'riverside',
        person: 'minorStaff',
        state: 'live',
        rosterManage: true,
      },
      {
        organization: 'riverside',
        person: 'revokedCoach',
        state: 'revoked',
        rosterManage: true,
      },
      {
        organization: 'riverside',
        person: 'expiredCoach',
        state: 'expired',
        rosterManage: true,
      },
      {
        organization: 'riverside',
        person: 'plainMember',
        state: 'live',
        rosterManage: false,
      },
      {
        organization: 'riverside',
        person: 'leftCoach',
        state: 'live',
        rosterManage: true,
      },
      {
        organization: 'elsewhere',
        person: 'otherCoach',
        state: 'live',
        rosterManage: true,
      },
    ],
    expected: { student: [] },
  },
  {
    given:
      'a Youth Round moderated by the student’s coach, and an adult debater who owns the school they belong to',
    should:
      'name the coach for the student though they officiate, count no official as a debater, and never name a debater their own linked adult',
    round: { room: 'youth', ladder: null },
    people: { student: '16-17', coach: 'adult', debatingOwner: 'adult' },
    seats: [
      { person: 'student', kind: 'debater' },
      { person: 'debatingOwner', kind: 'debater' },
      { person: 'coach', kind: 'moderator' },
    ],
    organizations: [
      { name: 'riverside', school: true, open: true, owner: 'debatingOwner' },
    ],
    memberships: [
      { organization: 'riverside', person: 'student', active: true },
      { organization: 'riverside', person: 'debatingOwner', active: true },
      { organization: 'riverside', person: 'coach', active: true },
    ],
    grants: [
      {
        organization: 'riverside',
        person: 'coach',
        state: 'live',
        rosterManage: true,
      },
    ],
    expected: {
      student: ['coach', 'debatingOwner'],
      debatingOwner: ['coach'],
    },
  },
];
