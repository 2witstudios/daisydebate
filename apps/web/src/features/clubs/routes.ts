import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import type { ClubSeatAnswer, ClubSeatingRead } from '@daisy/db';
import type { createClubSeatCommands } from './invitation-resend';
import { clubSeatBounds } from '@daisy/protocol/club-seats';
import { readJson } from '../../server/http';
import {
  runEvaluatedRoute,
  runMemberRoute,
  type BudgetedMemberBoundary,
  type MemberCaller,
} from '../../server/member-boundary';
import type { PurchaseDestination } from '../billing/purchase-flow';
import type { ClubInvoiceRow, SeatChangeAnswer } from '../billing/club-billing';
import {
  clubBillingView,
  clubSeatsView,
  clubInvitationViewSchema,
  type ClubInvitationView,
} from './views';

const id = z.string().regex(/^[a-z0-9]{24}$/);
const email = z.string().trim().toLowerCase().max(320).pipe(z.email());
const member = z.strictObject({ kind: z.literal('member'), userId: id });
const invitee = z.strictObject({ kind: z.literal('invite'), email });

/** What a manager may send: the club comes from the path, never the body. */
const clubSeatCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('invite'), email }),
  z.strictObject({ kind: z.literal('assign'), userId: id }),
  z.strictObject({
    kind: z.literal('move'),
    fromUserId: id,
    to: z.discriminatedUnion('kind', [member, invitee]),
  }),
  z.strictObject({ kind: z.literal('remove'), userId: id }),
  z.strictObject({ kind: z.literal('cancel'), invitationId: id }),
  z.strictObject({ kind: z.literal('resend'), invitationId: id }),
]);
const seatCountChangeSchema = z.strictObject({
  seatCount: z.number().int().min(1).max(clubSeatBounds.maxSeats),
  release: z
    .strictObject({
      seats: z.array(id).max(clubSeatBounds.maxSeats),
      invitations: z.array(id).max(clubSeatBounds.maxSeats),
    })
    .default({ seats: [], invitations: [] }),
});
const startClubSchema = z.strictObject({
  kind: z.enum(['school', 'family']),
  name: z.string().trim().min(2).max(80),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  seats: z.number().int().min(1).max(clubSeatBounds.maxSeats),
});
export type StartClub = z.infer<typeof startClubSchema>;

const headers = { 'cache-control': 'no-store' };
/** The club a `[club]` route param names; anything else is not found. */
export function clubIdOf(club: string) {
  const parsed = id.safeParse(club);
  if (!parsed.success) throw createAppError('NOT_FOUND');
  return parsed.data;
}
/** The `[invitation]` route param: `<club>.<invitation>`. */
export function invitationOf(invitation: string) {
  const [organizationId, invitationId, ...rest] = invitation.split('.');
  const club = id.safeParse(organizationId);
  const invited = id.safeParse(invitationId);
  if (!club.success || !invited.success || rest.length)
    throw createAppError('NOT_FOUND');
  return { organizationId: club.data, invitationId: invited.data };
}

async function formSeats(request: Request) {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/x-www-form-urlencoded'
  )
    throw createAppError('VALIDATION');
  const form = new URLSearchParams(await request.text());
  const seats = z.coerce
    .number()
    .int()
    .min(1)
    .max(clubSeatBounds.maxSeats)
    .safeParse(form.get('seats'));
  if (!seats.success || [...form.keys()].some((key) => key !== 'seats'))
    throw createAppError('VALIDATION');
  return seats.data;
}

