import { z } from 'zod';
import { normalizeEmail } from './email';
import { idSchema } from './primitives';
import { usernameSchema } from './username';

/**
 * Guardian links (ADR 0163). A parent or legal guardian stands for their
 * child on Daisy, apart from any coach or club. A link grants nothing until
 * it is active, and it is active only when the parent created the child's
 * account or the child confirmed the parent from their own account.
 */

/**
 * A link's life: `requested` waits for the child; `active` is the only
 * state that grants anything; `refused` is the child saying "not my
 * parent"; `cancelled` is the parent withdrawing a request; `ended` closes
 * an active link.
 */
export const guardianLinkStatuses = [
  'requested',
  'active',
  'refused',
  'cancelled',
  'ended',
] as const;
export type GuardianLinkStatus = (typeof guardianLinkStatuses)[number];

/** How a link became (or will become) active. */
export const guardianLinkActivations = [
  'created-account',
  'child-confirmed',
] as const;
export type GuardianLinkActivation = (typeof guardianLinkActivations)[number];

/** Who a piece of consent evidence records agreeing. */
export const consentRoles = ['guardian', 'child'] as const;
export type ConsentRole = (typeof consentRoles)[number];

/**
 * How the agreement was given: a parent creating the child's account, a
 * parent asking to link an account, or the child confirming that parent.
 */
export const consentMethods = [
  'created-account',
  'requested-link',
  'confirmed-link',
] as const;
export type ConsentMethod = (typeof consentMethods)[number];

/** The notices a person agrees to: the parent's, and the child's confirmation. */
export const guardianNoticeKinds = [
  'parental-consent',
  'child-confirmation',
] as const;
export type GuardianNoticeKind = (typeof guardianNoticeKinds)[number];

/** The role each method belongs to; any other pairing is not evidence. */
export const roleOfConsentMethod = (method: ConsentMethod): ConsentRole =>
  method === 'confirmed-link' ? 'child' : 'guardian';

/** The notice each role agrees to. */
export const noticeOfConsentRole = (role: ConsentRole): GuardianNoticeKind =>
  role === 'guardian' ? 'parental-consent' : 'child-confirmation';

/** A first name as a parent types it: trimmed, 1 to 40 characters, no controls. */
export const childFirstNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);

/** `YYYY-MM`. */
export const birthMonthSchema = z
  .string()
  .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);

export const guardianEmailSchema = z
  .string()
  .max(320)
  .transform(normalizeEmail)
  .pipe(z.email());

/**
 * A parent's waiting request: an invitation addressed to an email (the
 * child's account does not exist yet, as far as the parent knows), or a
 * link request to a named account.
 */
export const guardianRequestRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('invitation'), id: idSchema }),
  z.strictObject({ kind: z.literal('link'), id: idSchema }),
]);
export type GuardianRequestRef = z.infer<typeof guardianRequestRefSchema>;

/**
 * An invitation's life: `open` until the child's first sign-in `claimed`
 * it, or an existing account at that address was asked instead (`linked`),
 * or the parent `cancelled` it. Expiry is read from its date, not stored.
 */
export const guardianInvitationStatuses = [
  'open',
  'claimed',
  'linked',
  'cancelled',
] as const;
export type GuardianInvitationStatus =
  (typeof guardianInvitationStatuses)[number];

/**
 * Every guardian command. The acting person always comes from the
 * principal, never the body. `noticeVersion` is the notice the person was
 * shown, so an agreement to an older text is refused, never recorded as
 * agreement to the new one.
 */
export const guardianCommandSchema = z.discriminatedUnion('type', [
  /** A parent creates their child's account (or, unseen, asks an existing one). */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('create-child-account'),
    firstName: childFirstNameSchema,
    birthMonth: birthMonthSchema,
    email: guardianEmailSchema,
    noticeVersion: z.string().min(1).max(40),
  }),
  /** A parent asks to link a child's existing account, named by username. */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('request-link'),
    username: usernameSchema,
    noticeVersion: z.string().min(1).max(40),
  }),
  /** The parent emails a waiting request again. */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('send-again'),
    request: guardianRequestRefSchema,
  }),
  /** The parent withdraws a request nobody has answered yet. */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('cancel-request'),
    request: guardianRequestRefSchema,
  }),
  /** The child: "yes, this is my parent". */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('confirm-parent'),
    linkId: idSchema,
    noticeVersion: z.string().min(1).max(40),
  }),
  /** The child: "no, this isn't my parent"; Daisy's safety team hears of it. */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('refuse-parent'),
    linkId: idSchema,
  }),
  /** The parent ends an active link. */
  z.strictObject({
    version: z.literal(1),
    type: z.literal('end-link'),
    linkId: idSchema,
  }),
]);
export type GuardianCommand = z.infer<typeof guardianCommandSchema>;
export type GuardianCommandType = GuardianCommand['type'];

/** Every refusal a guardian command can give. */
export const guardianRefusals = [
  /** The acting person is not an adult, so they cannot be anyone's guardian. */
  'not-an-adult',
  /** The birth month is under 13: Daisy is not for children under 13. */
  'under-13',
  /** The birth month is 18 or over: an adult is nobody's child here. */
  'not-a-minor',
  /** The parent's own address. */
  'own-email',
  /** The username names nobody, the parent, or someone who is not a minor. */
  'no-such-child',
  /** An open request or an active link already joins these two people. */
  'already-linked',
  /** The notice changed since it was shown. */
  'notice-changed',
  /** The request or link is not in a state this command applies to. */
  'not-waiting',
  'not-active',
  /** Not found, or not the acting person's to act on. */
  'not-found',
] as const;
export type GuardianRefusal = (typeof guardianRefusals)[number];

export const guardianCommandAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accepted') }),
  z.strictObject({
    kind: z.literal('refused'),
    refusal: z.enum(guardianRefusals),
  }),
]);
export type GuardianCommandAnswer = z.infer<
  typeof guardianCommandAnswerSchema
>;
