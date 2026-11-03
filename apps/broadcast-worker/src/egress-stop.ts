/** LiveKit's answer when the Egress has already ended or is no longer known. */
const ALREADY_GONE = new Set([404, 412]);

/**
 * Stops an Egress with a pre-signed token, so this process never holds the LiveKit
 * key pair, which could sign any grant. The token carries only `roomRecord`, the
 * narrowest grant LiveKit offers for this call. Resolves once the Egress is stopping
 * or already gone; anything else throws, and the next check tries again.
 */
export const createEgressStopper =
  (deps: {
    readonly url: string;
    readonly token: string;
    readonly fetch: (
      url: string,
      init: {
        readonly method: 'POST';
        readonly headers: Readonly<Record<string, string>>;
        readonly body: string;
      },
    ) => Promise<{ readonly ok: boolean; readonly status: number }>;
  }) =>
  async (egressId: string): Promise<void> => {
    const base = deps.url.replace(/^ws/, 'http').replace(/\/$/, '');
    const answer = await deps.fetch(`${base}/twirp/livekit.Egress/StopEgress`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ egressId }),
    });
    if (!answer.ok && !ALREADY_GONE.has(answer.status))
      throw new Error(`stop egress answered ${answer.status}`);
  };