/** The clubs feature's inputs, each a named published operation of its owner. */
export type ClubRouteDependencies = {
  readonly boundary: BudgetedMemberBoundary;
  /** The `club-seats` release flag for this account (display and admission). */
  readonly released: (userId: string) => Promise<boolean>;
  readonly configured: boolean;
  readonly seats: {
    readonly command: (
      subject: MemberCaller,
      organizationId: string,
      command: Parameters<
        ReturnType<typeof createClubSeatCommands>['command']
      >[2],
    ) => Promise<ClubSeatAnswer>;
    readonly answer: (
      subject: MemberCaller,
      organizationId: string,
      invitationId: string,
      answer: 'accept' | 'decline',
    ) => Promise<ClubSeatAnswer>;
  };
  readonly reads: {
    readonly seating: (
      subject: MemberCaller,
      organizationId: string,
    ) => Promise<ClubSeatingRead | null>;
    readonly invitation: (
      subject: MemberCaller,
      organizationId: string,
      invitationId: string,
    ) => Promise<
      | (Omit<
          Extract<ClubInvitationView, { kind: 'open' }>,
          'kind' | 'ownPremium'
        > & {
          readonly expired: boolean;
          readonly seatedHere: boolean;
          readonly seatedElsewhere: boolean;
        })
      | null
    >;
  };
  /** Billing's Club runtime: checkout, portal, seat changes and invoices. */
  readonly billing: {
    readonly checkout: (
      subject: MemberCaller,
      organizationId: string,
      seats: number,
    ) => Promise<PurchaseDestination | { readonly kind: 'unavailable' }>;
    readonly portal: (
      subject: MemberCaller,
      organizationId: string,
    ) => Promise<
      | { readonly kind: 'redirect'; readonly url: string }
      | { readonly kind: 'unavailable' }
    >;
    readonly changeSeats: (
      subject: MemberCaller,
      organizationId: string,
      seatCount: number,
      release: {
        readonly seats: readonly string[];
        readonly invitations: readonly string[];
      },
    ) => Promise<SeatChangeAnswer>;
    readonly invoices: (
      subject: MemberCaller,
      organizationId: string,
      vendorSubscriptionId: string,
    ) => Promise<readonly ClubInvoiceRow[]>;
    /** Whether the person pays for Premium themselves. */
    readonly ownPremium: (subject: MemberCaller) => Promise<boolean>;
  };
  /** Tab's organisation command, creating the club; null when the handle is taken. */
  readonly createClub: (
    principal: { readonly userId: string; readonly actorId: string },
    club: Omit<StartClub, 'seats'>,
  ) => Promise<
    | { readonly organizationId: string }
    | { readonly refusal: 'handle-taken' | 'not-allowed' }
  >;
};

/**
 * The clubs routes (ADR 0148), all behind the `club-seats` release flag:
 * the manager's seats and billing, the invitee's answer, and starting a
 * club. A club the subject does not manage answers not found.
 */
