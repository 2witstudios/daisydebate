/** Per-process transport caps. IPs are private personal data, held only while
 * connected or until the bounded upgrade window expires; actor identifiers
 * stay in memory and never enter public replies. Window tuning grants no
 * authority and declares no new product policy.
 */
export function createAdmission({
  now,
  maxPerIp,
  maxUnauthenticated,
  maxPerActor,
  maxUpgradesPerWindow = 60,
  upgradeWindowMs = 60_000,
}: {
  readonly now: () => number;
  readonly maxPerIp: number;
  readonly maxUnauthenticated: number;
  readonly maxPerActor: number;
  readonly maxUpgradesPerWindow?: number;
  readonly upgradeWindowMs?: number;
}) {
  const peers = new Map<string, { total: number; unauthenticated: number }>();
  const upgrades = new Map<string, { start: number; attempts: number }>();
  const actors = new Map<string, number>();
  return {
    reserve(peer: string) {
      const instant = now();
      let window = upgrades.get(peer);
      if (!window || instant - window.start >= upgradeWindowMs) {
        // Bounded memory even when callers rotate peer addresses.
        if (!window && upgrades.size >= 10_000) {
          for (const [key, value] of upgrades)
            if (instant - value.start >= upgradeWindowMs) upgrades.delete(key);
          if (upgrades.size >= 10_000) return null;
        }
        window = { start: instant, attempts: 0 };
        upgrades.set(peer, window);
      }
      window.attempts += 1;
      if (window.attempts > maxUpgradesPerWindow) return null;
      const counts = peers.get(peer) ?? { total: 0, unauthenticated: 0 };
      if (
        counts.total >= maxPerIp ||
        counts.unauthenticated >= maxUnauthenticated ||
        peers.size >= 10_000
      )
        return null;
      counts.total += 1;
      counts.unauthenticated += 1;
      peers.set(peer, counts);
      let actor: string | undefined;
      let released = false;
      let frameStart = now();
      let frames = 0;
      return {
        authenticate(actorId: string) {
          if (released || actor) return false;
          const count = actors.get(actorId) ?? 0;
          if (count >= maxPerActor) return false;
          actor = actorId;
          actors.set(actorId, count + 1);
          counts.unauthenticated -= 1;
          return true;
        },
        inbound() {
          const current = now();
          if (current - frameStart >= 1_000) {
            frameStart = current;
            frames = 0;
          }
          frames += 1;
          return !released && frames <= 60;
        },
        release() {
          if (released) return;
          released = true;
          counts.total -= 1;
          if (!actor) counts.unauthenticated -= 1;
          else {
            const count = (actors.get(actor) ?? 1) - 1;
            if (count <= 0) actors.delete(actor);
            else actors.set(actor, count);
          }
          if (counts.total === 0) peers.delete(peer);
        },
      };
    },
  };
}
export type AdmissionReservation = NonNullable<
  ReturnType<ReturnType<typeof createAdmission>['reserve']>
>;
