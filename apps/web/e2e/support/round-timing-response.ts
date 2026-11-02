import type { Page, Request, Route } from '@playwright/test';

export type StepRoute = (route: Route) => Promise<void>;

export type RoundClockDelivery = {
  readonly status: number;
  readonly serverNowMs: number | null;
};

type FetchedResponse = {
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
};
type DeliveredRoute<Response extends FetchedResponse> = {
  request(): { frame(): unknown };
  fallback(): Promise<void>;
  fetch(): Promise<Response>;
  fulfill(options: { response: Response; body: Buffer }): Promise<void>;
};
type Observed =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'captured'; readonly delivery: RoundClockDelivery }
  | { readonly kind: 'failed'; readonly failure: unknown };

const serverNowOf = (header: string | undefined) =>
  header !== undefined && /^\d+$/.test(header) ? Number(header) : null;

/**
 * Witnesses the first clock read the page starts after arming, at delivery
 * time. Only status and the server instant are retained; bytes reach the page
 * unchanged. Route it to the clock URL only.
 */
export function createClockReadWitness(expected: {
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
      if (
        armed === null ||
        claimed ||
        route.request().frame() !== expected.frame ||
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
            serverNowMs: serverNowOf(response.headers()['x-server-now-ms']),
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

const passThrough: StepRoute = (route) => route.fallback();

/**
 * One long-lived route whose behavior the journey swaps. Replacing the route
 * between steps left requests no handler saw. `pass` returns to pass-through
 * once in-flight steps finish.
 */
export async function routeStepped(
  page: Pick<Page, 'route'>,
  url: string,
  matches: (request: Pick<Request, 'method' | 'headers'>) => boolean,
) {
  let current = passThrough;
  const inFlight = new Set<Promise<void>>();
  await page.route(url, async (route) => {
    if (!matches(route.request())) return route.fallback();
    const handled = current(route);
    inFlight.add(handled);
    try {
      await handled;
    } finally {
      inFlight.delete(handled);
    }
  });
  return {
    use(next: StepRoute) {
      current = next;
    },
    async pass() {
      current = passThrough;
      await Promise.all(inFlight);
    },
  };
}
