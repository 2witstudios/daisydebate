import type { FormatDefinition, RoundRules } from '@daisy/protocol';
import type { RoomDraft, RoomFormControls } from './room-form';

type SpeechSource = {
  readonly definition: Pick<FormatDefinition, 'segments'> & {
    readonly configurable: {
      readonly timing: Pick<
        FormatDefinition['configurable']['timing'],
        'segmentDurationMs'
      >;
    };
  };
  readonly rules: Pick<RoundRules, 'segments'>;
};

/** Read projection only. Sequence authority remains an explicit producer policy. */
export function assemblySpeechSettings(
  source: SpeechSource,
  sequencePolicy: Pick<RoomFormControls, 'canEditSequence' | 'acceptsSequence'>,
): { readonly controls: RoomFormControls; readonly saved: RoomDraft } {
  const segments = source.definition.segments.map((segment) => {
    const bounds =
      source.definition.configurable.timing.segmentDurationMs[segment.key];
    if (!bounds) throw new Error('Missing segment timing bounds');
    return { ...segment, minDurationMs: bounds.min, maxDurationMs: bounds.max };
  });
  return {
    controls: { segments, ...sequencePolicy },
    saved: {
      sequence: source.rules.segments.map((segment) => segment.key),
      durationsMs: Object.fromEntries(
        source.rules.segments.map((segment) => [
          segment.key,
          segment.durationMs,
        ]),
      ),
    },
  };
}
