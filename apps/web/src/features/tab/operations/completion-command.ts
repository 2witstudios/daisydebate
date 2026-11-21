import { completionCertification } from './completion-certification';
import { completionScreenings } from './completion-screenings';
import { eventResultsVersion } from './event-results-version';
import { z } from 'zod';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  type TabStore,
  type LoadedCompletionCommand,
  type CompletionWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema, ballotWrittenRecordSchema } from '@daisy/protocol';
import {
  resultCommandEnvelopeSchema,
  resultCommandCatalogue,
} from '@daisy/protocol/lobby/result-command';
import {
  breakCommandEnvelopeSchema,
  breakCommandCatalogue,
} from '@daisy/protocol/lobby/break-command';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { decideCertification, decideScreeningHold } from '../commands/result';
import { decideAnnounceBreak } from '../commands/break';
import { hostResultsAuthority } from './host-results-authority';
import { eventBreaks } from './event-breaks';
import { competitionReleases } from './competition-releases';
import { commandDigest } from '@daisy/digest';
import type { TabPrincipal } from '../tab-principal';

const envelopeSchema = z.union([
  breakCommandEnvelopeSchema,
  resultCommandEnvelopeSchema,
]);
const noFixtureConflict = (): never => {
  throw createAppError(
    'INVARIANT',
    'Event completion is not a fixture command',
  );
};

/** One event fence owns announcement, exact-source certification and recorded openings. */
export const completionCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'completionCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly newId: () => string;
  }) =>
  async (principal: TabPrincipal, lobbyId: string, body: unknown) => {
    const parsed = envelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      'fixtureId' in parsed.data.command
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command,
      definition =
        command.type === 'announce-break'
          ? breakCommandCatalogue[command.type]
          : resultCommandCatalogue[command.type];
    try {
      return await dependencies.store.completionCommand(
        {
          senderUserId: principal.userId,
          lobbyId,
          command,
          notificationIds: dependencies.newId,
        },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) throw new CommandDenied('not-found');
          const authority = hostResultsAuthority(
            loaded.competition,
            principal,
            loaded.checkedAt,
          );
          if (
            !definition.gate.some(
              (capability) =>
                dependencies.authorize({ ...authority, capability }).allow,
            )
          )
            throw new CommandDenied('not-found');
          return runLobbyCommand<
            typeof command,
            LoadedCompletionCommand,
            string,
            CompletionWrite
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => loaded.checkedAt,
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => loaded,
                  authority: () => authority,
                  versions: () => ({
                    results: eventResultsVersion(loaded.competition),
                  }),
                  scope: () => ({ kind: 'lobby', lobbyId }),
                  recordConflict: noFixtureConflict,
                  holdForConfirmation: noFixtureConflict,
                  apply: async (writes, history, receipt) => {
                    const clear = new Set(
                      writes.flatMap((write) =>
                        write.table === 'ballot_screenings'
                          ? [write.ballotId]
                          : [],
                      ),
                    );
                    const openings = competitionReleases({
                      competition: loaded.competition,
                      openings: loaded.releases,
                      screenings: completionScreenings(loaded).map((row) =>
                        clear.has(row.ballotId)
                          ? { ...row, status: 'clear' as const }
                          : row,
                      ),
                      announcingBreak: command.type === 'announce-break',
                      certifyingResultIds: writes.flatMap((write) =>
                        write.table === 'certification_results'
                          ? [write.row.resultId]
                          : [],
                      ),
                    });
                    await session.apply(
                      [
                        ...writes,
                        ...openings.map((opening): CompletionWrite => ({
                          table: 'releases',
                          op: 'insert',
                          row: {
                            ...opening,
                            id: dependencies.newId(),
                            lobbyId,
                            eventId: loaded.competition.configuration.event.id,
                            commandId: parsed.data.commandId,
                            openedAt: loaded.checkedAt,
                          },
                        })),
                      ],
                      history,
                      receipt,
                    );
                  },
                }),
            },
            { ...parsed.data, command },
            definition,
            (facts, requested) => {
              const competition = facts.competition;
              if (competition.configuration.lobby.closedAt !== null)
                return { kind: 'refused', refusal: 'lobby-closed' };
              if (requested.type === 'announce-break') {
                const computed = eventBreaks(competition);
                return decideAnnounceBreak(
                  {
                    eventId: competition.configuration.event.id,
                    resultsVersion: eventResultsVersion(facts.competition),
                    announcedAt:
                      competition.announcements[0]?.appliedAt.toISOString() ??
                      null,
                    qualification: !computed.complete
                      ? 'results-incomplete'
                      : computed.answer.kind === 'undecided'
                        ? 'choices-pending'
                        : computed.answer.stages.some(
                              (stage) => stage.bracket.seeds.length > 0,
                            )
                          ? 'ready'
                          : 'break-not-configured',
                  },
                  requested,
                );
              }
              if (requested.type === 'resolve-screening-hold') {
                const found = facts.submitted.find(
                    (row) => row.ballot.id === requested.ballotId,
                  ),
                  screening = completionScreenings(facts).find(
                    (row) => row.ballotId === requested.ballotId,
                  );
                if (!found || !screening)
                  return { kind: 'refused', refusal: 'not-found' };
                const originalWritten = ballotWrittenRecordSchema.parse({
                  ...(found.ballot.reason === null
                    ? {}
                    : { reason: found.ballot.reason }),
                  ...(found.ballot.feedback === null
                    ? {}
                    : { feedback: found.ballot.feedback }),
                });
                return decideScreeningHold(
                  {
                    now: loaded.checkedAt,
                    originalWritten,
                    screening,
                  },
                  requested,
                );
              }
              return decideCertification(
                {
                  commandId: parsed.data.commandId,
                  now: loaded.checkedAt,
                  mintedCertificationId: dependencies.newId(),
                  event: { id: competition.configuration.event.id, lobbyId },
                  resultsVersion: eventResultsVersion(facts.competition),
                  ...completionCertification(facts),
                },
                requested,
              );
            },
          );
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return {
          kind: 'refused' as const,
          refusal: 'command-conflict' as const,
        };
      if (error instanceof EventSettingParentsChanged)
        throw createAppError('CONFLICT', 'Event settings changed');
      throw error;
    }
  };
