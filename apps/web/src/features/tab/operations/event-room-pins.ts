import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  formatDefinitionSchema,
  roomConfigSchema,
  twoSideKeys,
  type RoomConfig,
  type RoomCapture,
} from '@daisy/protocol';
import type { LoadedDrawCommand } from '@daisy/db/tab';
import { eventSettingResolution } from './event-setting-resolution';
import { commandDigest } from './command-digest';

type Resolved = ReturnType<typeof eventSettingResolution>['settings'];
type Wording = NonNullable<
  LoadedDrawCommand['publicationResolution']
>['resolutions'][number];
/** A server-minted seed fixes selection once; the command id is never its entropy. */
const orderedWordings = (
  rows: readonly Wording[],
  entropy: string,
  salt: string,
) =>
  rows
    .map((row) => ({ row, rank: commandDigest({ entropy, salt, id: row.id }) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map(({ row }) => row);
const postingOpenedAt = (
  loaded: LoadedDrawCommand,
  settings: Resolved,
  now: string,
): string | null => {
  const previous = loaded.releases
    .filter(
      (release) =>
        release.tabRoundId === loaded.round.id && release.thing === 'posting',
    )
    .map((release) => release.openedAt.toISOString())
    .sort()[0];
  return (
    previous ??
    (Object.values(settings['audience.posting'].value).some(
      (when) => when === 'at_once',
    )
      ? now
      : null)
  );
};
const publicationResolution = (
  loaded: LoadedDrawCommand,
  settings: Resolved,
  entropy: string,
  fixtureId: string,
  now: string,
  sideKeys: readonly string[],
) => {
  const { publicationResolution: source, round } = loaded;
  if (!source) return null;
  const rule = settings['resolution.rule'].value;
  const live = source.resolutions.filter((row) => row.retiredAt === null);
  if (rule.method === 'strike') {
    const firstStriker = twoSideKeys.find(
      (side) => side === sideKeys[rule.firstStriker],
    );
    if (!firstStriker) return null;
    const unique = [
      ...new Map(
        live.map((row) => [row.text.trim().toLocaleLowerCase(), row]),
      ).values(),
    ];
    const choices = orderedWordings(unique, entropy, fixtureId).slice(
      0,
      rule.drawSize,
    );
    if (
      choices.length !== rule.drawSize ||
      new Set(choices.map((row) => row.text.toLocaleLowerCase())).size !==
        choices.length
    )
      return null;
    const draw: RoomConfig['resolutionDraw'] = {
      enabled: true,
      drawSize: rule.drawSize,
      strikeWindowMs: rule.strikeWindowMs,
      firstStriker,
      source: { kind: 'host', resolutions: choices.map((row) => row.text) },
    };
    return { topic: null, draw, pin: null };
  }
  const selected = round.poolResolutionId
    ? live.find((row) => row.id === round.poolResolutionId)
    : rule.method === 'draw'
      ? orderedWordings(live, entropy, round.id)[0]
      : null;
  if (!selected) return null;
  const releasedAt =
    rule.release === 'with_posting'
      ? postingOpenedAt(loaded, settings, now)
      : null;
  const pin =
    round.poolResolutionId === null ||
    (round.resolutionReleasedAt === null && releasedAt !== null)
      ? { tabRoundId: round.id, poolResolutionId: selected.id, releasedAt }
      : null;
  return { topic: selected.text, draw: { enabled: false } as const, pin };
};

/** Publication fixes Room inputs; no immutable definition is rewritten to fit a setting. */
export const eventRoomPins = (
  loaded: LoadedDrawCommand,
  entropy: string,
  fixtureId: string,
  now: string,
) => {
  const { settings } = eventSettingResolution(loaded.configuration);
  const definition = formatDefinitionSchema.parse(
    loaded.configuration.definition.definition,
  );
  if (
    !loaded.stage ||
    definition.seats.judges !==
      settings['judging.panel'].value[loaded.stage.kind].size
  )
    return null;
  const resolution = publicationResolution(
    loaded,
    settings,
    entropy,
    fixtureId,
    now,
    definition.sides.map((side) => side.key),
  );
  if (!resolution) return null;
  const timing = settings['room.timing'].value,
    floor = settings['room.floor'].value;
  const parsed = roomConfigSchema.safeParse({
    ...loaded.configuration.preset.config,
    preRoundPrep: timing.preRoundPrepMs
      ? { enabled: true, durationMs: timing.preRoundPrepMs }
      : { enabled: false },
    inRoundPrep: timing.inRoundPrepMsPerSide
      ? { enabled: true, budgetMsPerSide: timing.inRoundPrepMsPerSide }
      : { enabled: false },
    speechTiming: {
      ...loaded.configuration.preset.config.speechTiming,
      countdownMs: timing.countdownMs,
    },
    interruptions: floor.interruptions,
    yielding: floor.yielding,
    resolutionDraw: resolution.draw,
  });
  if (!parsed.success) return null;
  const compiled = resolveRoomConfiguration(definition, parsed.data);
  if (!compiled.ok) return null;
  const capture: RoomCapture = {
    broadcast: null,
    recordingPolicy:
      settings['recording.capture'].value.value === 'on' ? 'officials' : 'off',
  };
  return {
    definition,
    config: parsed.data,
    rules: compiled.rules,
    executionPlan: compiled.roomPlan,
    topic: resolution.topic,
    resolutionPin: resolution.pin,
    capture,
  };
};
