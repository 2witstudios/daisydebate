import type { RoomConfig, RoomView } from '@daisy/protocol';
import { readDuration } from './duration-input';

/** The native field names of the Resolution strike fieldset. */
export const drawFieldNames = [
  'resolutionDraw',
  'drawSource',
  'drawSize',
  'drawFirstStriker',
  'duration.strikeWindow',
  'drawResolutions',
  'drawTopic',
] as const;

/** The Room's draw choice, rebuilt from the author's own list when it has one. */
const currentDraw = (view: RoomView): RoomConfig['resolutionDraw'] => {
  const draw = view.config.resolutionDraw;
  if (!draw.enabled || draw.source.kind === 'bank')
    return draw as RoomConfig['resolutionDraw'];
  return {
    ...draw,
    source: {
      kind: 'host',
      resolutions: [...(view.authoredDrawSource?.resolutions ?? [])],
    },
  };
};

const lines = (value: FormDataEntryValue | null) =>
  typeof value === 'string'
    ? value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

/**
 * The draw a settings post chooses, and the topic rule's companion: turning
 * a draw on clears the topic, turning it off carries the typed replacement,
 * and keeping the draw state carries no topic.
 */
export function drawSettings(
  view: RoomView,
  form: FormData,
): {
  readonly resolutionDraw: unknown;
  readonly topic?: string | null;
} {
  if (!view.definition.configurable.resolutionDraw)
    return { resolutionDraw: currentDraw(view) };
  const enabled = form.get('resolutionDraw') === 'on';
  const before = view.config.resolutionDraw;
  const categories =
    before.enabled && before.source.kind === 'bank'
      ? before.source.categories
      : ['policy', 'value', 'fact'];
  const resolutionDraw = enabled
    ? {
        enabled: true,
        drawSize: Number(form.get('drawSize')),
        strikeWindowMs: readDuration(form, 'strikeWindow'),
        firstStriker: form.get('drawFirstStriker'),
        source:
          form.get('drawSource') === 'host'
            ? { kind: 'host', resolutions: lines(form.get('drawResolutions')) }
            : { kind: 'bank', categories },
      }
    : { enabled: false };
  if (enabled === before.enabled) return { resolutionDraw };
  if (enabled) return { resolutionDraw, topic: null };
  const topic = form.get('drawTopic');
  return {
    resolutionDraw,
    topic: typeof topic === 'string' ? topic.trim() : '',
  };
}
