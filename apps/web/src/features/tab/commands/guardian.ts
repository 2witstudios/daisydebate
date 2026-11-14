import type { AgeBand } from '@daisy/auth';
import type {
  GuardianCommand,
  GuardianRefusal,
} from '@daisy/protocol/lobby/guardian-command';
import type {
  guardianLinkKinds,
  guardianLinkStatuses,
  MembershipStatus,
  videoAudienceCaps,
} from '@daisy/protocol/lobby';
import { refuse, type CommandDecision } from './run-command';

/**
 * The guardian commands' decisions (TAB-5.9). The evaluator decides who may
 * send them; through a school it checks only that the sender manages the
 * school's roster, so that the adult named belongs to the school is checked
 * here (`guardian-not-member`).
 */

type GuardianLinkKind = (typeof guardianLinkKinds)[number];
type GuardianLinkStatus = (typeof guardianLinkStatuses)[number];
type VideoAudienceCap = (typeof videoAudienceCaps)[number];

/** A `guardian_links` row. */
export type GuardianLinkRow = {
  readonly id: string;
  readonly guardianUserId: string;
  readonly minorUserId: string;
  readonly kind: GuardianLinkKind;
  readonly viaOrganizationId: string | null;
  readonly status: GuardianLinkStatus;
  readonly version: number;
};
/** A `restrictions` row with its `restriction_lobbies`. */
export type RestrictionFact = {
  readonly limitsLobbies: boolean;
  readonly videoAudienceCap: VideoAudienceCap;
  readonly version: number;
  readonly lobbyIds: readonly string[];
};

export type GuardianFacts = {
  readonly now: string;
  /** The id minted at the edge for a link a command inserts. */
  readonly newId: string;
  /** The link a command names; null for `create-guardian-link`. */
  readonly link: GuardianLinkRow | null;
  /** The ward's age band (the one named, or the link's); null when unknown. */
  readonly wardAgeBand: AgeBand | null;
  /** The age band of the adult a command names as guardian. */
  readonly guardianAgeBand: AgeBand | null;
  /** That adult's membership of the school a link is made through. */
  readonly guardianSchoolMembership: MembershipStatus | null;
  /** Whether an open link already joins that adult and the ward. */
  readonly openLinkExists: boolean;
  /** The ward's active links other than the one named. */
  readonly wardOtherActiveLinks: number;
  /** The consent notice now in force. */
  readonly consentNoticeVersion: number;
  /** The lobbies `set-restriction` names that exist, and whether each is closed. */
  readonly lobbies: readonly {
    readonly id: string;
    readonly closedAt: string | null;
  }[];
  readonly restriction: RestrictionFact | null;
};

type LinkPeople = {
  readonly guardianLinkId: string;
  readonly guardianUserId: string;
  readonly minorUserId: string;
};

export type GuardianWrite =
  | {
      readonly table: 'guardian_links';
      readonly op: 'insert';
      readonly row: Omit<GuardianLinkRow, 'version' | 'status'> & {
        readonly status: 'pending';
      };
    }
  | {
      readonly table: 'guardian_links';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly status?: GuardianLinkStatus;
        readonly endedAt?: string;
        readonly version: number;
      };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'insert';
      readonly row: LinkPeople & {
        readonly limitsLobbies: boolean;
        readonly videoAudienceCap: VideoAudienceCap;
      };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'update';
      readonly guardianLinkId: string;
      readonly set: {
        readonly limitsLobbies: boolean;
        readonly videoAudienceCap: VideoAudienceCap;
        readonly version: number;
      };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'delete';
      readonly guardianLinkId: string;
    }
  | {
      readonly table: 'restriction_lobbies';
      readonly op: 'insert';
      readonly row: LinkPeople & { readonly lobbyId: string };
    }
  | {
      readonly table: 'restriction_lobbies';
      readonly op: 'delete';
      readonly guardianLinkId: string;
      readonly lobbyId: string;
    }
  /** Moves the ward's account revision, so stale authority is dropped. */
  | {
      readonly table: 'users';
      readonly op: 'update';
      readonly id: string;
      readonly increment: 'version';
    };

export type GuardianDecisionRefusal = GuardianRefusal | 'not-found';
type Decision = CommandDecision<GuardianDecisionRefusal, GuardianWrite>;

const isMinor = (band: AgeBand | null): boolean =>
  band !== null && band !== 'adult';

const accepted = (
  id: string,
  resultingVersion: number,
  writes: readonly GuardianWrite[],
): Decision => ({
  kind: 'accepted',
  aggregate: { kind: 'guardian_link', id },
  resultingVersion,
  writes,
  findings: [],
  fixtureChanges: [],
});

const bumpWard = (link: GuardianLinkRow): GuardianWrite => ({
  table: 'users',
  op: 'update',
  id: link.minorUserId,
  increment: 'version',
});

const newLink = (
  facts: GuardianFacts,
  row: Omit<GuardianLinkRow, 'id' | 'version' | 'status'>,
): Decision =>
  accepted(facts.newId, 1, [
    {
      table: 'guardian_links',
      op: 'insert',
      row: { id: facts.newId, ...row, status: 'pending' },
    },
  ]);

