/** Long enough for a refused lane's one-second wait to pass, short against a speech. */
const RETRY_SECONDS = 2;

/**
 * A Round room whose read was temporarily refused. It shows no Round state
 * because none was read. A plain refresh brings the page back with or without
 * script and always as a GET, so it never replays a form post. The page's next
 * real read decides what renders, and the Round's clock stays on the server.
 */
export function RoundRoomReconnecting() {
  return (
    <section className="mx-auto flex max-w-reading flex-col gap-3 p-6">
      <meta httpEquiv="refresh" content={String(RETRY_SECONDS)} />
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
