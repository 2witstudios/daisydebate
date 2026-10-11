import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  roomCommandSchema,
  roomConfigSchema,
  type RoomCommand,
  type RoomView,
} from '@daisy/protocol';

import { readDuration } from './duration-input';

type Prepared =
  | { readonly kind: 'prepared'; readonly command: RoomCommand }
  | { readonly kind: 'conflict' | 'invalid' | 'forbidden' };
const flag = (form: FormData, key: string) =>
  form.get(key) === 'true'
    ? true
    : form.get(key) === 'false'
      ? false
      : undefined;

const durationFields = (name: string) => [
  `duration.${name}.minutes`,
  `duration.${name}.seconds`,
];

function allowedFields(view: RoomView) {
  const capability = view.definition.configurable;
  return new Set([
    'expectedVersion',
    'commandId',
    ...durationFields('countdown'),
    'crossExMode',
    ...view.definition.segments.flatMap((segment) =>
      durationFields(segment.key),
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
    ...(capability.interaction.yield ? ['yieldAllowed', 'yieldReturns'] : []),
  ]);
}
function configFields(view: RoomView, form: FormData) {
  const capability = view.definition.configurable;
  return {
    preRoundPrep:
      form.get('preRoundPrep') === 'on'
        ? { enabled: true, durationMs: readDuration(form, 'preRound') }
        : { enabled: false },
    inRoundPrep:
      form.get('inRoundPrep') === 'on'
        ? { enabled: true, budgetMsPerSide: readDuration(form, 'budget') }
        : { enabled: false },
    speechTiming: {
      countdownMs: readDuration(form, 'countdown'),
      segmentDurationOverrides: Object.fromEntries(
        view.definition.segments.map((segment) => [
          segment.key,
          readDuration(form, segment.key),
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
      ? {
          allowed: flag(form, 'yieldAllowed'),
          returnsTime: flag(form, 'yieldReturns'),
        }
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
  const command = roomCommandSchema.safeParse({
    type: 'update-config',
    expectedVersion: Number(form.get('expectedVersion')),
    commandId: form.get('commandId'),
    config: config.data,
  });
  return command.success
    ? { kind: 'prepared', command: command.data }
    : { kind: 'invalid' };
}