export function composeClubRoutes(input: ClubRouteDependencies) {
  const { boundary } = input;
  const gate = async (subject: MemberCaller) => {
    if (!(await input.released(subject.userId)))
      throw createAppError('NOT_FOUND');
  };
  const seating = async (subject: MemberCaller, organizationId: string) => {
    const read = await input.reads.seating(subject, organizationId);
    if (!read) throw createAppError('NOT_FOUND');
    return read;
  };
  const redirect = (location: string) =>
    new Response(null, {
      status: 303,
      headers: { ...headers, 'referrer-policy': 'no-referrer', location },
    });
  const billingPage = (organizationId: string, notice?: string) =>
    new URL(
      `/clubs/${organizationId}/billing${notice ? `?notice=${notice}` : ''}`,
      boundary.origin(),
    ).href;
  const destination = (
    result: PurchaseDestination | { readonly kind: 'unavailable' },
    organizationId: string,
  ) =>
    result.kind === 'redirect'
      ? result.url
      : billingPage(
          organizationId,
          result.kind === 'pending'
            ? 'purchase-pending'
            : 'billing-unavailable',
        );

  return {
    seats: {
      GET: (request: Request, club: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.seats.read',
            readOnly: true,
            bucket: 'clubs:read',
            rule: { max: 120, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const read = await seating(subject, clubIdOf(club));
            return Response.json(clubSeatsView(read), { headers });
          },
        ),
      POST: (request: Request, club: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.seats.command',
            readOnly: false,
            bucket: 'clubs:seats',
            rule: { max: 60, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const command = clubSeatCommandSchema.safeParse(
              await readJson(request, 4096),
            );
            if (!command.success) throw createAppError('VALIDATION');
            return Response.json(
              await input.seats.command(
                subject,
                clubIdOf(club),
                command.data,
              ),
              { headers },
            );
          },
        ),
    },
    billing: {
      GET: (request: Request, club: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.billing.read',
            readOnly: true,
            bucket: 'clubs:read',
            rule: { max: 120, windowSeconds: 60 },
          },
          async (subject) => {
            const released = await input.released(subject.userId);
            if (!released) throw createAppError('NOT_FOUND');
            const organizationId = clubIdOf(club);
            const read = await seating(subject, organizationId);
            const invoices = read.plan.vendorSubscriptionId
              ? await input.billing.invoices(
                  subject,
                  organizationId,
                  read.plan.vendorSubscriptionId,
                )
              : [];
            return Response.json(
              clubBillingView(read, {
                invoices,
                configured: input.configured,
                released,
              }),
              { headers },
            );
          },
        ),
      checkout: (request: Request, club: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.billing.checkout',
            readOnly: false,
            evaluatorDecides: true,
            bucket: 'clubs:checkout',
            rule: { max: 10, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const organizationId = clubIdOf(club);
            const seats = await formSeats(request);
            return redirect(
              destination(
                await input.billing.checkout(subject, organizationId, seats),
                organizationId,
              ),
            );
          },
        ),
      portal: (request: Request, club: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.billing.portal',
            readOnly: false,
            evaluatorDecides: true,
            bucket: 'clubs:portal',
            rule: { max: 10, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const organizationId = clubIdOf(club);
            await seating(subject, organizationId);
            const result = await input.billing.portal(subject, organizationId);
            return redirect(
              result.kind === 'redirect'
                ? result.url
                : billingPage(organizationId, 'billing-unavailable'),
            );
          },
        ),
      seats: (request: Request, club: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.billing.seats',
            readOnly: false,
            bucket: 'clubs:seat-count',
            rule: { max: 10, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const change = seatCountChangeSchema.safeParse(
              await readJson(request, 16_384),
            );
            if (!change.success) throw createAppError('VALIDATION');
            return Response.json(
              await input.billing.changeSeats(
                subject,
                clubIdOf(club),
                change.data.seatCount,
                change.data.release,
              ),
              { headers },
            );
          },
        ),
    },
    invitation: {
      GET: (request: Request, invitation: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.invitation.read',
            readOnly: true,
            bucket: 'clubs:read',
            rule: { max: 60, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const { organizationId, invitationId } = invitationOf(invitation);
            const read = await input.reads.invitation(
              subject,
              organizationId,
              invitationId,
            );
            if (!read) throw createAppError('NOT_FOUND');
            const base = {
              club: { name: read.club.name, kind: read.club.kind },
              manager: read.manager,
            };
            const view: ClubInvitationView = read.seatedHere
              ? { kind: 'seated-here', ...base }
              : read.seatedElsewhere
                ? { kind: 'seated-elsewhere', ...base }
                : read.expired
                  ? { kind: 'expired', ...base }
                  : {
                      kind: 'open',
                      ...base,
                      email: read.email,
                      expiresAt: read.expiresAt,
                      ownPremium: await input.billing.ownPremium(subject),
                    };
            return Response.json(clubInvitationViewSchema.parse(view), {
              headers,
            });
          },
        ),
      POST: (request: Request, invitation: string) =>
        runMemberRoute(
          boundary,
          request,
          {
            name: 'clubs.invitation.answer',
            readOnly: false,
            bucket: 'clubs:answer',
            rule: { max: 20, windowSeconds: 60 },
          },
          async (subject) => {
            await gate(subject);
            const { organizationId, invitationId } = invitationOf(invitation);
            const body = z
              .strictObject({ answer: z.enum(['accept', 'decline']) })
              .safeParse(await readJson(request, 256));
            if (!body.success) throw createAppError('VALIDATION');
            return Response.json(
              await input.seats.answer(
                subject,
                organizationId,
                invitationId,
                body.data.answer,
              ),
              { headers },
            );
          },
        ),
    },
    /** Start a club: create the organisation, then open Checkout for its seats. */
    create: (request: Request) =>
      runEvaluatedRoute(boundary, request, {
        name: 'clubs.create',
        readOnly: false,
        readInput: async () =>
          startClubSchema.safeParse(await readJson(request, 2048)),
        operation: async (value, principal) => {
          const parsed = value as ReturnType<typeof startClubSchema.safeParse>;
          if (principal.kind !== 'user' || principal.actorId === null)
            throw createAppError('NOT_FOUND');
          const subject = {
            userId: principal.userId,
            actorId: principal.actorId,
          };
          await gate(subject);
          if (!parsed.success) throw createAppError('VALIDATION');
          const { seats, ...club } = parsed.data;
          const created = await input.createClub(subject, club);
          if ('refusal' in created)
            return { kind: 'refused', refusal: created.refusal } as const;
          // The club exists now; a Checkout that cannot open leaves the
          // manager on its billing page to retry, never a second club.
          const result = await input.billing
            .checkout(subject, created.organizationId, seats)
            .catch(() => ({ kind: 'unavailable' }) as const);
          return {
            kind: 'created',
            organizationId: created.organizationId,
            location: destination(result, created.organizationId),
          } as const;
        },
        headers,
      }),
  };
}
