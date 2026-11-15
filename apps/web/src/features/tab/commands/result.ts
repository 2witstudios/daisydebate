import type { ReleaseAudience } from '@daisy/protocol/release-audience';
import { releaseAudiences } from '@daisy/protocol/release-audience';
import type {
  audiences,
  ballotScreeningStatuses,
  releaseThings,
} from '@daisy/protocol/lobby';
import type {
  ReleaseCommand,
  ReleaseCommandRefusal,
  ResultCommand,
  ResultCommandRefusal,
} from '@daisy/protocol/lobby/result-command';
import type { SettingValues } from '@daisy/protocol/setting-values';
import { fixtureStateOf, type FixtureRecord, type ResultRow } from './fixture';
import { refuse, type CommandDecision } from './run-command';
import {
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from '@daisy/protocol/lobby/result-record';
import { replaceResultCompetitionRecord } from '@daisy/protocol/lobby/result-record-correction';
import {
  resultCompetitionWrites,
  type CompetitionWrite,
} from './result-competition-writes';

/**
 * Ballot, result and release commands (TAB-5.12). A result command writes
 * exactly one `results` row (with its `result_entries`); a correction is a
 * new row naming the one it supersedes, which stays. Nothing here updates or
 * deletes a result, touches a draw, or recomputes anything.
 */

type Command<Type extends ResultCommand['type']> = Extract<
  ResultCommand,
  { readonly type: Type }
>;

const isBlank = (text: string) => text.trim().length === 0;

// ---- Recording and correcting one fixture's result -------------------------

export type FixtureResultFacts = FixtureRecord & {
  readonly commandId: string;
  readonly now: string;
  readonly mintedResultId: string;
};
export type FixtureResultWrite = CompetitionWrite;
type FixtureResultRefusal = ResultCommandRefusal | 'not-found';

const supersededIds = (results: readonly ResultRow[]): ReadonlySet<string> =>
  new Set(
    results.flatMap((result) =>
      result.supersedesResultId === null ? [] : [result.supersedesResultId],
    ),
  );

const recorded = (
  facts: FixtureResultFacts,
  record: ResultCompetitionRecord,
  supersedes: string | null,
  reason: string | null,
): CommandDecision<FixtureResultRefusal, FixtureResultWrite> => {
  const id = facts.mintedResultId;
  const answer = resultCompetitionWrites(
    facts,
    { id, commandId: facts.commandId, now: facts.now, supersedes, reason },
    record,
  );
  return answer.kind === 'refused'
    ? refuse(answer.refusal)
    : {
        kind: 'accepted',
        aggregate: { kind: 'result', id },
        resultingVersion: 1,
        writes: answer.writes,
        findings: [],
        fixtureChanges: [],
      };
};

export const decideFixtureResult = (
  facts: FixtureResultFacts,
  command: Command<
    'record-decided-result' | 'record-administrative-result' | 'correct-result'
  >,
): CommandDecision<FixtureResultRefusal, FixtureResultWrite> => {
  if (command.fixtureId !== facts.fixture.id) return refuse('not-found');
  const state = fixtureStateOf(facts);
  if (state === 'withdrawn') return refuse('fixture-withdrawn');
  switch (command.type) {
    case 'record-decided-result': {
      if (state === 'draft') return refuse('fixture-unpublished');
      if (state === 'has_result') return refuse('result-exists');
      if (
        !facts.completedCompetition ||
        facts.completedCompetition.source.roundId !== facts.round?.id
      )
        return refuse('submission-provenance-unavailable');
      return recorded(facts, facts.completedCompetition, null, null);
    }
    case 'record-administrative-result': {
      if (state === 'draft') return refuse('fixture-unpublished');
      if (state === 'has_result') return refuse('result-exists');
      if (isBlank(command.reason)) return refuse('reason-required');
      const parsed = resultCompetitionRecordSchema.safeParse({
        ...facts.administrativeContext,
        version: 1,
        kind: 'administrative',
        reason: command.administrativeReason,
        awards: command.awards,
      });
      return parsed.success
        ? recorded(facts, parsed.data, null, null)
        : refuse('outcome-mismatch');
    }
    case 'correct-result': {
      const superseded = facts.results.find(
        (result) => result.id === command.supersedesResultId,
      );
      if (!superseded) return refuse('result-not-in-fixture');
      if (supersededIds(facts.results).has(superseded.id))
        return refuse('already-superseded');
      if (isBlank(command.reason)) return refuse('reason-required');
      // Only the retained predecessor chain can restore original submission provenance.
      let cursor: ResultRow | undefined = superseded;
      let original:
        Extract<ResultCompetitionRecord, { kind: 'decided' }> | undefined;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        if (cursor.competitionRecord.kind === 'decided')
          original = cursor.competitionRecord;
        const parentId: string | null = cursor.supersedesResultId;
        cursor =
          parentId === null
            ? undefined
            : facts.results.find((row) => row.id === parentId);
      }
      const answer = replaceResultCompetitionRecord(
        superseded.competitionRecord,
        command.replacement,
        original,
      );
      return answer.kind === 'refused'
        ? refuse(answer.refusal)
        : recorded(facts, answer.record, superseded.id, command.reason);
    }
  }
};

