import { z } from 'zod';
import { idSchema, roomConfigSchema } from '@daisy/protocol';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import { createAppError } from '@daisy/errors';
import {
  standingRoomCreationSchema,
  standingRoomSelectionSchema,
  type StandingRoomCreation,
} from './standing-room-creation';
import {
  idle,
  refused,
  unacknowledged,
  type Idle,
  type Refused,
  type Unacknowledged,
  type Moved,
} from '../forms/form-state';
import { singleFormField } from '../../server/form-field';
export const standingRoomContextSchema = z.strictObject({
  commandId: idSchema,
  lobbyId: idSchema,
  templateId: idSchema,
  selection: standingRoomSelectionSchema,
  config: roomConfigSchema,
  visibility: standingRoomCreationSchema.shape.visibility,
  recording: standingRoomCreationSchema.shape.recording,
  resolutionChoicePolicy: z.strictObject({
    method: z.enum(['fixed', 'draw', 'strike']),
    ownText: z.boolean(),
  }),
});
export type StandingRoomContext = z.infer<typeof standingRoomContextSchema>;
export type StandingRoomState = Idle | Refused | Unacknowledged | Moved;
/** Choice lists stay out of the bound action payload; the backend checks the exact submitted pool id/text. */
export const standingRoomContext = (input: {
  readonly commandId: string;
  readonly lobbyId: string;
  readonly templateId: string;
  readonly creation: StandingRoomCreation;
}): StandingRoomContext =>
  standingRoomContextSchema.parse({
    commandId: input.commandId,
    lobbyId: input.lobbyId,
    templateId: input.templateId,
    selection: input.creation.selection,
    config: input.creation.config,
    visibility: input.creation.visibility,
    recording: input.creation.recording,
    resolutionChoicePolicy: {
      method: input.creation.resolutionChoicePolicy.method,
      ownText: input.creation.resolutionChoicePolicy.ownText,
    },
  });
export const initialStandingRoom = (
  creation: StandingRoomCreation,
): StandingRoomState =>
  idle({
    title: '',
    visibility: creation.visibility.value,
    recording: creation.recording.value,
    resolution:
      creation.resolutionChoicePolicy.method === 'fixed'
        ? (creation.resolutionChoicePolicy.choices[0]?.id ?? 'custom')
        : 'strike',
    topic:
      creation.resolutionChoicePolicy.method === 'fixed'
        ? (creation.resolutionChoicePolicy.choices[0]?.text ?? '')
        : '',
  });
export const standingRoomUnavailable = (form: FormData): StandingRoomState =>
  unacknowledged(form);
/** Immutable pins/config and the actual pool wording accompany every retry unchanged. */
export function standingRoomEnvelope(
  untrusted: StandingRoomContext,
  form: FormData,
) {
  const context = standingRoomContextSchema.parse(untrusted);
  const title = singleFormField(form, 'title');
  const visibility = singleFormField(form, 'visibility');
  if (context.visibility.locked && visibility !== context.visibility.value)
    throw createAppError('VALIDATION', 'Visibility is locked');
  const recording = z
    .enum(['on', 'off'])
    .parse(singleFormField(form, 'recording'));
  if (context.recording.locked && recording !== context.recording.value)
    throw createAppError('VALIDATION', 'Recording is locked');
  const chosen = singleFormField(form, 'resolution');
  const topic = singleFormField(form, 'topic') ?? '';
  if (
    context.resolutionChoicePolicy.method === 'fixed' &&
    chosen === 'custom' &&
    !context.resolutionChoicePolicy.ownText
  )
    throw createAppError('VALIDATION', 'A pool resolution is required');
  const poolResolutionId =
    context.resolutionChoicePolicy.method === 'fixed' && chosen !== 'custom'
      ? idSchema.parse(chosen)
      : undefined;
  const parsed = lobbySetupCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: {},
    command: {
      type: 'create-lobby-room',
      lobbyId: context.lobbyId,
      templateId: context.templateId,
      config: context.config,
      ...(poolResolutionId ? { poolResolutionId } : {}),
      room: {
        commandId: context.commandId,
        title,
        visibility,
        recordingPolicy: recording === 'on' ? 'officials' : 'off',
        resolution:
          context.resolutionChoicePolicy.method === 'fixed'
            ? { kind: 'custom', text: topic }
            : { kind: 'strike' },
        selection: context.selection,
      },
    },
  });
  if (parsed.command.type !== 'create-lobby-room')
    throw createAppError('INVARIANT');
  return { ...parsed, command: parsed.command };
}
const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), receipt: lobbyCommandReceiptSchema }),
  z.object({ kind: z.literal('refused'), refusal: z.string() }),
]);
export function standingRoomAnswer(
  form: FormData,
  body: unknown,
): StandingRoomState | { readonly kind: 'accepted'; readonly roomId: string } {
  const answer = answerSchema.safeParse(body);
  if (!answer.success) return unacknowledged(form);
  if (answer.data.kind === 'accepted')
    return answer.data.receipt.aggregate.kind === 'room'
      ? { kind: 'accepted', roomId: answer.data.receipt.aggregate.id }
      : unacknowledged(form);
  const message =
    answer.data.refusal === 'setting-enforced'
      ? 'The league settings changed. Reload this form to check them.'
      : answer.data.refusal === 'template-not-offered' ||
          answer.data.refusal === 'template-format-mismatch'
        ? 'This template changed. Reload this form.'
        : answer.data.refusal === 'pool-resolution-required'
          ? 'This resolution changed. Reload the form to choose from the current pool.'
          : answer.data.refusal === 'rating-format-unsupported'
            ? 'This template cannot be rated on the league ladder.'
            : 'The room could not be created. Reload the form to check its settings.';
  return refused(form, message);
}
