import { idSchema } from '@daisy/protocol';
import {
  lobbyCommandReceiptSchema,
  type LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { z } from 'zod';

const accepted = z.object({
  kind: z.literal('accepted'),
  receipt: lobbyCommandReceiptSchema,
});
const refused = z.object({ kind: z.literal('refused'), refusal: z.string() });
const settled = z.discriminatedUnion('kind', [accepted, refused]);
const draw = z.discriminatedUnion('kind', [
  accepted,
  refused,
  z.object({
    kind: z.literal('pending'),
    pendingCommandId: idSchema,
    expiresAt: z.iso.datetime(),
  }),
]);
const people = z.discriminatedUnion('kind', [
  accepted,
  refused,
  z.object({
    kind: z.literal('pending'),
    pendingCommandId: z.string(),
    expiresAt: z.string(),
  }),
]);

export function mapTabCommandAnswer<
  Accepted,
  Refused,
  Unacknowledged,
  Pending = never,
>(
  body: unknown,
  outcomes: {
    readonly accepted: (receipt: LobbyCommandReceipt) => Accepted;
    readonly refused: (reason: string) => Refused;
    readonly unacknowledged: () => Unacknowledged;
    readonly pending?: {
      readonly contract: 'draw' | 'people';
      readonly answer: () => Pending;
    };
  },
): Accepted | Refused | Unacknowledged | Pending {
  const pending = outcomes.pending;
  const schema =
    pending?.contract === 'draw' ? draw : pending ? people : settled;
  const answer = schema.safeParse(body);
  if (!answer.success) return outcomes.unacknowledged();
  switch (answer.data.kind) {
    case 'accepted':
      return outcomes.accepted(answer.data.receipt);
    case 'refused':
      return outcomes.refused(answer.data.refusal);
    case 'pending':
      return pending ? pending.answer() : outcomes.unacknowledged();
  }
}
