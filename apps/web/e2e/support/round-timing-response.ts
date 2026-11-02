import type { Page, Route } from '@playwright/test';

export type ActionRoute = (route: Route) => Promise<void>;

export type RoundClockDelivery = {
  readonly status: number;
  readonly serverNowMs: number | null;
};

type FetchedResponse = {
  status(): number;
  body(): Promise<Buffer>;
};
type DeliveredRoute<Response extends FetchedResponse> = {
  request(): {
    method(): string;
    headers(): Record<string, string>;
    frame(): unknown;
  };
  fallback(): Promise<void>;
  fetch(): Promise<Response>;
  fulfill(options: { response: Response; body: Buffer }): Promise<void>;
};
type Observed =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'captured'; readonly delivery: RoundClockDelivery }
  | { readonly kind: 'failed'; readonly failure: unknown };

const serverNowOf = (body: Buffer) => {
  const instant = /"serverNowMs":(\d+)/.exec(body.toString('utf8'))?.[1];
  return instant === undefined ? null : Number(instant);
};

/**
 * Witnesses the first clock read a resumed Round starts, at delivery time: a
 * browser response body can be gone by the time a listener asks for it. Only
 * status and the server instant are retained; bytes reach the page unchanged.
 */
export function createResumedClockWitness(expected: {
  readonly actionId: string;
  readonly frame: unknown;
  readonly documentEpoch: () => number;
  readonly now: () => number;
}) {
  let armed: { readonly epoch: number; readonly cutoffMs: number } | null =
    null;
  let claimed = false;
  let observed: Observed = { kind: 'waiting' };
  return {
    /** Only requests observed from here on, in this document, can match. */
    arm() {
      armed = { epoch: expected.documentEpoch(), cutoffMs: expected.now() };
    },
    async handle<Response extends FetchedResponse>(
      route: DeliveredRoute<Response>,
    ) {
      const request = route.request();
      if (
        armed === null ||
        claimed ||
        request.method() !== 'POST' ||
        request.headers()['next-action'] !== expected.actionId ||
        request.frame() !== expected.frame ||
        expected.documentEpoch() !== armed.epoch ||
        expected.now() < armed.cutoffMs
      )
        return route.fallback();
      claimed = true;
      try {
        const response = await route.fetch();
        const body = await response.body();
        await route.fulfill({ response, body });
        observed = {
          kind: 'captured',
          delivery: {
            status: response.status(),
            serverNowMs: serverNowOf(body),
          },
        };
      } catch (failure) {
        observed = { kind: 'failed', failure };
      }
    },
    /** The captured delivery, null while waiting; a capture failure throws. */
    read(): RoundClockDelivery | null {
      if (observed.kind === 'failed') throw observed.failure;
      return observed.kind === 'captured' ? observed.delivery : null;
    },
  };
}

const passThrough: ActionRoute = (route) => route.fallback();

/**
 * One long-lived route over a page's Server Actions, whose behavior the
 * journey swaps. `pass` returns to pass-through once in-flight steps finish.
 */
export async function routeServerActions(page: Page, url: string) {
  let current = passThrough;
  const inFlight = new Set<Promise<void>>();
  await page.route(url, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || !request.headers()['next-action'])
      return route.fallback();
    const handled = current(route);
    inFlight.add(handled);
    try {
      await handled;
    } finally {
      inFlight.delete(handled);
    }
  });
  return {
    use(next: ActionRoute) {
      current = next;
    },
    async pass() {
      current = passThrough;
      await Promise.all(inFlight);
    },
  };
}
