import { hostResultStages } from './host-result-stages';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import type { HostResultsFacts, TabStore } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { audiences } from '@daisy/protocol/lobby';
import {
  hostResultsViewSchema,
  type HostResultsView,
  type AudienceOpenings,
} from '@daisy/protocol/lobby/results-read';
import {
  assessEventCertification,
  assessAudienceOpening,
} from '../commands/result';
import { completionCertification } from '../operations/completion-certification';
import { completionScreenings } from '../operations/completion-screenings';
import { eventResultsVersion } from '../operations/event-results-version';
import { eventSettingResolution } from '../operations/event-setting-resolution';
import { hostResultsAuthority } from '../operations/host-results-authority';
import type { TabPrincipal } from '../tab-principal';

/** The earliest actual instant at which certificates covered every named retained source. */
function certifiedAt(
  facts: HostResultsFacts,
  resultIds: readonly string[],
): string | null {
  if (resultIds.length === 0) return null;
  const times = resultIds.map(
    (id) =>
      facts.competition.certified
        .filter((row) => row.resultId === id)
        .flatMap((row) =>
          facts.competition.certifications
            .filter((certificate) => certificate.id === row.certificationId)
            .map((certificate) => certificate.certifiedAt.toISOString()),
        )
        .sort()[0],
  );
  return times.every((time): time is string => time !== undefined)
    ? times.sort().at(-1)!
    : null;
}

