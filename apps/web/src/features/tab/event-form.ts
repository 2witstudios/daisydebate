import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema, ballotDefinitionPinSchema } from '@daisy/protocol';
import {
  lobbySetupCommandEnvelopeSchema,
  entryShapeSchema,
} from '@daisy/protocol/lobby/lobby-setup-command';
import {
  eventPinOptionSchema,
  eventResolutionChoiceSchema,
} from '@daisy/protocol/lobby/host-events-read';
import { singleFormField } from '../../server/form-field';
import {
  formValues,
  refusedWith,
  unacknowledged,
  type Idle,
  type Refused,
  type Unacknowledged,
  type Moved,
} from '../forms/form-state';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
export const eventFormContextSchema = z.strictObject({
  handle: z.string().min(1).max(80),
  lobbyId: idSchema,
  returnEventId: idSchema.nullable(),
  commandId: idSchema,
  lobbyVersion: z.int().positive(),
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('create'),
      pinOptions: z.array(eventPinOptionSchema),
    }),
    z.strictObject({
      kind: z.literal('edit'),
      eventId: idSchema,
      ballotDefinition: ballotDefinitionPinSchema.nullable(),
    }),
    z.strictObject({ kind: z.literal('add-stage'), eventId: idSchema }),
    z.strictObject({
      kind: z.literal('add-round'),
      stageId: idSchema,
      resolutionChoices: z.array(eventResolutionChoiceSchema),
    }),
    z.strictObject({
      kind: z.literal('edit-round'),
      tabRoundId: idSchema,
      resolutionChoices: z.array(eventResolutionChoiceSchema),
    }),
    z.strictObject({ kind: z.literal('add-slot') }),
    z.strictObject({
      kind: z.literal('edit-slot'),
      timeSlotId: idSchema,
      slotVersion: z.int().positive(),
    }),
    z.strictObject({
      kind: z.literal('place-round'),
      tabRoundId: idSchema,
      timeSlots: z.array(
        z.strictObject({
          timeSlotId: idSchema,
          name: z.string().min(1).max(200),
        }),
      ),
    }),
    z.strictObject({
      kind: z.literal('add-resolution'),
      pools: z.array(
        z.strictObject({ poolId: idSchema, name: z.string().min(1).max(200) }),
      ),
    }),
    z.strictObject({
      kind: z.literal('command'),
      command: lobbySetupCommandEnvelopeSchema.shape.command,
      slotVersion: z.int().positive().optional(),
    }),
  ]),
});
export type EventFormContext = z.infer<typeof eventFormContextSchema>;
export type EventFormState = Idle | Refused | Unacknowledged | Moved;
export function eventFormEnvelope(value: EventFormContext, form: FormData) {
  const context = eventFormContextSchema.parse(value),
    target = context.target;
  const expected = {
    lobby: context.lobbyVersion,
    ...((target.kind === 'command' || target.kind === 'edit-slot') &&
    target.slotVersion
      ? { timeSlot: target.slotVersion }
      : {}),
  };
  let command;
  if (target.kind === 'command') command = target.command;
  else if (target.kind === 'add-stage') {
    const timing = singleFormField(form, 'timing');
    command = {
      type: 'add-stage',
      lobbyId: context.lobbyId,
      eventId: target.eventId,
      kind: singleFormField(form, 'stageKind'),
      place: singleFormField(form, 'place'),
      division: singleFormField(form, 'division').trim() || null,
      timing:
        timing === 'windowed'
          ? {
              timing,
              opensAt: utcFormInstant(singleFormField(form, 'opensAt')),
              closesAt: utcFormInstant(singleFormField(form, 'closesAt')),
            }
          : { timing },
    };
  } else if (target.kind === 'add-slot' || target.kind === 'edit-slot') {
    command = {
      type: target.kind === 'add-slot' ? 'add-time-slot' : 'update-time-slot',
      lobbyId: context.lobbyId,
      ...(target.kind === 'edit-slot' ? { timeSlotId: target.timeSlotId } : {}),
      name: singleFormField(form, 'name'),
      startsAt: utcFormInstant(singleFormField(form, 'startsAt')),
    };
  } else if (target.kind === 'place-round') {
    const id = singleFormField(form, 'timeSlotId');
    if (id !== '' && !target.timeSlots.some((slot) => slot.timeSlotId === id))
      throw createAppError('VALIDATION');
    command = {
      type: 'place-tab-round',
      lobbyId: context.lobbyId,
      tabRoundId: target.tabRoundId,
      timeSlotId: id || null,
    };
  } else if (target.kind === 'add-round' || target.kind === 'edit-round') {
    const key = singleFormField(form, 'resolution'),
      choice = target.resolutionChoices.find((option) => option.key === key);
    if (key !== '' && !choice) throw createAppError('VALIDATION');
    command = {
      type: target.kind === 'add-round' ? 'add-tab-round' : 'update-tab-round',
      lobbyId: context.lobbyId,
      ...(target.kind === 'add-round'
        ? { stageId: target.stageId }
        : { tabRoundId: target.tabRoundId }),
      name: singleFormField(form, 'name').trim() || null,
      resolution: choice?.resolution ?? null,
    };
  } else if (target.kind === 'add-resolution') {
    const id = singleFormField(form, 'poolId');
    if (id !== '' && !target.pools.some((pool) => pool.poolId === id))
      throw createAppError('VALIDATION');
    command = {
      type: 'add-resolution',
      lobbyId: context.lobbyId,
      pool: id
        ? { kind: 'existing', poolId: id }
        : { kind: 'new', name: singleFormField(form, 'poolName') },
      text: singleFormField(form, 'text'),
    };
  } else {
    const name = singleFormField(form, 'name').trim(),
      label = singleFormField(form, 'label').trim() || null;
    if (target.kind === 'edit')
      command = {
        type: 'update-event',
        lobbyId: context.lobbyId,
        eventId: target.eventId,
        name,
        label,
        ballotDefinition: target.ballotDefinition,
      };
    else {
      const pin = target.pinOptions.find(
        (option) => option.key === singleFormField(form, 'pin'),
      )?.pin;
      if (!pin) throw createAppError('VALIDATION');
      const kind = z
        .enum(['person', 'team'])
        .parse(singleFormField(form, 'entryKind'));
      const entry = entryShapeSchema.parse(
        kind === 'person'
          ? { kind }
          : { kind, size: Number(singleFormField(form, 'teamSize')) },
      );
      command = {
        type: 'add-event',
        lobbyId: context.lobbyId,
        name,
        label,
        pin,
        entry,
      };
    }
  }
  return lobbySetupCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected,
    command,
  });
}
export const eventFormRefused = (
  form: FormData,
  message: string,
): EventFormState => refusedWith(formValues(form), message);
export const eventFormUnacknowledged = (form: FormData): EventFormState =>
  unacknowledged(form);
const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), receipt: lobbyCommandReceiptSchema }),
  z.object({ kind: z.literal('refused'), refusal: z.string() }),
]);
export function eventFormAnswer(form: FormData, body: unknown) {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return eventFormUnacknowledged(form);
  if (parsed.data.kind === 'accepted') return parsed.data;
  return eventFormRefused(
    form,
    parsed.data.refusal === 'version-conflict'
      ? 'The tournament changed. Reload and review the current event.'
      : `This change was refused: ${parsed.data.refusal.replaceAll('-', ' ')}.`,
  );
}

const utcFormInstant = (value: string): string =>
  z.iso
    .datetime()
    .parse(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)
        ? `${value.length === 16 ? `${value}:00` : value}Z`
        : value,
    );
