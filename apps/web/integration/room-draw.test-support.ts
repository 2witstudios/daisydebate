import type { RoomCreate, RoomView } from '@daisy/protocol';
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
    topic: null,
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
        ...foundation.defaultConfig,
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
  current: RoomView,
  who: Caller,
  ordinal: number,
) => {
  const draw = current.resolutionDraw;
  if (draw?.visibility !== 'debater') throw new Error('Debater view');
  const standing = draw.items.find(
    (item) => !draw.strikes.some((s) => s.position === item.position),
  )!;
  const view = (
    await f.command(who, current, {
      type: 'strike-resolution',
      ordinal,
      position: standing.position,
    })
  ).view;
  return { view, position: standing.position };
};

/** Strikes to the reveal, Negative first. */
const strikeToReveal = async (
  f: Fixture,
  view: RoomView,
  cast: { readonly host: Caller; readonly guest: Caller },
): Promise<RoomView> => {
  let current = await f.operations.view(cast.guest, view.id);
  const strikes = (current.resolutionDraw?.drawSize ?? 1) - 1;
  for (let ordinal = 0; ordinal < strikes; ordinal += 1)
    current = (
      await strikeStanding(
        f,
        current,
        ordinal % 2 === 0 ? cast.guest : cast.host,
        ordinal,
      )
    ).view;
  return current;
};

/** A ready draw Room for a fresh cast, optionally begun, revealed and launched. */
export const drawRoomAt = async (
  f: Fixture,
  stage: 'ready' | 'striking' | 'launched',
  source: DrawSource,
) => {
  const cast = await f.freshCast();
  let view = await f.assemble(await drawRoomOverrides(f, source), cast);
  if (stage === 'ready') return { cast, view };
  view = (await f.command(cast.host, view, { type: 'start-pre-round' })).view;
  if (stage === 'striking') return { cast, view };
  view = await strikeToReveal(f, view, cast);
  view = (
    await f.command(cast.host, await f.operations.view(cast.host, view.id), {
      type: 'start-round',
    })
  ).view;
  return { cast, view };
};
