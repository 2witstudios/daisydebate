import type { FormatDefinition } from '@daisy/protocol';

type Segment = Pick<
  FormatDefinition['segments'][number],
  'key' | 'label' | 'side' | 'slot' | 'type' | 'defaultDurationMs'
> & {
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
};

/** Injected legal controls, not a new portable CAP command or format grammar. */
export type RoomFormControls = {
  readonly segments: readonly Segment[];
  readonly canEditSequence: boolean;
  readonly acceptsSequence: (keys: readonly string[]) => boolean;
};
export type RoomDraft = {
  readonly sequence: readonly string[];
  readonly durationsMs: Readonly<Record<string, number>>;
};
export type RoomDraftResult =
  | { readonly ok: true; readonly draft: RoomDraft }
  | {
      readonly ok: false;
      readonly notice: string;
      readonly values: Readonly<Record<string, string>>;
    };
export type RoomSequenceIntent = {
  readonly type: 'add' | 'remove' | 'earlier' | 'later';
  readonly key: string;
};

function sequenceIsLegal(keys: readonly string[], controls: RoomFormControls) {
  return (
    new Set(keys).size === keys.length &&
    keys.every((key) =>
      controls.segments.some((segment) => segment.key === key),
    ) &&
    controls.acceptsSequence(keys)
  );
}

function durationIsLegal(text: string | undefined, segment: Segment) {
  const milliseconds =
    text === undefined || text.trim() === '' ? NaN : Number(text) * 1000;
  return (
    Number.isSafeInteger(milliseconds) &&
    milliseconds >= segment.minDurationMs &&
    milliseconds <= segment.maxDurationMs
  );
}

function editedSequence(
  keys: readonly string[],
  intent: RoomSequenceIntent,
): string[] | undefined {
  const sequence = [...keys];
  const index = sequence.indexOf(intent.key);
  if (intent.type === 'add')
    return index === -1 ? [...sequence, intent.key] : undefined;
  if (index === -1) return undefined;
  if (intent.type === 'remove') {
    sequence.splice(index, 1);
    return sequence;
  }
  const destination = index + (intent.type === 'earlier' ? -1 : 1);
  if (destination < 0 || destination >= sequence.length) return undefined;
  [sequence[index], sequence[destination]] = [
    sequence[destination]!,
    sequence[index]!,
  ];
  return sequence;
}

/** Native fields produce a local draft; only the injected producer decides legality. */
export function readRoomDraft(
  form: FormData,
  controls: RoomFormControls,
): RoomDraftResult {
  const values: Record<string, string> = {};
  for (const segment of controls.segments) {
    const value = form.get(`seconds.${segment.key}`);
    if (typeof value === 'string') values[`seconds.${segment.key}`] = value;
  }
  const refused = (notice: string): RoomDraftResult => ({
    ok: false,
    notice,
    values,
  });
  const allowed = new Set([
    'segment',
    'intent',
    ...controls.segments.map((segment) => `seconds.${segment.key}`),
  ]);
  if (
    [...form.keys()].some(
      (key) => !allowed.has(key) && !key.startsWith('$ACTION_'),
    )
  )
    return refused('The form contains an unsupported field.');
  const sequence = form.getAll('segment');
  if (
    !sequence.every((key): key is string => typeof key === 'string') ||
    !sequenceIsLegal(sequence, controls)
  )
    return refused('Choose a speech sequence permitted by this format.');
  if (sequence.some((key) => form.getAll(`seconds.${key}`).length !== 1))
    return refused('Choose one length for each speech.');
  const durationsMs: Record<string, number> = {};
  for (const key of sequence) {
    const segment = controls.segments.find(
      (candidate) => candidate.key === key,
    )!;
    const text = values[`seconds.${key}`];
    if (!durationIsLegal(text, segment))
      return refused(`Choose a permitted length for ${segment.label}.`);
    durationsMs[key] = Number(text) * 1000;
  }
  return { ok: true, draft: { sequence: [...sequence], durationsMs } };
}

/** Changes only a draft, with no server readiness, persistence or actor authority. */
export function changeRoomSequence(
  draft: RoomDraft,
  intent: RoomSequenceIntent,
  controls: RoomFormControls,
): RoomDraftResult {
  const refused = (): RoomDraftResult => ({
    ok: false,
    notice: 'This sequence change is not permitted by the format.',
    values: {},
  });
  if (!controls.canEditSequence || !sequenceIsLegal(draft.sequence, controls))
    return refused();
  const sequence = editedSequence(draft.sequence, intent);
  if (!sequence || !sequenceIsLegal(sequence, controls)) return refused();
  const durationsMs = Object.fromEntries(
    sequence.map((key) => [
      key,
      draft.durationsMs[key] ??
        controls.segments.find((segment) => segment.key === key)!
          .defaultDurationMs,
    ]),
  );
  return { ok: true, draft: { sequence, durationsMs } };
}

/** Preview follows the exact selected order, including asymmetric speech counts. */
export function roomDraftPreview(
  draft: RoomDraft,
  controls: Pick<RoomFormControls, 'segments'>,
) {
  const segments = draft.sequence.map((key) => {
    const segment = controls.segments.find(
      (candidate) => candidate.key === key,
    );
    if (!segment) throw new Error('Unknown room segment');
    return {
      key,
      label: segment.label,
      side: segment.side,
      slot: segment.slot,
      type: segment.type,
      durationMs: draft.durationsMs[key] ?? segment.defaultDurationMs,
    };
  });
  return {
    segments,
    speechCounts: {
      affirmative: segments.filter(
        (segment) =>
          segment.type === 'speech' && segment.side === 'affirmative',
      ).length,
      negative: segments.filter(
        (segment) => segment.type === 'speech' && segment.side === 'negative',
      ).length,
    },
    totalMs: segments.reduce((total, segment) => total + segment.durationMs, 0),
  };
}
