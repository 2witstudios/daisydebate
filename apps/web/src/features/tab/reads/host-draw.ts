import type { Assessment, FixtureRef } from '@daisy/tab-engine';
import type { HostRoundFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { pairingRecords } from '@daisy/tab-engine';
import { settingsCatalogue } from '@daisy/protocol/settings';
import { drawViewSchema, type DrawView } from '@daisy/protocol/lobby/draw-read';
import { eventDrawFacts } from '../operations/draw-facts';
import { drawCompetitionAt } from '../operations/draw-competition';
import { eventCompetition } from '../operations/event-competition';
import { drawVersionAssessmentInput } from '../commands/draw';
import { tabEngine } from '../operations/tab-engine';

/** Retained draw inputs name the exact records; later corrections do not reseed this view. */
export function hostDrawView(
  facts: HostRoundFacts,
  drawId: string,
  capabilities: DrawView['capabilities'],
): DrawView {
  const loaded = facts.draw;
  const context = eventDrawFacts(loaded, drawCompetitionAt(loaded, drawId));
  const stored = loaded.versions.find((row) => row.id === drawId)!;
  const draw = context.versions.find((row) => row.id === drawId);
  if (!draw) throw createAppError('INVARIANT', 'Addressed draw is missing');
  const sources = new Set(
    loaded.drawResultInputs
      .filter((row) => row.drawId === drawId)
      .map((row) => row.resultId),
  );
  const engineInput = draw.inputs.engine;
  const seed = Uint8Array.from(
    (engineInput?.seed ?? '').match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
  const retained = eventCompetition(
    {
      ...loaded,
      entries: loaded.entries.filter((row) => row.eventId === context.event.id),
      results: loaded.results.filter((row) => sources.has(row.id)),
    },
    {
      stageIds: [loaded.round.stageId],
      cutoff: engineInput?.cutoff ?? 0,
      division: null,
      seed,
    },
  );
  const rawSettings = engineInput?.settings;
  const frozen =
    typeof rawSettings === 'object' &&
    rawSettings !== null &&
    !Array.isArray(rawSettings)
      ? rawSettings
      : {};
  const settings = {
    ...retained.settings,
    'bye.result': engineInput
      ? settingsCatalogue['bye.result'].value.parse(
          'bye.result' in frozen ? frozen['bye.result'] : undefined,
        )
      : retained.settings['bye.result'],
  };
  const records = pairingRecords(
    { ...retained, settings },
    seed,
    engineInput?.cutoff ?? 0,
  );
  const prepared = drawVersionAssessmentInput(context, draw);
  const assessment = prepared
    ? tabEngine.assess(prepared.input, prepared.plans)[0]
    : undefined;
  const draftIds = draw.fixtureIds.filter(
    (id) => context.fixtures.find((row) => row.id === id)?.status === 'draft',
  );
  const fixtures = draw.fixtureIds.map(
    (fixtureId): DrawView['recordGroups'][number]['fixtures'][number] => {
      const fixture = context.fixtures.find((row) => row.id === fixtureId);
      if (!fixture)
        throw createAppError('INVARIANT', 'Draw fixture is missing');
      return {
        fixtureId,
        kind: fixture.kind,
        status: fixture.status,
        entries: [...fixture.entries]
          .sort((a, b) => a.position - b.position)
          .map((entry) => {
            const stored = loaded.entries.find(
              (row) => row.id === entry.entryId,
            )!;
            return {
              entryId: stored.id,
              name: stored.name,
              side: entry.side,
              school:
                facts.schools.find(
                  (row) => row.id === stored.schoolOrganizationId,
                )?.name ?? null,
            };
          }),
        judges: fixture.judges.map((judge) => ({
          tournamentJudgeId: judge.tournamentJudgeId,
          name:
            facts.people.find((row) => row.actorId === judge.person)?.name ??
            judge.person,
          chair: judge.chair,
        })),
        findings: hostDrawFixtureFindings(
          assessment,
          fixture.status === 'draft'
            ? { kind: 'new', ordinal: draftIds.indexOf(fixtureId) }
            : { kind: 'existing', id: fixtureId },
        ),
        reasons: [],
        alternative: null,
      };
    },
  );
  const groups: DrawView['recordGroups'] = [];
  for (const fixture of fixtures) {
    const record = fixture.entries
      .map((entry) =>
        records.entries.find((row) => row.entry === entry.entryId),
      )
      .filter((row) => row !== undefined)
      .sort((a, b) => b.scaled - a.scaled)[0];
    if (!record)
      throw createAppError('INVARIANT', 'Draw entry has no pairing record');
    const group = groups.find(
      (group) =>
        group.record.value.n * record.value.d ===
        record.value.n * group.record.value.d,
    );
    if (group) group.fixtures.push(fixture);
    else
      groups.push({
        record: { label: records.label, value: record.value },
        fixtures: [fixture],
      });
  }
  groups.sort(
    (a, b) =>
      b.record.value.n / b.record.value.d - a.record.value.n / a.record.value.d,
  );
  const seated = new Set(
    fixtures.flatMap((row) =>
      row.judges.map((judge) => judge.tournamentJudgeId),
    ),
  );
  const basedOn = context.versions.find((row) => row.id === draw.basedOnDrawId);
  return drawViewSchema.parse({
    lobbyId: loaded.configuration.lobby.id,
    eventId: context.event.id,
    tabRound: { tabRoundId: loaded.round.id, number: loaded.round.number },
    draw: {
      drawId: draw.id,
      version: draw.version,
      status: draw.status,
      method: stored.method,
      publishedAt: stored.publishedAt?.toISOString() ?? null,
      basedOn: basedOn
        ? { drawId: basedOn.id, version: basedOn.version }
        : null,
    },
    sides: context.event.sideNames ?? [],
    resultsThroughRound:
      engineInput && engineInput.cutoff > 0 ? engineInput.cutoff : null,
    recordGroups: groups,
    spareJudges: context.engine.judges
      .filter((judge) => judge.available && !seated.has(judge.id))
      .map((judge) => ({
        tournamentJudgeId: judge.id,
        name:
          facts.people.find((row) => row.actorId === judge.person)?.name ??
          judge.person,
      })),
    capabilities,
  });
}

export function hostDrawFixtureFindings(
  assessment: Pick<Assessment, 'fixtures' | 'broken' | 'warnings'> | undefined,
  ref: FixtureRef,
): DrawView['recordGroups'][number]['fixtures'][number]['findings'] {
  const same = (other: FixtureRef) =>
    other.kind === ref.kind &&
    (other.kind === 'existing' && ref.kind === 'existing'
      ? other.id === ref.id
      : other.kind === 'new' &&
        ref.kind === 'new' &&
        other.ordinal === ref.ordinal);
  return [
    ...(assessment?.broken ?? [])
      .filter((row) => same(row.fixture))
      .map((row) => ({ severity: 'rule_broken' as const, text: row.key })),
    ...(assessment?.warnings ?? [])
      .filter((row) => same(row.fixture))
      .map((row) => ({ severity: 'note' as const, text: row.key })),
    ...(assessment?.fixtures ?? [])
      .filter((row) => same(row.fixture))
      .flatMap((row) =>
        row.terms
          .filter(
            (term) =>
              term.force === 'preference' &&
              term.cost.some((value) => value > 0),
          )
          .map((term) => ({
            severity: 'preference_bent' as const,
            text: term.key,
          })),
      ),
  ];
}
