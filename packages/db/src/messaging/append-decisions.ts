import { createAppError, isAppError } from '@daisy/errors';
import {
  expectedAppendError,
  isMutation,
  type ContentAttempt,
} from './append-contracts';
import type { AppendOutcome } from './append-collector';
import type {
  MessagingCreateSendPlan,
  MessagingMessageRecord,
  MessagingSendState,
} from './records';
import type { MessagingStreamCounters } from './stream';
import type { messagingReceipts } from '../schema/messaging-messages';
export type AppendScratch = {
  readonly channelId: string;
  readonly locked: MessagingStreamCounters;
  readonly counters: MessagingStreamCounters & { channelId: string };
  readonly byReceipt: Map<string, typeof messagingReceipts.$inferSelect>;
  readonly messages: Map<string, MessagingMessageRecord>;
  readonly creates: MessagingCreateSendPlan[];
  readonly changed: Map<string, MessagingMessageRecord>;
  readonly removed: Set<string>;
  readonly bells: MessagingCreateSendPlan['doorbell'][];
  readonly replayed: Set<number>;
  readonly insertedReceipts: (typeof messagingReceipts.$inferInsert)[];
};
export const appendReceiptKey = (actor: string, request: string) =>
  `${actor}:${request}`;

function messageAt(
  messages: AppendScratch['messages'],
  id: string | null | undefined,
) {
  return id ? (messages.get(id) ?? null) : null;
}
function decisionFor(attempt: ContentAttempt, scratch: AppendScratch) {
  const { counters, messages } = scratch;
  const receipt =
    scratch.byReceipt.get(
      appendReceiptKey(attempt.scope.actorId, attempt.command.requestId),
    ) ?? null;
  if (isMutation(attempt))
    return attempt.decide({
      counters,
      receipt,
      message: messageAt(messages, attempt.command.messageId),
    });
  const state: MessagingSendState = {
    counters,
    receipt,
    existingMessage: messageAt(messages, receipt?.messageId),
    reply: messageAt(messages, attempt.command.replyToMessageId),
  };
  return attempt.decide(state);
}
type Decision = ReturnType<typeof decisionFor>;
function validateCreate(
  attempt: ContentAttempt,
  plan: MessagingCreateSendPlan,
  scratch: AppendScratch,
) {
  if (
    isMutation(attempt) ||
    plan.message.sequence !== scratch.counters.messageSequence + 1 ||
    plan.message.text !== attempt.command.text ||
    plan.receipt.messageId !== plan.message.id ||
    plan.message.replyToMessageId !== attempt.command.replyToMessageId
  )
    throw new Error('Invalid send decision');
}
function validateMutation(
  attempt: ContentAttempt,
  plan: Exclude<Decision, { kind: 'replay' } | { kind: 'create' }>,
  scratch: AppendScratch,
) {
  if (!isMutation(attempt)) throw new Error('Invalid mutation command');
  const original = scratch.messages.get(attempt.command.messageId);
  if (!original) throw new Error('Missing mutation target');
  const matches = [
    plan.message.id === original.id,
    plan.message.sequence === original.sequence,
    plan.message.createdAt === original.createdAt,
    original.authorActorId === attempt.scope.actorId,
    original.removedAt === null,
    original.text !== null,
  ];
  const content =
    attempt.command.kind === 'remove'
      ? plan.message.text === null && plan.message.removedAt !== null
      : plan.message.text === attempt.command.text &&
        plan.message.removedAt === null;
  if (!matches.every(Boolean) || !content)
    throw new Error('Invalid mutation decision');
}
function acceptDecision(
  attempt: ContentAttempt,
  plan: Exclude<Decision, { kind: 'replay' }>,
  scratch: AppendScratch,
) {
  const { scope, command } = attempt;
  if (
    plan.doorbell.channelId !== scratch.channelId ||
    plan.doorbell.changeVersion !== plan.message.changeVersion
  )
    throw new Error('Invalid append doorbell');
  if (
    plan.message.channelId !== scratch.channelId ||
    plan.message.authorActorId !== scope.actorId ||
    plan.message.changeVersion !== scratch.counters.changeVersion + 1
  )
    throw new Error('Invalid append decision');
  if (plan.kind === 'create') {
    validateCreate(attempt, plan, scratch);
    scratch.creates.push(plan);
    // Scratch is mutable, scoped to this transaction; no durable counter is allocated here.
    Object.assign(scratch.counters, { messageSequence: plan.message.sequence });
  } else {
    validateMutation(attempt, plan, scratch);
    scratch.changed.set(plan.message.id, plan.message);
    if (plan.message.removedAt !== null) scratch.removed.add(plan.message.id);
  }
  const row = {
    channelId: scope.channelId,
    actorId: scope.actorId,
    requestId: command.requestId,
    messageId: plan.message.id,
    payloadDigest:
      plan.kind === 'create' ? plan.receipt.payloadDigest : plan.payloadDigest,
  };
  scratch.insertedReceipts.push(row);
  scratch.byReceipt.set(
    appendReceiptKey(scope.actorId, command.requestId),
    row,
  );
  scratch.messages.set(plan.message.id, plan.message);
  scratch.bells.push(plan.doorbell);
  Object.assign(scratch.counters, {
    changeVersion: plan.message.changeVersion,
  });
}
function allocationExhausted(attempt: ContentAttempt, scratch: AppendScratch) {
  return (
    (!isMutation(attempt) &&
      scratch.counters.messageSequence === Number.MAX_SAFE_INTEGER) ||
    scratch.counters.changeVersion === Number.MAX_SAFE_INTEGER
  );
}
function validateRefusal(attempt: ContentAttempt, scratch: AppendScratch) {
  try {
    decisionFor(attempt, scratch);
  } catch (error) {
    if (
      isAppError(error) &&
      error.code === 'CONFLICT' &&
      allocationExhausted(attempt, scratch)
    )
      return;
    throw error;
  }
}
function decideFinal(
  attempt: ContentAttempt,
  admission: AppendOutcome<void> | undefined,
  receipt: boolean,
  scratch: AppendScratch,
) {
  if (!receipt && admission && 'error' in admission) {
    validateRefusal(attempt, scratch);
    return admission;
  }
  if (!receipt && allocationExhausted(attempt, scratch))
    throw createAppError('INFRASTRUCTURE', 'Messaging stream exhausted');
  return decisionFor(attempt, scratch);
}
function applyOne(
  attempt: ContentAttempt,
  index: number,
  admission: AppendOutcome<void> | undefined,
  final: boolean,
  scratch: AppendScratch,
): AppendOutcome<MessagingMessageRecord | null> {
  const receipt = scratch.byReceipt.has(
    appendReceiptKey(attempt.scope.actorId, attempt.command.requestId),
  );
  if (!receipt && !final) {
    decisionFor(attempt, scratch);
    return { value: null };
  }
  const plan = decideFinal(attempt, admission, receipt, scratch);
  if ('error' in plan) return plan;
  if (plan.kind === 'replay') {
    scratch.replayed.add(index);
    return { value: plan.message };
  }
  if (!admission) throw new Error('Missing append admission');
  if ('error' in admission) return admission;
  acceptDecision(attempt, plan, scratch);
  return { value: plan.message };
}
export function applyAppendDecisions(
  attempts: readonly ContentAttempt[],
  authorized: readonly AppendOutcome<void>[],
  admissions: readonly AppendOutcome<void>[],
  final: boolean,
  scratch: AppendScratch,
) {
  return attempts.map(
    (attempt, index): AppendOutcome<MessagingMessageRecord | null> => {
      const authorization = authorized[index]!;
      if ('error' in authorization) return authorization;
      try {
        return applyOne(attempt, index, admissions[index], final, scratch);
      } catch (error) {
        if (!expectedAppendError(error)) throw error;
        return { error };
      }
    },
  );
}
export function finalizeAppend(
  outcomes: readonly AppendOutcome<MessagingMessageRecord | null>[],
  scratch: AppendScratch,
) {
  return outcomes.map(
    (outcome, index): AppendOutcome<MessagingMessageRecord | null> => {
      if ('error' in outcome || !outcome.value) return outcome;
      const current = scratch.messages.get(outcome.value.id)!;
      if (
        scratch.replayed.has(index) &&
        (current.text === null || current.removedAt !== null)
      )
        return { error: createAppError('NOT_FOUND') };
      return { value: current };
    },
  );
}