// ---- Certifying ------------------------------------------------------------

/** A `ballot_screenings` row with the Round its ballot belongs to. */
type ScreeningRow = {
  readonly ballotId: string;
  readonly roundId: string;
  readonly tabRoundId: string;
  readonly status: (typeof ballotScreeningStatuses)[number];
};

export type CertificationFacts = {
  readonly commandId: string;
  readonly now: string;
  readonly mintedCertificationId: string;
  readonly event: { readonly id: string; readonly lobbyId: string };
  /** The event's results version, which a certification checks and keeps. */
  readonly resultsVersion: number;
  /** The event's published fixtures (a withdrawn one needs no result). */
  readonly publishedFixtureIds: readonly string[];
  readonly results: readonly (ResultRow & { readonly fixtureId: string })[];
  /** Every result id some `certification_results` row of the event names. */
  readonly certifiedResultIds: readonly string[];
  readonly screenings: readonly ScreeningRow[];
};
export type CertificationWrite =
  | {
      readonly table: 'certifications';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly lobbyId: string;
        readonly eventId: string;
        readonly scope: 'result' | 'event';
        readonly commandId: string;
        readonly certifiedAt: string;
      };
    }
  | {
      readonly table: 'certification_results';
      readonly op: 'insert';
      readonly row: {
        readonly certificationId: string;
        readonly resultId: string;
        readonly eventId: string;
        readonly lobbyId: string;
      };
    };
type CertificationRefusal = ResultCommandRefusal | 'not-found';

/** A ballot whose text is still being screened, or held back, blocks certifying. */
const screeningOpen = (screening: ScreeningRow) => screening.status !== 'clear';

const certified = (
  facts: CertificationFacts,
  scope: 'result' | 'event',
  aggregate: { readonly kind: 'result' | 'event'; readonly id: string },
  resultIds: readonly string[],
): CommandDecision<CertificationRefusal, CertificationWrite> => {
  const certificationId = facts.mintedCertificationId;
  const { event } = facts;
  return {
    kind: 'accepted',
    aggregate,
    resultingVersion: facts.resultsVersion,
    writes: [
      {
        table: 'certifications',
        op: 'insert',
        row: {
          id: certificationId,
          lobbyId: event.lobbyId,
          eventId: event.id,
          scope,
          commandId: facts.commandId,
          certifiedAt: facts.now,
        },
      },
      ...resultIds.map(
        (resultId) =>
          ({
            table: 'certification_results',
            op: 'insert',
            row: {
              certificationId,
              resultId,
              eventId: event.id,
              lobbyId: event.lobbyId,
            },
          }) as const,
      ),
    ],
    findings: [],
    fixtureChanges: [],
  };
};

