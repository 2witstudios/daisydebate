/** Per-process transport caps. IPs are private personal data, held only while
 * connected; actor identifiers stay in memory and never enter public replies.
 */
export function createAdmission({
  now,
  maxPerIp,
  maxUnauthenticated,
  maxPerActor,
}: {
  readonly now: () => number;
  readonly maxPerIp: number;
  readonly maxUnauthenticated: number;
  readonly maxPerActor: number;
}) {
  const peers = new Map<string, { total: number; unauthenticated: number }>();
  const actors = new Map<string, number>();
  return {
    reserve(peer: string) {
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
