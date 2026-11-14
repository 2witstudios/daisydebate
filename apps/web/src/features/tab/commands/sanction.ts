import type { sanctionStatuses } from '@daisy/protocol/lobby';
import type {
  SanctionCommand,
  SanctionCommandRefusal,
} from '@daisy/protocol/lobby/sanction-command';
import { sanctionCheck } from '@daisy/protocol/sanction-check';
import { refuse, type CommandDecision } from './run-command';

/**
 * Sanction commands (TAB-5.12). A league sanctions an event once, against
 * one of its own templates and seasons, and only while the sanction check
 * passes, at the request and again at approval. The check is
 * `sanctionCheck`'s; this file only applies its yes or no.
 */

/** A `sanctions` row. */
export type SanctionRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly seasonId: string;
  readonly templateId: string;
  readonly status: (typeof sanctionStatuses)[number];
  readonly version: number;
};

type SanctionCheckInputs = Parameters<typeof sanctionCheck>;

export type RequestSanctionFacts = {
  readonly now: string;
  readonly mintedSanctionId: string;
  readonly event: { readonly id: string; readonly lobbyId: string };
  /** The `templates` row the request names, with the organization that owns it. */
  readonly template: { readonly id: string; readonly organizationId: string };
  /** The `seasons` row the request names, with its league. */
  readonly season: { readonly id: string; readonly organizationId: string };
  /** The sanction this league already has for this event, in any state. */
  readonly existing: SanctionRow | null;
  /** The template's pins and enforced values, and the event's resolved ones. */
  readonly check: {
    readonly template: SanctionCheckInputs[0];
    readonly event: SanctionCheckInputs[1];
  };
};

export type SettledSanctionFacts = {
  readonly now: string;
  readonly sanction: SanctionRow;
  /** The sanction check's inputs as they stand now, for approval. */
  readonly check: RequestSanctionFacts['check'];
  /** Whether any certification of the event exists. */
  readonly eventCertified: boolean;
};

export type SanctionWrite =
  | {
      readonly table: 'sanctions';
      readonly op: 'insert';
      readonly row: Omit<SanctionRow, 'status' | 'version'> & {
        readonly status: 'requested';
        readonly version: 1;
      };
    }
  | {
      readonly table: 'sanctions';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly status: Exclude<SanctionRow['status'], 'requested'>;
        readonly decidedAt?: string;
        readonly version: number;
        readonly updatedAt: string;
      };
    };

type SanctionRefusal = SanctionCommandRefusal | 'not-found';
type Command<Type extends SanctionCommand['type']> = Extract<
  SanctionCommand,
  { readonly type: Type }
>;

const passes = (check: RequestSanctionFacts['check']) =>
  sanctionCheck(check.template, check.event).passes;

export const decideRequestSanction = (
  facts: RequestSanctionFacts,
  command: Command<'request-sanction'>,
): CommandDecision<SanctionRefusal, SanctionWrite> => {
  if (
    command.eventId !== facts.event.id ||
    command.templateId !== facts.template.id ||
    command.seasonId !== facts.season.id
  )
    return refuse('not-found');
  if (facts.existing !== null) return refuse('already-requested');
  if (facts.template.organizationId !== command.leagueId)
    return refuse('template-foreign');
  if (facts.season.organizationId !== command.leagueId)
    return refuse('season-foreign');
  if (!passes(facts.check)) return refuse('template-mismatch');
  return {
    kind: 'accepted',
    aggregate: { kind: 'sanction', id: facts.mintedSanctionId },
    resultingVersion: 1,
    writes: [
      {
        table: 'sanctions',
        op: 'insert',
        row: {
          id: facts.mintedSanctionId,
          organizationId: command.leagueId,
          lobbyId: facts.event.lobbyId,
          eventId: facts.event.id,
          seasonId: facts.season.id,
          templateId: facts.template.id,
          status: 'requested',
          version: 1,
        },
      },
    ],
    findings: [],
    fixtureChanges: [],
  };
};

const settled = (
  facts: SettledSanctionFacts,
  status: Exclude<SanctionRow['status'], 'requested'>,
): CommandDecision<SanctionRefusal, SanctionWrite> => {
  const version = facts.sanction.version + 1;
  return {
    kind: 'accepted',
    aggregate: { kind: 'sanction', id: facts.sanction.id },
    resultingVersion: version,
    writes: [
      {
        table: 'sanctions',
        op: 'update',
        id: facts.sanction.id,
        set: {
          status,
          ...(status === 'withdrawn' ? {} : { decidedAt: facts.now }),
          version,
          updatedAt: facts.now,
        },
      },
    ],
    findings: [],
    fixtureChanges: [],
  };
};

/**
 * Approval runs the check again; approval gives the league no capability on
 * the lobby. A withdrawal is refused once the event has a certification.
 */
export const decideSettleSanction = (
  facts: SettledSanctionFacts,
  command: Command<
    'approve-sanction' | 'decline-sanction' | 'withdraw-sanction'
  >,
): CommandDecision<SanctionRefusal, SanctionWrite> => {
  if (command.sanctionId !== facts.sanction.id) return refuse('not-found');
  const { status } = facts.sanction;
  switch (command.type) {
    case 'approve-sanction':
      if (status !== 'requested') return refuse('sanction-settled');
      if (!passes(facts.check)) return refuse('template-mismatch');
      return settled(facts, 'approved');
    case 'decline-sanction':
      if (status !== 'requested') return refuse('sanction-settled');
      return settled(facts, 'declined');
    case 'withdraw-sanction':
      if (status !== 'requested' && status !== 'approved')
        return refuse('sanction-settled');
      if (facts.eventCertified) return refuse('results-certified');
      return settled(facts, 'withdrawn');
  }
};