export const decideCertification = (
  facts: CertificationFacts,
  command: Command<'certify-result' | 'certify-event'>,
): CommandDecision<CertificationRefusal, CertificationWrite> => {
  const superseded = supersededIds(facts.results);
  const current = facts.results.filter((result) => !superseded.has(result.id));
  const certifiedIds = new Set(facts.certifiedResultIds);
  const screeningPending = (results: readonly ResultRow[]) =>
    facts.screenings.some(
      (screening) =>
        screeningOpen(screening) &&
        results.some((result) => result.roundId === screening.roundId),
    );
  switch (command.type) {
    case 'certify-result': {
      const result = facts.results.find((row) => row.id === command.resultId);
      if (result === undefined) return refuse('not-found');
      if (superseded.has(result.id)) return refuse('already-superseded');
      if (certifiedIds.has(result.id)) return refuse('already-certified');
      if (screeningPending([result])) return refuse('screening-pending');
      return certified(facts, 'result', { kind: 'result', id: result.id }, [
        result.id,
      ]);
    }
    case 'certify-event': {
      if (command.eventId !== facts.event.id) return refuse('not-found');
      if (
        facts.publishedFixtureIds.some(
          (fixtureId) =>
            !current.some((result) => result.fixtureId === fixtureId),
        )
      )
        return refuse('results-incomplete');
      if (current.every((result) => certifiedIds.has(result.id)))
        return refuse('already-certified');
      if (screeningPending(current)) return refuse('screening-pending');
      return certified(
        facts,
        'event',
        { kind: 'event', id: facts.event.id },
        current.map((result) => result.id),
      );
    }
  }
};

// ---- Screening holds -------------------------------------------------------

export type ScreeningHoldFacts = {
  readonly screening: ScreeningRow;
  readonly now: string;
};
export type ScreeningHoldWrite = {
  readonly table: 'ballot_screenings';
  readonly op: 'update';
  readonly ballotId: string;
  /** `releasedText` null releases the ballot's own text. */
  readonly set: {
    readonly status: 'clear';
    readonly releasedText: Readonly<Record<string, string>> | null;
    readonly updatedAt: string;
  };
};

export const decideScreeningHold = (
  facts: ScreeningHoldFacts,
  command: Command<'resolve-screening-hold'>,
): CommandDecision<ResultCommandRefusal | 'not-found', ScreeningHoldWrite> => {
  if (command.ballotId !== facts.screening.ballotId) return refuse('not-found');
  switch (facts.screening.status) {
    case 'pending':
      return refuse('screening-pending');
    case 'clear':
      return refuse('hold-settled');
    case 'held':
      return {
        kind: 'accepted',
        aggregate: { kind: 'ballot', id: command.ballotId },
        resultingVersion: 1,
        writes: [
          {
            table: 'ballot_screenings',
            op: 'update',
            ballotId: command.ballotId,
            set: {
              status: 'clear',
              releasedText:
                command.release.kind === 'redacted'
                  ? command.release.text
                  : null,
              updatedAt: facts.now,
            },
          },
        ],
        findings: [],
        fixtureChanges: [],
      };
  }
};

// ---- Releases --------------------------------------------------------------

type Release<Type extends ReleaseCommand['type']> = Extract<
  ReleaseCommand,
  { readonly type: Type }
>;
type ReleaseRow = {
  readonly tabRoundId: string;
  readonly thing: (typeof releaseThings)[number];
  readonly audience: (typeof audiences)[number];
};

export type OpenAudienceFacts = {
  readonly commandId: string;
  readonly now: string;
  readonly event: { readonly id: string; readonly lobbyId: string };
  /** The event's tab rounds, each with an id minted for the release it may get. */
  readonly tabRounds: readonly {
    readonly id: string;
    readonly mintedReleaseId: string;
  }[];
  /** The resolved `audience.<thing>` value for the command's thing. */
  readonly whens: SettingValues['audience.posting'];
  readonly releases: readonly ReleaseRow[];
  readonly screenings: readonly ScreeningRow[];
};
export type ReleaseWrite =
  | {
      readonly table: 'releases';
      readonly op: 'insert';
      readonly row: ReleaseRow & {
        readonly id: string;
        readonly lobbyId: string;
        readonly eventId: string;
        readonly cause: 'manual';
        readonly commandId: string;
        readonly openedAt: string;
      };
    }
  | {
      readonly table: 'tab_rounds';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly poolResolutionId: string;
        readonly resolutionReleasedAt: string;
        readonly version: number;
      };
    };
type ReleaseRefusal = ReleaseCommandRefusal | 'not-found';

/** The things a screening may hold back: a ballot's own text. */
const screenedThings: ReadonlySet<ReleaseRow['thing']> = new Set([
  'reason',
  'feedback',
]);

const narrowerThan = (audience: ReleaseAudience): readonly ReleaseAudience[] =>
  releaseAudiences.slice(0, releaseAudiences.indexOf(audience));