function hostResultsView(
  facts: HostResultsFacts,
  capabilities: { readonly release: boolean; readonly certify: boolean },
  viewerUserId: string,
): HostResultsView {
  const competition = facts.competition;
  const assessment = assessEventCertification(completionCertification(facts));
  const at =
    assessment.kind === 'already-certified'
      ? certifiedAt(facts, assessment.resultIds)
      : null;
  if (assessment.kind === 'already-certified' && !at)
    throw createAppError(
      'INVARIANT',
      'Certified sources lost their certificate',
    );
  const preliminary = competition.rounds.filter((round) =>
    competition.stages.some(
      (stage) => stage.kind === 'preliminary' && stage.id === round.stageId,
    ),
  );
  const prelimFixtures = competition.fixtures.filter(
    (fixture) =>
      fixture.status === 'published' &&
      preliminary.some((round) => round.id === fixture.tabRoundId),
  );
  const completePrelims =
    preliminary.length > 0 &&
    preliminary.every((round) =>
      prelimFixtures.some((fixture) => fixture.tabRoundId === round.id),
    );
  // Earlier certificates retain the historical preliminary snapshot even after a correction.
  const prelimsCertifiedAt = completePrelims
    ? (competition.certifications
        .map((certificate) => certificate.certifiedAt.toISOString())
        .sort()
        .find((time) =>
          prelimFixtures.every((fixture) =>
            competition.results.some(
              (result) =>
                result.fixtureId === fixture.id &&
                result.recordedAt.toISOString() <= time &&
                (certifiedAt(facts, [result.id]) ?? '\uffff') <= time,
            ),
          ),
        ) ?? null)
    : null;
  const { settings } = eventSettingResolution(competition.configuration);
  const screening = completionScreenings(facts);
  const audienceRows: AudienceOpenings[] = competition.rounds.flatMap((round) =>
    audiences.flatMap((audience) => {
      const openings: AudienceOpenings['openings'] = (
        ['decision', 'scores', 'reason', 'feedback'] as const
      ).flatMap<AudienceOpenings['openings'][number]>((part) => {
        const row = facts.releases.find(
          (one) =>
            one.tabRoundId === round.id &&
            one.thing === part &&
            one.audience === audience,
        );
        if (row)
          return [
            {
              part,
              state: {
                kind: 'open' as const,
                cause: row.cause,
                openedAt: row.openedAt.toISOString(),
              },
            },
          ];
        const opening = assessAudienceOpening(
          {
            whens: settings[`audience.${part}`].value,
            releases: facts.releases,
            screenings: screening,
          },
          { thing: part, audience },
          [round.id],
        );
        return opening.kind === 'ready'
          ? [{ part, state: { kind: 'openable' as const } }]
          : [];
      });
      return openings.length
        ? [
            {
              tabRoundId: round.id,
              tabRoundName: round.name ?? `Round ${round.number}`,
              audience,
              openings,
            },
          ]
        : [];
    }),
  );
  const person = (userId: string | null) => {
    const found = facts.people.find((one) => one.userId === userId);
    if (!found?.username)
      throw createAppError(
        'INVARIANT',
        'Result audit lost its competitive identity',
      );
    return { actorId: found.actorId, name: found.username };
  };
  return hostResultsViewSchema.parse({
    results: {
      lobbyId: competition.configuration.lobby.id,
      eventId: competition.configuration.event.id,
      resultsVersion: eventResultsVersion(competition),
      prelimsCertifiedAt,
      certification:
        assessment.kind === 'already-certified'
          ? { kind: 'certified', certifiedAt: at }
          : assessment.kind === 'ready'
            ? { kind: 'ready' }
            : { kind: 'waiting', reason: assessment.kind },
      audiences: audienceRows,
      // Per-Round ballot authority owns private words and holds; a Results-area grant exposes neither.
      ballotAccess: 'released',
      capabilities,
      sanctions: facts.sanctions.map((sanction) => ({
        organizationName: sanction.organizationName,
        sentAt: at,
      })),
      corrections:
        prelimsCertifiedAt === null
          ? []
          : competition.results
              .filter(
                (row) =>
                  row.supersedesResultId !== null &&
                  row.recordedAt.toISOString() > prelimsCertifiedAt,
              )
              .map((row) => {
                const audit = facts.history.find(
                  (one) => one.commandId === row.commandId,
                );
                if (!audit)
                  throw createAppError(
                    'INVARIANT',
                    'Result correction lost its audit',
                  );
                const round = competition.rounds.find(
                  (one) => one.id === row.tabRoundId,
                )!;
                return {
                  resultId: row.id,
                  supersedesResultId: row.supersedesResultId,
                  tabRoundNumber: round.number,
                  fixture: {
                    fixtureId: row.fixtureId,
                    entries: competition.fixtureEntries
                      .filter((one) => one.fixtureId === row.fixtureId)
                      .sort((a, b) => a.position - b.position)
                      .map((one) => ({
                        entryId: one.entryId,
                        name: competition.entries.find(
                          (entry) => entry.id === one.entryId,
                        )!.name,
                      })),
                  },
                  changed: 'record',
                  recordedBy: person(audit.actorUserId),
                  confirmedBy:
                    audit.confirmedByUserId === null
                      ? null
                      : {
                          ...person(audit.confirmedByUserId),
                          viewer: audit.confirmedByUserId === viewerUserId,
                        },
                  recordedAt: row.recordedAt.toISOString(),
                  usedByPublishedDraws: facts.drawInputs
                    .filter(
                      (one) =>
                        one.resultId === row.supersedesResultId &&
                        competition.draws.some(
                          (draw) =>
                            draw.id === one.drawId &&
                            draw.status === 'published',
                        ),
                    )
                    .map((one) => ({
                      drawId: one.drawId,
                      tabRoundNumber: competition.rounds.find(
                        (round) => round.id === one.tabRoundId,
                      )!.number,
                    })),
                };
              }),
    },
    stages: hostResultStages(facts),
  });
}

export const readHostResults =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostResults'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ): Promise<HostResultsView | null> => {
    if (
      !idSchema.safeParse(input.lobbyId).success ||
      !idSchema.safeParse(input.eventId).success
    )
      return null;
    return dependencies.store.hostResults(
      { ...input, viewerUserId: principal.userId },
      async (facts) => {
        if (!facts) return null;
        const authority = hostResultsAuthority(
          facts.competition,
          principal,
          facts.checkedAt,
        );
        const ask = (capability: AuthorizationInput['capability']) =>
          dependencies.authorize({ ...authority, capability }).allow;
        if (!ask('lobby.host.results.read')) return null;
        return hostResultsView(
          facts,
          {
            release: ask('tournament.results.release'),
            certify: ask('tournament.results.release'),
          },
          principal.userId,
        );
      },
    );
  };
