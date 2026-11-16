import { lockStandingRoomSettingContext } from './tab/standing-room-setting-context';
import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  eventChain,
  roomChain,
  resolveSetting,
} from '@daisy/protocol/setting-resolution';
import { settingRowSchema, type SettingRow } from '@daisy/protocol/settings';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
import { rounds } from './schema/rounds';
import { rooms } from './schema/rooms';
import { scopeTransaction } from './tenant-scope';
import { fixtures } from './schema/fixtures';
import { fixtureRoomSources } from './schema/fixture-room-sources';
import { lockEventSettingContext } from './tab/event-setting-context';
import type { RoundWriteTransaction } from './round-write-authority';

/** Read after account fences and before the Round lock, matching event writers' parent order. */
export async function lockRoundBallotScreening(
  tx: RoundWriteTransaction,
  roundId: string,
) {
  const [room] = await tx
    .select({
      id: rooms.id,
      templateId: rooms.templateId,
      config: rooms.config,
      lobbyId: rooms.lobbyId,
      lobbyKind: rooms.lobbyKind,
    })
    .from(rounds)
    .innerJoin(rooms, eq(rooms.id, rounds.roomId))
    .where(eq(rounds.id, roundId));
  if (!room) throw createAppError('NOT_FOUND');
  await scopeTransaction(tx, { lobbyId: room.lobbyId });
  if (room.lobbyKind === 'standing') {
    const context = await lockStandingRoomSettingContext(tx, room);
    if (!context.lobby.ownerOrganizationId) throw createAppError('INVARIANT');
    const rows = screeningRows(context.rows);
    const config = room.config;
    return {
      lobbyId: room.lobbyId,
      policy: resolveSetting(
        'ballot.screening',
        roomChain({
          organizationId: context.lobby.ownerOrganizationId,
          templateId: room.templateId,
          lobbyId: room.lobbyId,
        }),
        rows,
        {
          'room.timing': {
            preRoundPrepMs: config.preRoundPrep.enabled
              ? config.preRoundPrep.durationMs
              : 0,
            inRoundPrepMsPerSide: config.inRoundPrep.enabled
              ? config.inRoundPrep.budgetMsPerSide
              : 0,
            countdownMs: config.speechTiming.countdownMs,
          },
          'room.floor': {
            interruptions: config.interruptions,
            yielding: config.yielding,
          },
        },
      ).value.value,
    };
  }
  const [source] = await tx
    .select({
      lobbyId: fixtures.lobbyId,
      eventId: fixtures.eventId,
    })
    .from(rounds)
    .innerJoin(fixtureRoomSources, eq(fixtureRoomSources.roomId, rounds.roomId))
    .innerJoin(
      fixtures,
      and(
        eq(fixtures.id, fixtureRoomSources.fixtureId),
        eq(fixtures.lobbyId, fixtureRoomSources.lobbyId),
      ),
    )
    .where(eq(rounds.id, roundId));
  if (!source)
    throw createAppError(
      'INVARIANT',
      'Event Round has no retained fixture source',
    );
  // A leased judge service has no human subject. Only the actual tenant is scoped;
  // submission authority is still checked by the Round owner under its own fences.
  const context = await lockEventSettingContext(tx, {
    ...source,
    strength: 'share',
  });
  if (!context)
    throw createAppError('INVARIANT', 'Ballot event source is missing');
  const rows = screeningRows(context.rows);
  const config = context.preset.config;
  const policy = resolveSetting(
    'ballot.screening',
    eventChain({
      template: context.template,
      leagueId: context.lobby.ownerOrganizationId,
      lobbyId: context.lobby.id,
      eventId: context.event.id,
    }),
    rows,
    {
      'room.timing': {
        preRoundPrepMs: config.preRoundPrep.enabled
          ? config.preRoundPrep.durationMs
          : 0,
        inRoundPrepMsPerSide: config.inRoundPrep.enabled
          ? config.inRoundPrep.budgetMsPerSide
          : 0,
        countdownMs: config.speechTiming.countdownMs,
      },
      'room.floor': {
        interruptions: config.interruptions,
        yielding: config.yielding,
      },
    },
  ).value;
  return { lobbyId: source.lobbyId, policy: policy.value };
}

function screeningRows(
  rows: Awaited<ReturnType<typeof lockStandingRoomSettingContext>>['rows'],
): SettingRow<'ballot.screening'>[] {
  return rows
    .filter((row) => row.key === 'ballot.screening')
    .map((row) => {
      const parsed = settingRowSchema.parse({
        scope: {
          kind: row.scopeKind,
          id: {
            organization: row.organizationId,
            template: row.templateId,
            lobby: row.lobbyId,
            event: row.eventId,
          }[row.scopeKind],
        },
        key: row.key,
        hold: row.hold,
        value: row.value,
      });
      return {
        ...parsed,
        key: 'ballot.screening',
        value: settingValueSchemas['ballot.screening'].parse(parsed.value),
      };
    });
}
