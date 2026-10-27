import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  roomCommandSchema,
  roomConfigSchema,
  type RoomCommand,
  type RoomView,
} from '@daisy/protocol';

import { readDuration } from './duration-input';
import { drawFieldNames, drawSettings } from './prepare-draw-settings';
import { yieldChoices } from './yield-choice';

type Prepared =
  | { readonly kind: 'prepared'; readonly command: RoomCommand }
  | { readonly kind: 'conflict' | 'invalid' | 'forbidden' };
const durationFields = (name: string) => [`duration.${name}`];

function allowedFields(view: RoomView) {
  const capability = view.definition.configurable;
  return new Set([
    'expectedVersion',
    'commandId',
    ...durationFields('countdown'),
    'crossExMode',
    ...view.definition.segments.flatMap((segment) =>
      durationFields(`segment.${segment.key}`),
    ),
    ...(capability.preRoundPrep
      ? ['preRoundPrep', ...durationFields('preRound')]
      : []),
    ...(capability.inRoundPrep
      ? ['inRoundPrep', ...durationFields('budget')]
      : []),
    ...(capability.interaction.interruptions
      ? ['interruptionsMode', ...durationFields('minRemaining')]
      : []),
    ...(capability.interaction.yield ? ['yield'] : []),
    ...(capability.resolutionDraw ? drawFieldNames : []),
  ]);
}
function configFields(view: RoomView, form: FormData) {
  const capability = view.definition.configurable;
  return {
    preRoundPrep:
      form.get('preRoundPrep') === 'on'
        ? { enabled: true, durationMs: readDuration(form, 'preRound') }
        : { enabled: false },
    resolutionDraw: drawSettings(view, form).resolutionDraw,
    inRoundPrep:
      form.get('inRoundPrep') === 'on'
        ? { enabled: true, budgetMsPerSide: readDuration(form, 'budget') }
        : { enabled: false },
    speechTiming: {
      countdownMs: readDuration(form, 'countdown'),
      segmentDurationOverrides: Object.fromEntries(
        view.definition.segments.map((segment) => [
          segment.key,
          readDuration(form, `segment.${segment.key}`),
        ]),
      ),
    },
    crossExamination: { crossExMode: form.get('crossExMode') },
    interruptions: capability.interaction.interruptions
      ? {
          mode: form.get('interruptionsMode'),
          minRemainingMs: readDuration(form, 'minRemaining'),
        }
      : null,
    yielding: capability.interaction.yield
      ? (yieldChoices(capability.interaction.yield, view.config.yielding).find(
          ([choice]) => choice === form.get('yield'),
        )?.[1] ?? {})
      : null,
  };
}

function fieldsAreValid(view: RoomView, form: FormData) {
  const allowed = allowedFields(view);
  return [...form].every(
    ([key, value]) =>
      key.startsWith('$ACTION_') ||
      (allowed.has(key) &&
        typeof value === 'string' &&
        form.getAll(key).length === 1),
  );
}

/** Consumer conversion only; CAP rechecks host/version/legal rules atomically. */
export function prepareSettings(view: RoomView, form: FormData): Prepared {
  if (!view.capabilities.canEdit) return { kind: 'forbidden' };
  if (!fieldsAreValid(view, form)) return { kind: 'invalid' };
  if (Number(form.get('expectedVersion')) !== view.version)
    return { kind: 'conflict' };
  const config = roomConfigSchema.safeParse(configFields(view, form));
  if (
    !config.success ||
    !resolveRoomConfiguration(view.definition, config.data).ok
  )
    return { kind: 'invalid' };
  const { topic } = drawSettings(view, form);
  const command = roomCommandSchema.safeParse({
    type: 'update-config',
    expectedVersion: Number(form.get('expectedVersion')),
    commandId: form.get('commandId'),
    config: config.data,
    ...(topic === undefined ? {} : { topic }),
  });
  return command.success
    ? { kind: 'prepared', command: command.data }
    : { kind: 'invalid' };
}
