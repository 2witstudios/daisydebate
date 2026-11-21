import { nowMs } from '@daisy/clock';
import type Stripe from 'stripe';
import { createId } from '@paralleldrive/cuid2';
import {
  authorize,
  canManageBilling,
  canPurchaseClub,
  clubSeatGrants,
  subscriptionAccess,
} from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import type { BudgetedMemberBoundary } from '../../server/member-boundary';
import { releaseAdmission } from '../flags/admission';
import { createRequestFlagReader } from '../flags/reader';
import { releaseFlagDefault } from '../flags/release-default';
import { CommandDenied } from '../tab/commands/run-command';
import { organizationCommand } from '../tab/operations/organization';
import { stripeCheckoutPort } from '../billing/checkout-vendor';
import { stripePortalPort } from '../billing/portal-session';
import { createClubBilling, stripeClubPlanPort } from '../billing/club-billing';
import { composeClubRoutes, type StartClub } from './routes';

/**
 * The clubs integration root: billing's Club runtime, Tab's organisation
 * command (a club is a Tab organisation) and the club seat store, each
 * handed to the routes as a named input. Loaded lazily with billing, since
 * it holds the Stripe client.
 */
export function composeClubs(
  app: App,
  stripe: Pick<
    Stripe,
    'checkout' | 'billingPortal' | 'subscriptions' | 'invoices'
  > | null,
  boundary: BudgetedMemberBoundary,
) {
  const config = app.config.billing;
  const club =
    config.kind === 'stripe' && config.club !== null
      ? { mode: config.mode, club: config.club }
      : null;
  const releaseDefault = releaseFlagDefault(app.config);
  const flags = createRequestFlagReader({
    read: app.database.readFlagSnapshot,
    now: () => nowMs(app.clock),
    diagnostic: () =>
      app.logger.log(
        'flags.read.failed',
        { operation: 'flags.read', cause: 'unavailable' },
        'Release control read failed',
      ),
    releaseDefault,
  });
  const member = app.database.billingMember({
    manage: canManageBilling,
    purchase: canPurchaseClub,
    granted: () => false,
  });
  const seats = app.database.clubSeats(
    clubSeatGrants,
    (evidence, now) => subscriptionAccess(evidence, now).kind !== 'none',
  );
  const returnOrigin = new URL(app.auth().config.PUBLIC_APP_URL).origin;
  const billing = createClubBilling({
    vendor:
      club && stripe
        ? {
            ...club,
            checkout: stripeCheckoutPort(stripe),
            portal: stripePortalPort(stripe),
            plan: stripeClubPlanPort(stripe),
          }
        : null,
    clock: app.clock,
    returnOrigin,
    nextId: createId,
    purchases: app.database.billingPurchases({
      purchase: canPurchaseClub,
      manage: canManageBilling,
      release: releaseAdmission('club-seats', releaseDefault),
    }),
    member,
    seats,
  });
  const ownMember = app.database.billingMember({
    manage: canManageBilling,
    purchase: canManageBilling,
    granted: () => false,
  });
  const createOrganization = (organizationId: string) =>
    organizationCommand({
      store: app.database.tabCommands,
      authorize,
      now: () => app.clock.now(),
      newId: () => organizationId,
    });

  return composeClubRoutes({
    boundary,
    configured: club !== null && stripe !== null,
    released: async (userId) => {
      try {
        return await flags('club-seats', userId);
      } catch {
        return false;
      }
    },
    seats,
    reads: app.database.clubSeatReads,
    billing: {
      checkout: billing.checkout,
      portal: billing.portal,
      changeSeats: billing.changeSeats,
      invoices: billing.invoices,
      ownPremium: async (subject) => {
        const source = await ownMember.read(subject);
        if (!source.evidence) return false;
        return subscriptionAccess(source.evidence, source.now).kind !== 'none';
      },
    },
    createClub: async (subject, input: Omit<StartClub, 'seats'>) => {
      const organizationId = createId();
      try {
        const answer = await createOrganization(organizationId)(
          { kind: 'user', userId: subject.userId, actorId: subject.actorId },
          {
            version: 1,
            commandId: createId(),
            expected: {},
            command: {
              type: 'create-organization',
              kind: input.kind,
              name: input.name,
              handle: input.handle,
            },
          },
        );
        if (answer.kind === 'accepted') return { organizationId };
        return answer.kind === 'refused' && answer.refusal === 'handle-taken'
          ? { refusal: 'handle-taken' }
          : { refusal: 'not-allowed' };
      } catch (error) {
        if (error instanceof CommandDenied) return { refusal: 'not-allowed' };
        throw error;
      }
    },
  });
}
