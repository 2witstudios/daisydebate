import { createAppError } from '@daisy/errors';
import { readBytes } from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
  type MemberCaller,
} from '../../server/member-boundary';
import type { PurchaseDestination } from './purchase-flow';

type Destination = PurchaseDestination | { readonly kind: 'unavailable' };
const headers = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
};

/** The native form carries only the act of the member, never payment authority. */
async function emptyForm(request: Request) {
  if (new URL(request.url).search !== '' || request.method !== 'POST')
    throw createAppError('VALIDATION');
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/x-www-form-urlencoded'
  )
    throw createAppError('VALIDATION');
  const bytes = request.body ? await readBytes(request, 512) : new Uint8Array();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw createAppError('VALIDATION');
  }
  if ([...new URLSearchParams(text)].length !== 0)
    throw createAppError('VALIDATION');
}

/** Native redirects reveal neither customer identifiers nor vendor errors in a notice. */
export function createBillingNativeHandlers(input: {
  readonly boundary: BudgetedMemberBoundary;
  readonly checkout: (subject: MemberCaller) => Promise<Destination>;
  readonly portal: (subject: MemberCaller) => Promise<Destination>;
}) {
  const post = (kind: 'checkout' | 'portal', request: Request) =>
    runMemberRoute(
      input.boundary,
      request,
      {
        name: kind === 'checkout' ? 'billing.checkout' : 'billing.portal',
        readOnly: false,
        evaluatorDecides: true,
        bucket: `billing:${kind}`,
        rule: { max: 10, windowSeconds: 60 },
      },
      async (subject) => {
        await emptyForm(request);
        const result = await input[kind](subject);
        const location =
          result.kind === 'redirect'
            ? result.url
            : new URL(
                `/settings/billing?notice=${result.kind === 'pending' ? 'purchase-pending' : 'billing-unavailable'}`,
                input.boundary.origin(),
              ).href;
        return new Response(null, {
          status: 303,
          headers: { ...headers, location },
        });
      },
    );
  return {
    checkout: (request: Request) => post('checkout', request),
    portal: (request: Request) => post('portal', request),
  };
}
