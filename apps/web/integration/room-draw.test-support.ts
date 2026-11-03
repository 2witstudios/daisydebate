import { createId } from '@paralleldrive/cuid2';
import { isNamedSeat, type RoomCreate } from '@daisy/protocol';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { drawCapableBounds } from '@daisy/protocol/testing';
import type { withRoomRuntime } from './room-runtime.test-support';

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Caller = Fixture['host'];
type DrawSource =
  | { readonly kind: 'host'; readonly resolutions: string[] }
  | {
      readonly kind: 'bank';
      readonly categories: ('policy' | 'value' | 'fact')[];
    };

/** A casual custom foundation Room whose resolution is drawn and struck. */
export const drawRoomOverrides = async (
  f: Fixture,
  source: DrawSource,
  drawSize = 5,
): Promise<Partial<RoomCreate>> => {
  const foundation = await f.foundation();
  return {
    resolution: { kind: 'strike' },
    selection: {
      kind: 'custom',
      competitionType: 'casual',
      definition: {
        ...foundation.definition,
        configurable: {
          ...foundation.definition.configurable,
          resolutionDraw: drawCapableBounds,
        },
      },
      config: {
        ...foundation.preset.config,
        resolutionDraw: {
          enabled: true,
          drawSize,
          strikeWindowMs: 180_000,
          firstStriker: 'negative',
          source,
        },
      },
    },
  };
};

/** One strike of the first standing position by whoever is on turn. */
export const strikeStanding = async (
  f: Fixture,
  roundId: string,
  who: Caller,
  ordinal: number,
) => {
  const current = await f.roundView(who, roundId);
  const draw = current.opening?.draw;
  if (draw?.visibility !== 'debater') throw new Error('Debater view');
  const standing = draw.items.find(
    (item) => !draw.strikes.some((s) => s.position === item.position),
  )!;
  await strikeCommand(f, roundId, who, ordinal, standing.position);
  return {
    view: await f.roundView(who, roundId),
    position: standing.position,
  };
};

/** The strike command itself, through the shared Round operation. */
export const strikeCommand = async (
  f: Fixture,
  roundId: string,
  who: Caller,
  ordinal: number,
  position: number,
) => {
  const current = await f.roundView(who, roundId);
  const seat = current.participants
    .filter(isNamedSeat)
    .find((p) => p.actorId === who.actorId);
  if (!seat) throw new Error('A seated striker');
  return createRoundRuntimeOperations({
    store: f.store,
    nextSegmentId: createId,
  }).command({ kind: 'human', actorId: who.actorId }, roundId, {
    version: 1,
    commandId: createId(),
    expectedVersion: current.version,
    command: {
      type: 'strike_resolution',
      participantId: seat.id,
      ordinal,
      position,
    },
  });
};

/** Strikes to the reveal, Negative first. */
export const strikeToReveal = async (
  f: Fixture,
  roundId: string,
  cast: { readonly host: Caller; readonly guest: Caller },
) => {
  const opening = (await f.roundView(cast.guest, roundId)).opening;
  const strikes = (opening?.draw?.drawSize ?? 1) - 1;
  for (let ordinal = 0; ordinal < strikes; ordinal += 1)
    await strikeStanding(
      f,
      roundId,
      ordinal % 2 === 0 ? cast.guest : cast.host,
      ordinal,
    );
};

/** A ready draw Room for a fresh cast, optionally started, and struck to its reveal. */
export const drawRoomAt = async (
  f: Fixture,
  stage: 'ready' | 'striking' | 'launched',
  source: DrawSource,
) => {
  const cast = await f.freshCast();
  let view = await f.assemble(await drawRoomOverrides(f, source), cast);
  if (stage === 'ready') return { cast, view };
  view = (await f.command(cast.host, view, { type: 'start-round' })).view;
  if (stage === 'striking') return { cast, view };
  await strikeToReveal(f, view.roundRef!.id, cast);
  return { cast, view: await f.operations.view(cast.host, view.id) };
};
