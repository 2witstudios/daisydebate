/** The offline banner. Pure: the client shell decides when it shows. */
export function renderOfflineNotice(props: { readonly offline: boolean }) {
  if (!props.offline) return null;
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-md border border-gold-border bg-gold-soft p-3 text-sm"
    >
      <span className="inline-flex items-center gap-1 rounded-round bg-gold-soft px-3 py-1 text-2xs font-heavy tracking-wider text-gold uppercase">
        Offline
      </span>
      You are offline. Nothing you change here is stored on this device yet, so
      reconnect before you rely on it.
    </p>
  );
}
