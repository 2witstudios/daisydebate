import { conflictWaiverAuthority } from './conflict-waiver-authority';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  FixturePeopleChanged,
  type TabStore,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import {
  commandReplay,
  type LobbyCommandAnswer,
} from '@daisy/protocol/lobby/command';
import {
  confirmationCommandEnvelopeSchema,
  type ConfirmationCommandRefusal,
} from '@daisy/protocol/lobby/confirmation-command';
import { CommandDenied } from '../commands/run-command';
import { fixtureAuthority } from './fixture-authority';
import { commandDigest } from '@daisy/digest';
import type { TabPrincipal } from '../tab-principal';

/** Request the addressed read's conflict waiver; no request itself confers access. */
export const requestConflictWaiver =
  (dependencies: {
    readonly store: Pick<TabStore, 'conflictWaiverRequest'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly newId: () => string;
  }) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
    body: unknown,
  ): Promise<LobbyCommandAnswer<ConfirmationCommandRefusal>> => {
    const parsed = confirmationCommandEnvelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      parsed.data.command.type !== 'request-conflict-waiver'
    )
      throw createAppError('VALIDATION');
    const { command } = parsed.data;
    try {
      const answer = await dependencies.store.conflictWaiverRequest(
        {
          senderUserId: principal.userId,
          lobbyId,
          fixtureId: command.fixtureId,
          commandId: parsed.data.commandId,
        },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) return { kind: 'denied' as const };
          const authority = conflictWaiverAuthority(
            fixtureAuthority(loaded, principal, loaded.checkedAt),
            command.capability,
            loaded.observedRound,
          );
          const decisionAt = (now: string) =>
            dependencies.authorize({
              ...authority,
              context: { ...authority.context, now },
              capability: command.capability,
            });
          const decision = decisionAt(loaded.checkedAt);
          // Replays retain their original finite deadline, after current authorization.
          if (!decision.allow && decision.reason !== 'confirmation-required') {
            if (decision.conflict)
              await session.recordConflict({
                conflict: decision.conflict,
                now: loaded.checkedAt,
                newId: dependencies.newId,
              });
            return { kind: 'denied' as const };
          }
          const payloadDigest = commandDigest({
            expected: parsed.data.expected,
            command,
          });
          const replay = commandReplay(
            await session.stored(parsed.data.commandId),
            { actorUserId: principal.userId, payloadDigest },
          );
          switch (replay.kind) {
            case 'replay':
              return { kind: 'accepted' as const, receipt: replay.receipt };
            case 'pending':
              return {
                kind: 'pending' as const,
                pendingCommandId: replay.pendingCommandId,
                expiresAt: replay.expiresAt,
              };
            case 'settled':
              return replay;
            case 'conflict':
              return {
                kind: 'refused' as const,
                refusal: 'command-conflict' as const,
              };
            case 'new':
              break;
          }
          const conflictId = decision.conflict
            ? await session.recordConflict({
                conflict: decision.conflict,
                now: loaded.checkedAt,
                newId: dependencies.newId,
              })
            : null;
          if (loaded.waiverId !== null)
            return {
              kind: 'refused' as const,
              refusal: 'waiver-exists' as const,
            };
          if (
            decision.allow ||
            decision.reason !== 'confirmation-required' ||
            conflictId === null
          )
            return {
              kind: 'refused' as const,
              refusal: 'handling-not-confirming' as const,
            };
          const held = await session.hold(
            {
              commandId: parsed.data.commandId,
              type: command.type,
              payload: command,
              payloadDigest,
              expected: parsed.data.expected,
              conflictId,
            },
            (now) => {
              const current = decisionAt(now);
              if (current.allow || current.reason !== 'confirmation-required')
                throw new CommandDenied('not-found');
            },
          );
          return { kind: 'pending' as const, ...held };
        },
      );
      // Keep a genuine denied-conflict observation while returning the public denial.
      if (answer.kind === 'denied') throw new CommandDenied('not-found');
      return answer;
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      if (
        error instanceof EventSettingParentsChanged ||
        error instanceof FixturePeopleChanged
      )
        throw createAppError('CONFLICT', 'Waiver target changed');
      throw error;
    }
  };
