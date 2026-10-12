import {
  observationResourceKey,
  type ObservationResource,
} from '@daisy/protocol';

/** Node-local purge generations per resource. Older generations are refused;
 * a newer one reports that existing permits must become uncertain.
 */
export function createObservationPurges() {
  const purges = new Map<string, number>();
  return {
    advance(resource: ObservationResource, purgeGeneration: number) {
      const key = observationResourceKey(resource);
      const known = purges.get(key);
      if (known !== undefined && purgeGeneration < known) return 'stale';
      purges.set(key, purgeGeneration);
      return known !== undefined && purgeGeneration > known
        ? 'advanced'
        : 'current';
    },
    current(resource: ObservationResource, purgeGeneration: number) {
      const known = purges.get(observationResourceKey(resource));
      return known === undefined || known === purgeGeneration;
    },
    forget: (resourceKey: string) => purges.delete(resourceKey),
    clear: () => purges.clear(),
  };
}
