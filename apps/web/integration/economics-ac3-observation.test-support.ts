/** Private TEST observations only; no provider payload, account or vendor identity. */
export type ObservedFeature = 'casual_ai_judge' | 'round_analysis';
export type DispatchEvent = {
  readonly feature: ObservedFeature;
  readonly token: number;
  readonly sequence: number;
  readonly monotonicMs: number;
  readonly kind: 'enter' | 'known-settle' | 'unknown';
};

/** Derive high-water independently from actual intervals, never from final SQL totals or configured limits. */
export function dispatchFacts(
  events: readonly DispatchEvent[],
  feature: ObservedFeature,
) {
  const active = new Set<number>();
  let calls = 0,
    known = 0,
    unknown = 0,
    peak = 0;
  for (const event of events.filter((event) => event.feature === feature)) {
    if (event.kind === 'enter') {
      if (active.has(event.token)) throw Error('Duplicate dispatch entry');
      active.add(event.token);
      calls++;
      peak = Math.max(peak, active.size);
    } else {
      if (!active.delete(event.token))
        throw Error('Settlement lacks original dispatch');
      if (event.kind === 'known-settle') known++;
      else unknown++;
    }
  }
  return { calls, known, unknown, peak, active: active.size };
}

export function observeDispatches(now: () => number) {
  const events: DispatchEvent[] = [];
  let token = 0;
  const record = (
    feature: ObservedFeature,
    id: number,
    kind: DispatchEvent['kind'],
  ) => {
    events.push({
      feature,
      token: id,
      kind,
      sequence: events.length,
      monotonicMs: now(),
    });
  };
  return {
    events,
    async call<T>(
      feature: ObservedFeature,
      work: () => Promise<T>,
    ): Promise<T> {
      const id = ++token;
      record(feature, id, 'enter');
      try {
        const result = await work();
        record(feature, id, 'known-settle');
        return result;
      } catch (error) {
        record(feature, id, 'unknown');
        throw error;
      }
    },
    facts: (feature: ObservedFeature) => dispatchFacts(events, feature),
  };
}
