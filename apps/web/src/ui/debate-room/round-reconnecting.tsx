import { reconnectDelaySeconds } from './reconnect-delay';
import { RefusedPageRetries } from './refused-page-retries-client';

/**
 * A Round's page whose read was temporarily refused. It takes no Round input:
 * nothing was read or authorized, so it says the same to anyone, and the next
 * read applies every access and redirect rule again. With script the server is
 * asked again in place, keeping everything around this page and focus; with no
 * script a plain refresh does it, always as a GET, so neither replays a form
 * post. The Round's clock stays on the server.
 */
export function RoundReconnecting({
  retrySeconds,
}: {
  readonly retrySeconds: number;
}) {
  return (
    <section className="mx-auto flex max-w-reading flex-col gap-3 p-6">
      <noscript>
        <meta httpEquiv="refresh" content={String(retrySeconds)} />
      </noscript>
      <RefusedPageRetries firstWaitMs={retrySeconds * 1000} />
      <h1 className="font-display text-2xl font-semibold text-ink">
        Reconnecting to the Round
      </h1>
      <p role="status">
        We could not load this page just now. A live Round keeps running on the
        server, so this page tries again by itself every few seconds.
      </p>
      <a className="font-strong underline" href="">
        Try now
      </a>
    </section>
  );
}

/** A temporarily refused Round page, returning at its own jittered moment. */
export function reconnectingRoundPage() {
  const [entropy] = crypto.getRandomValues(new Uint8Array(1));
  return <RoundReconnecting retrySeconds={reconnectDelaySeconds(entropy!)} />;
}
