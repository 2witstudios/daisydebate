/** The supervisor consumes status privately; raw node data never reaches logs. */
export function ingressReady(value: unknown, origin: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const status = value as {
    BackendState?: unknown;
    Self?: { DNSName?: unknown };
  };
  return (
    status.BackendState === 'Running' &&
    status.Self?.DNSName === `${new URL(origin).hostname}.`
  );
}

export function ingressPreferencesSafe(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const prefs = value as Record<string, unknown>;
  return (
    prefs.RunSSH === false &&
    prefs.RouteAll === false &&
    prefs.CorpDNS === false &&
    prefs.ExitNodeID === '' &&
    prefs.ExitNodeIP === '' &&
    (prefs.AdvertiseRoutes === null ||
      (Array.isArray(prefs.AdvertiseRoutes) &&
        prefs.AdvertiseRoutes.length === 0))
  );
}

if (import.meta.main) {
  try {
    const value: unknown = JSON.parse(await Bun.stdin.text());
    const ready =
      process.argv[2] === 'prefs'
        ? ingressPreferencesSafe(value)
        : ingressReady(value, process.env.ADMIN_ORIGIN ?? '');
    process.exitCode = ready ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
