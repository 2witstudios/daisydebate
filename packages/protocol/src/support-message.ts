import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * A support message (SUPP-1): anyone, signed in or not, asks for help or
 * gives feedback from /support. These are its closed vocabulary and limits,
 * shared by the form, its route and the table's CHECKs.
 */
export const supportTopics = [
  'problem',
  'question',
  'feedback',
  'account',
  'safety',
] as const;
export type SupportTopic = (typeof supportTopics)[number];

/** The longest value each free-text field holds. */
export const supportMessageLimits = {
  message: 4000,
  about: 200,
  replyEmail: 320,
} as const;

/** One line: no control characters, so it never breaks the owner email's subject. */
const oneLine = /^[^\p{Cc}]*$/u;
/** Several lines: no control characters but line breaks and tabs. */
const severalLines = /^(?:[^\p{Cc}]|[\n\r\t])*$/u;

/**
 * The message's body, version 1: what the form sends and the route stores.
 * Who is signed in is never part of it: the route reads that from the
 * session.
 */
export const supportMessageSchema = z.strictObject({
  v: z.literal(1),
  /** Chosen when the form is shown, so sending it again stores it once. */
  messageId: idSchema,
  topic: z.enum(supportTopics),
  message: z
    .string()
    .trim()
    .min(1)
    .max(supportMessageLimits.message)
    .regex(severalLines),
  /** What page or round it is about, in the sender's words; empty when not given. */
  about: z.string().trim().max(supportMessageLimits.about).regex(oneLine),
  replyEmail: z
    .string()
    .trim()
    .max(supportMessageLimits.replyEmail)
    .pipe(z.email()),
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

/** The route's answer. Nothing in it says whether the message was stored. */
export const supportMessageResultSchema = z.strictObject({
  received: z.literal(true),
});