function createLink(
  facts: GuardianFacts,
  command: Extract<GuardianCommand, { type: 'create-guardian-link' }>,
): Decision {
  if (!isMinor(facts.wardAgeBand)) return refuse('ward-not-minor');
  if (facts.guardianAgeBand !== 'adult') return refuse('guardian-not-adult');
  if (
    command.through.kind === 'school' &&
    facts.guardianSchoolMembership !== 'active'
  )
    return refuse('guardian-not-member');
  if (facts.openLinkExists) return refuse('link-exists');
  return newLink(facts, {
    guardianUserId: command.guardianUserId,
    minorUserId: command.wardUserId,
    kind: command.through.kind === 'school' ? 'coach' : 'parent',
    viaOrganizationId:
      command.through.kind === 'school' ? command.through.organizationId : null,
  });
}

function setRestriction(
  facts: GuardianFacts,
  link: GuardianLinkRow,
  command: Extract<GuardianCommand, { type: 'set-restriction' }>,
): Decision {
  if (link.status !== 'active') return refuse('link-not-active');
  if (link.kind !== 'parent') return refuse('not-a-parent');
  const open = new Set(
    facts.lobbies
      .filter((lobby) => lobby.closedAt === null)
      .map((lobby) => lobby.id),
  );
  if (!command.allowedLobbyIds.every((lobbyId) => open.has(lobbyId)))
    return refuse('lobby-unavailable');
  const people: LinkPeople = {
    guardianLinkId: link.id,
    guardianUserId: link.guardianUserId,
    minorUserId: link.minorUserId,
  };
  const before = facts.restriction;
  const kept = new Set(command.allowedLobbyIds);
  const had = new Set(before?.lobbyIds ?? []);
  const values = {
    limitsLobbies: command.limitsLobbies,
    videoAudienceCap: command.videoCap,
  };
  return accepted(link.id, link.version + 1, [
    {
      table: 'guardian_links',
      op: 'update',
      id: link.id,
      set: { version: link.version + 1 },
    },
    before === null
      ? { table: 'restrictions', op: 'insert', row: { ...people, ...values } }
      : {
          table: 'restrictions',
          op: 'update',
          guardianLinkId: link.id,
          set: { ...values, version: before.version + 1 },
        },
    ...[...had]
      .filter((lobbyId) => !kept.has(lobbyId))
      .map((lobbyId): GuardianWrite => ({
        table: 'restriction_lobbies',
        op: 'delete',
        guardianLinkId: link.id,
        lobbyId,
      })),
    ...command.allowedLobbyIds
      .filter((lobbyId) => !had.has(lobbyId))
      .map((lobbyId): GuardianWrite => ({
        table: 'restriction_lobbies',
        op: 'insert',
        row: { ...people, lobbyId },
      })),
    bumpWard(link),
  ]);
}

function endLink(facts: GuardianFacts, link: GuardianLinkRow): Decision {
  if (link.status === 'ended') return refuse('link-ended');
  if (
    link.status === 'active' &&
    isMinor(facts.wardAgeBand) &&
    facts.wardOtherActiveLinks === 0
  )
    return refuse('last-guardian');
  return accepted(link.id, link.version + 1, [
    {
      table: 'guardian_links',
      op: 'update',
      id: link.id,
      set: { status: 'ended', endedAt: facts.now, version: link.version + 1 },
    },
    // Its restriction, and the lobbies it allows, go with it.
    ...(facts.restriction === null
      ? []
      : [
          {
            table: 'restrictions',
            op: 'delete',
            guardianLinkId: link.id,
          } as const,
        ]),
    bumpWard(link),
  ]);
}

/** Decides one guardian command against its facts. */
export function decideGuardian(
  facts: GuardianFacts,
  command: GuardianCommand,
): Decision {
  if (command.type === 'create-guardian-link')
    return createLink(facts, command);
  const link = facts.link;
  if (link?.id !== command.guardianLinkId) return refuse('not-found');
  switch (command.type) {
    case 'consent-guardian-link':
      if (link.status !== 'pending') return refuse('link-not-pending');
      if (command.noticeVersion !== facts.consentNoticeVersion)
        return refuse('notice-changed');
      return accepted(link.id, link.version + 1, [
        {
          table: 'guardian_links',
          op: 'update',
          id: link.id,
          set: { status: 'active', version: link.version + 1 },
        },
        bumpWard(link),
      ]);
    case 'add-guardian':
      if (link.status !== 'active') return refuse('link-not-active');
      if (link.kind !== 'parent') return refuse('not-a-parent');
      if (facts.guardianAgeBand !== 'adult')
        return refuse('guardian-not-adult');
      if (facts.openLinkExists) return refuse('link-exists');
      return newLink(facts, {
        guardianUserId: command.guardianUserId,
        minorUserId: link.minorUserId,
        kind: 'parent',
        viaOrganizationId: null,
      });
    case 'set-restriction':
      return setRestriction(facts, link, command);
    case 'end-guardian-link':
      return endLink(facts, link);
  }
}
