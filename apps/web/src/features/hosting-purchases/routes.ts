import { defineComposition } from '../../server/composition';
import { hostingPurchaseDependencies } from './dependencies';
import { memberHttpBoundary } from '../auth/member-boundary';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { paidHostingTiers } from '@daisy/protocol/lobby/hosting-tier';
import {
  hostedTournamentsViewSchema,
  hostingAccountViewSchema,
} from '@daisy/protocol/lobby/hosting-read';
import { parseValidated, readBytes } from '../../server/http';
import {
  runEvaluatedRoute,
  runMemberRoute,
  type BudgetedMemberBoundary,
} from '../auth/member-boundary';
import { hostRoutes } from '../tab/routes';
import type { TabPrincipal } from '../tab/tab-principal';
import {
  readHostingAccount,
  settleHostingPurchase,
  startHostingCheckout,
  type HostingDependencies,
} from './checkout';
import { readHostedTournaments } from './hosted-tournaments';

const handleSchema = z.string().min(1).max(80);
export const hostedTournamentsPath = '/api/tab/hosted-tournaments';
export const hostingAccountPath = (handle: string, purchase?: string) =>
  `/api/tab/hosting?${new URLSearchParams({ handle, ...(purchase ? { purchase } : {}) })}`;
export const hostingCheckoutPath = (handle: string) =>
  `/api/tab/hosting-checkout?${new URLSearchParams({ handle })}`;
/** The fixed notice the upgrade page shows when checkout cannot start. */
export const hostingUnavailableNotice = 'hosting-unavailable';

const asUser = (principal: { readonly kind: string }): TabPrincipal => {
  if (principal.kind !== 'user') throw createAppError('NOT_FOUND');
  return principal as TabPrincipal;
};

function composeHostingRoutes(input: {
  readonly boundary: BudgetedMemberBoundary;
  /** The hosting resources over this process's vendor transport. */
  readonly dependencies: (
    fetch: typeof globalThis.fetch,
  ) => HostingDependencies;
  readonly lobbyIdOfHandle: (handle: string) => Promise<string | null>;
}) {
  const lobbyOf = async (handle: unknown) => {
    const id = await input.lobbyIdOfHandle(
      parseValidated(handleSchema, handle),
    );
    if (!id) throw createAppError('NOT_FOUND');
    return id;
  };
  return {
    home: (
      released: (userId: string) => Promise<boolean>,
      fetch: typeof globalThis.fetch,
    ) => ({
      GET: (request: Request) =>
        runEvaluatedRoute(input.boundary, request, {
          name: 'tab.hosting.home',
          readOnly: true,
          readInput: async () => undefined,
          operation: async (_value, principal) => {
            const user = asUser(principal);
            if (!(await released(user.userId)))
              throw createAppError('NOT_FOUND');
            return hostedTournamentsViewSchema.parse(
              await readHostedTournaments(input.dependencies(fetch))(user),
            );
          },
          headers: { 'cache-control': 'no-store' },
        }),
    }),
    account: (
      released: (userId: string) => Promise<boolean>,
      fetch: typeof globalThis.fetch,
    ) => ({
      GET: (request: Request) =>
        runEvaluatedRoute(input.boundary, request, {
          name: 'tab.hosting.account',
          readOnly: true,
          readInput: async () => undefined,
          operation: async (_value, principal) => {
            const user = asUser(principal);
            if (!(await released(user.userId)))
              throw createAppError('NOT_FOUND');
            const query = parseValidated(
              z.strictObject({
                handle: handleSchema,
                purchase: idSchema.optional(),
              }),
              Object.fromEntries(new URL(request.url).searchParams),
            );
            const lobbyId = await lobbyOf(query.handle);
            const dependencies = input.dependencies(fetch);
            const view = await readHostingAccount(dependencies)(user, lobbyId);
            if (!view) throw createAppError('NOT_FOUND');
            // A host returning from Checkout settles at once if Stripe has
            // finished; the webhook does the same, and settling twice is a no-op.
            if (
              query.purchase &&
              view.payments.some(
                (payment) =>
                  payment.id === query.purchase && payment.state === 'open',
              )
            ) {
              await settleHostingPurchase(dependencies)({
                lobbyId,
                purchaseId: query.purchase,
              }).catch(() => null);
              const settled = await readHostingAccount(dependencies)(
                user,
                lobbyId,
              );
              if (!settled) throw createAppError('NOT_FOUND');
              return hostingAccountViewSchema.parse(settled);
            }
            return hostingAccountViewSchema.parse(view);
          },
          headers: { 'cache-control': 'no-store' },
        }),
    }),
    checkout: (
      released: (userId: string) => Promise<boolean>,
      fetch: typeof globalThis.fetch,
    ) => ({
      POST: (request: Request) =>
        runMemberRoute(
          input.boundary,
          request,
          {
            name: 'tab.hosting.checkout',
            readOnly: false,
            evaluatorDecides: true,
            bucket: 'tab:hosting-checkout',
            rule: { max: 10, windowSeconds: 60 },
          },
          async (caller) => {
            if (!(await released(caller.userId)))
              throw createAppError('NOT_FOUND');
            const handle = new URL(request.url).searchParams.get('handle');
            const lobbyId = await lobbyOf(handle);
            if (
              request.headers.get('content-type')?.split(';')[0]?.trim() !==
              'application/x-www-form-urlencoded'
            )
              throw createAppError('VALIDATION');
            const form = new URLSearchParams(
              new TextDecoder('utf-8', { fatal: true }).decode(
                request.body ? await readBytes(request, 512) : new Uint8Array(),
              ),
            );
            if ([...form.keys()].some((key) => key !== 'tier'))
              throw createAppError('VALIDATION');
            const tier = parseValidated(
              z.enum(paidHostingTiers),
              form.get('tier'),
            );
            const answer = await startHostingCheckout(
              input.dependencies(fetch),
            )({ kind: 'user', ...caller }, lobbyId, tier);
            const slug = parseValidated(handleSchema, handle);
            const location =
              answer.kind === 'redirect'
                ? answer.url
                : new URL(
                    answer.kind === 'held'
                      ? hostRoutes.billing(slug)
                      : `${hostRoutes.upgrade(slug)}?notice=${hostingUnavailableNotice}`,
                    input.boundary.origin(),
                  ).href;
            return new Response(null, {
              status: 303,
              headers: {
                'cache-control': 'no-store',
                'referrer-policy': 'no-referrer',
                location,
              },
            });
          },
        ),
    }),
  };
}

/** hosting: the hosting purchase routes bind here (`processRoute`). */
export const hostingComposition = defineComposition('hosting', (app) =>
  composeHostingRoutes({
    boundary: memberHttpBoundary(app),
    dependencies: (fetch) => hostingPurchaseDependencies(app, fetch),
    lobbyIdOfHandle: (handle) =>
      app.database.tabCommands.lobbyIdOfHandle(handle),
  }),
);
