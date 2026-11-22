import type { HostRoundFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { isRoundRunning, isRoundOver } from '@daisy/protocol/round';
import {
  tabRoundHostViewSchema,
  type TabRoundHostView,
  type TabRoundFixture,
} from '@daisy/protocol/lobby/tab-round-read';
import { eventSettingResolution } from '../operations/event-setting-resolution';
import { projectResultCompetition } from '../commands/result-projection';

/** Native Round/segment rows supply status. Tab never manufactures Ready or overdue clocks. */
export function hostRunningRoundView(
  facts: HostRoundFacts,
  drawId: string,
  officiate: boolean,
  viewerActorId: string | null,
): TabRoundHostView {
  const loaded = facts.draw;
  const ids = loaded.drawFixtures
    .filter((row) => row.drawId === drawId)
    .map((row) => row.fixtureId);
  const current = loaded.results.filter(
    (row) =>
      !loaded.results.some((other) => other.supersedesResultId === row.id),
  );
  const fixtures = ids.map((fixtureId): TabRoundFixture => {
    const fixture = loaded.fixtures.find((row) => row.id === fixtureId);
    if (!fixture) throw createAppError('INVARIANT', 'Draw fixture is missing');
    const native = loaded.roomRounds.find(
      (row) => row.roomId === fixture.roomId,
    );
    const room = loaded.rooms.find((row) => row.id === fixture.roomId);
    const result = current.find((row) => row.fixtureId === fixtureId);
    const entries = loaded.fixtureEntries
      .filter((row) => row.fixtureId === fixtureId)
      .sort((a, b) => a.position - b.position)
      .map((row) => {
        const entry = loaded.entries.find((one) => one.id === row.entryId);
        if (!entry)
          throw createAppError('INVARIANT', 'Fixture entry is missing');
        return { entryId: row.entryId, name: entry.name };
      });
    const judges = loaded.fixtureJudges
      .filter((row) => row.fixtureId === fixtureId)
      .map((row) => {
        const judge = loaded.judges.find(
          (judge) => judge.id === row.tournamentJudgeId,
        );
        if (!judge)
          throw createAppError('INVARIANT', 'Fixture judge is missing');
        return {
          tournamentJudgeId: judge.id,
          name:
            facts.people.find((person) => person.actorId === judge.actorId)
              ?.name ?? judge.actorId,
        };
      });
    let state: TabRoundFixture['state'];
    if (result) {
      const projection = projectResultCompetition(result.competitionRecord, {
        id: result.id,
        fixture: fixtureId,
        supersedes: result.supersedesResultId,
        certified: loaded.certified.some((row) => row.resultId === result.id),
      });
      if (projection.kind !== 'projected')
        throw createAppError(
          'INVARIANT',
          'Retained result cannot be projected',
        );
      const record = result.competitionRecord;
      state = {
        kind: 'finished',
        result:
          record.kind === 'administrative'
            ? {
                kind: 'administrative',
                corrected: result.supersedesResultId !== null,
                reason: record.reason,
              }
            : {
                kind: 'decided',
                corrected: result.supersedesResultId !== null,
                entries: projection.projection.entries.map((entry) => ({
                  entryId: entry.entryId,
                  won: entry.won,
                  rank: entry.rank,
                  points: null,
                })),
              },
      };
    } else if (fixture.kind === 'bye') state = { kind: 'awaiting_result' };
    else if (native && isRoundOver(native.status))
      state = { kind: 'awaiting_result' };
    else if (!native || native.startedAt === null)
      state = { kind: 'waiting_for_start' };
    else if (
      isRoundRunning(native.status) &&
      native.currentStage === 'awaiting_ballot'
    )
      state = {
        kind: 'judging',
        ballotsIn: loaded.submittedBallots.filter(
          (row) => row.roundId === native.id,
        ).length,
        ballotsDue: facts.judgeSlots.filter((row) => row.roundId === native.id)
          .length,
        openForMs: null,
      };
    else {
      const segment = facts.segments.find(
        (row) => row.roundId === native.id && row.endedAt === null,
      );
      const position = native.rulesSnapshot.segments.findIndex(
        (row) => row.key === segment?.rulesSegmentKey,
      );
      state =
        segment && position >= 0
          ? {
              kind: 'speaking',
              segment: position + 1,
              segmentCount: native.rulesSnapshot.segments.length,
              speaker: null,
            }
          : { kind: 'preparing' };
    }
    return {
      fixtureId,
      kind: fixture.kind,
      label: null,
      entries,
      room: room ? { roomId: room.id, name: room.title } : null,
      judges,
      conflict:
        entries.some((entry) =>
          loaded.members.some(
            (member) =>
              member.entryId === entry.entryId &&
              member.actorId === viewerActorId,
          ),
        ) ||
        loaded.judges.some(
          (judge) =>
            judge.actorId === viewerActorId &&
            loaded.strikes.some(
              (strike) =>
                strike.tournamentJudgeId === judge.id &&
                entries.some((entry) => entry.entryId === strike.entryId),
            ),
        ),
      state,
    };
  });
  const started = loaded.roomRounds
    .filter((row) =>
      loaded.fixtures.some(
        (fixture) => ids.includes(fixture.id) && fixture.roomId === row.roomId,
      ),
    )
    .flatMap((row) => (row.startedAt ? [row.startedAt.toISOString()] : []))
    .sort();
  const finished = fixtures.filter((row) => row.state.kind === 'finished');
  const next = loaded.rounds
    .filter(
      (row) =>
        row.eventId === loaded.round.eventId &&
        row.number > loaded.round.number,
    )
    .sort((a, b) => a.number - b.number)
    .find((round) =>
      loaded.versions.some(
        (draw) => draw.tabRoundId === round.id && draw.status === 'draft',
      ),
    );
  const { settings } = eventSettingResolution(loaded.configuration);
  const sections =
    loaded.configuration.definition.definition.outcome.kind === 'ranking' &&
    loaded.configuration.definition.definition.outcome.of === 'speakers';
  return tabRoundHostViewSchema.parse({
    lobbyId: loaded.configuration.lobby.id,
    eventId: loaded.configuration.event.id,
    tabRound: {
      tabRoundId: loaded.round.id,
      number: loaded.round.number,
      name: loaded.round.name,
    },
    fixtureKind: sections ? 'section' : 'pairing',
    fixtureCount: fixtures.length,
    entryCount: new Set(
      fixtures.flatMap((row) => row.entries.map((entry) => entry.entryId)),
    ).size,
    sectionSize: sections
      ? settings['pairing.section_size'].value.target
      : null,
    byeCountsAs: settings['bye.result'].value.value,
    startedAt: started[0] ?? null,
    progress:
      finished.length === fixtures.length && fixtures.length > 0
        ? { kind: 'complete' }
        : { kind: 'running', behindByMs: null },
    postedToParticipants: loaded.releases.some(
      (row) =>
        row.tabRoundId === loaded.round.id &&
        row.thing === 'posting' &&
        row.audience === 'participants',
    ),
    next: next
      ? { tabRoundId: next.id, number: next.number, name: next.name }
      : null,
    open: fixtures.filter((row) => row.state.kind !== 'finished'),
    finished: { total: finished.length, recent: finished },
    capabilities: { officiate },
  });
}
