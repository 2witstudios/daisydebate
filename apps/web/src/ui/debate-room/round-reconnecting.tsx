import { reconnectDelaySeconds } from './reconnect-delay';
import { ReloadAfter } from './reload-after';

/**
 * A Round's page whose read was temporarily refused. It takes no Round input:
 * nothing was read or authorized, so it says the same to anyone, and the next
 * load applies every access and redirect rule again. A plain refresh brings
 * the page back with or without script and always as a GET, so it never
 * replays a form post. The Round's clock stays on the server.
 */
export function RoundReconnecting({
  retrySeconds,
  shell = false,
}: {
  readonly retrySeconds: number;
  /** The page has shell links, so script retries and no-script gets the refresh. */
  readonly shell?: boolean;
}) {
  const refresh = <meta httpEquiv="refresh" content={String(retrySeconds)} />;
  return (
    <section className="mx-auto flex max-w-reading flex-col gap-3 p-6">
      {shell ? (
        <>
          <noscript>{refresh}</noscript>
          <ReloadAfter seconds={retrySeconds} />
        </>
      ) : (
        refresh
      )}
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
export function reconnectingRoundPage(shell = false) {
  const [entropy] = crypto.getRandomValues(new Uint8Array(1));
  return (
    <RoundReconnecting
      retrySeconds={reconnectDelaySeconds(entropy!)}
      shell={shell}
    />
  );
}
