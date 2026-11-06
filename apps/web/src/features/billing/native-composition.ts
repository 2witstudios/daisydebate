import { createAppError } from '@daisy/errors';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
} from '../../server/member-boundary';
import { createBillingNativeHandlers } from './native-handlers';
import type { NativeBillingRuntime } from './native-runtime';

/** The integration root supplies the real transport and current application lifetime. */
export function composeBillingRoutes(input: {
  readonly boundary: BudgetedMemberBoundary;
  readonly runtime: () => NativeBillingRuntime;
}) {
  const forms = createBillingNativeHandlers({
    boundary: input.boundary,
    checkout: (subject) => input.runtime().checkout(subject),
    portal: (subject) => input.runtime().portal(subject),
  });
  return {
    checkout: { POST: forms.checkout },
    portal: { POST: forms.portal },
    settings: {
      GET: (request: Request) =>
        runMemberRoute(
          input.boundary,
          request,
          {
            name: 'billing.settings',
            readOnly: true,
            evaluatorDecides: true,
            bucket: 'billing:settings',
            rule: { max: 60, windowSeconds: 60 },
          },
          async (subject) => {
            if (new URL(request.url).search !== '')
              throw createAppError('VALIDATION');
            return Response.json(await input.runtime().settings(subject), {
              headers: { 'cache-control': 'no-store' },
            });
          },
        ),
    },
  };
}