export const decideOpenAudience = (
  facts: OpenAudienceFacts,
  command: Release<'open-audience'>,
): CommandDecision<ReleaseRefusal, ReleaseWrite> => {
  if (command.eventId !== facts.event.id) return refuse('not-found');
  const targets =
    command.tabRounds.kind === 'all'
      ? facts.tabRounds
      : facts.tabRounds.filter(
          (round) =>
            command.tabRounds.kind === 'one' &&
            round.id === command.tabRounds.tabRoundId,
        );
  if (targets.length === 0) return refuse('not-found');
  if (facts.whens[command.audience] !== 'manual') return refuse('not-manual');
  const isOpen = (tabRoundId: string, audience: ReleaseAudience) =>
    facts.releases.some(
      (release) =>
        release.tabRoundId === tabRoundId &&
        release.thing === command.thing &&
        release.audience === audience,
    );
  const toOpen = targets.filter((round) => !isOpen(round.id, command.audience));
  if (toOpen.length === 0) return refuse('already-open');
  if (
    toOpen.some((round) =>
      narrowerThan(command.audience).some(
        (audience) => !isOpen(round.id, audience),
      ),
    )
  )
    return refuse('audience-order');
  if (
    screenedThings.has(command.thing) &&
    facts.screenings.some(
      (screening) =>
        screeningOpen(screening) &&
        toOpen.some((round) => round.id === screening.tabRoundId),
    )
  )
    return refuse('screening-pending');
  return {
    kind: 'accepted',
    aggregate: { kind: 'release', id: facts.event.id },
    resultingVersion: facts.releases.length + toOpen.length,
    writes: toOpen.map((round) => ({
      table: 'releases',
      op: 'insert',
      row: {
        id: round.mintedReleaseId,
        lobbyId: facts.event.lobbyId,
        eventId: facts.event.id,
        tabRoundId: round.id,
        thing: command.thing,
        audience: command.audience,
        cause: 'manual',
        commandId: facts.commandId,
        openedAt: facts.now,
      },
    })),
    findings: [],
    fixtureChanges: [],
  };
};

export type ReleaseResolutionFacts = {
  readonly now: string;
  /** The `tab_rounds` row. */
  readonly tabRound: {
    readonly id: string;
    readonly eventId: string;
    readonly poolResolutionId: string | null;
    readonly resolutionReleasedAt: string | null;
    readonly version: number;
  };
  /** The event's resolved `resolution.rule`. */
  readonly rule: SettingValues['resolution.rule'];
  /** A wording drawn from the tab round's pool at the edge; null when it is empty. */
  readonly drawnPoolResolutionId: string | null;
};

/** Where the rule releases by hand: names the wording (drawing it first under `draw`). */
const wordingToRelease = (
  facts: ReleaseResolutionFacts,
):
  | { readonly kind: 'refused'; readonly refusal: ReleaseRefusal }
  | {
      readonly kind: 'wording';
      readonly poolResolutionId: string;
    } => {
  const { rule, tabRound } = facts;
  switch (rule.method) {
    case 'strike':
      return refuse('not-manual');
    case 'fixed':
    case 'draw': {
      if (rule.release !== 'manual') return refuse('not-manual');
      const wording =
        tabRound.poolResolutionId ??
        (rule.method === 'draw' ? facts.drawnPoolResolutionId : null);
      return wording === null
        ? refuse('resolution-unset')
        : { kind: 'wording', poolResolutionId: wording };
    }
  }
};

export const decideReleaseResolution = (
  facts: ReleaseResolutionFacts,
  command: Release<'release-resolution'>,
): CommandDecision<ReleaseRefusal, ReleaseWrite> => {
  const { tabRound } = facts;
  if (command.tabRoundId !== tabRound.id) return refuse('not-found');
  if (tabRound.resolutionReleasedAt !== null) return refuse('already-released');
  const wording = wordingToRelease(facts);
  if (wording.kind === 'refused') return wording;
  const version = tabRound.version + 1;
  return {
    kind: 'accepted',
    aggregate: { kind: 'release', id: tabRound.id },
    resultingVersion: version,
    writes: [
      {
        table: 'tab_rounds',
        op: 'update',
        id: tabRound.id,
        set: {
          poolResolutionId: wording.poolResolutionId,
          resolutionReleasedAt: facts.now,
          version,
        },
      },
    ],
    findings: [],
    fixtureChanges: [],
  };
};
