import {
  observationBaseSchema,
  observationResourceKey,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';
import { redisKey } from './redis-key';
import {
  interestScript,
  readDemandScript,
  discoverScript,
  readScript,
} from './observation-scripts';
import {
  baseDigest,
  createObservationRunner,
  segment,
  type ObservationRunnerInput,
} from './observation-runner';

/** Expiring node interest, demanded windows, discovery and head/body reads. */
export function createObservationDemandOperations(
  input: ObservationRunnerInput,
) {
  const { sentinel, keys, script, namespace } = createObservationRunner(input);
  return {
    async demandObservation(
      resource: ObservationResource,
      nodeIncarnation: string,
      bases: readonly ObservationBase[] = [],
    ) {
      const key = observationResourceKey(resource);
      if (
        bases.length > 64 ||
        new Set(bases.map(baseDigest)).size !== bases.length ||
        bases.some(
          (base) =>
            observationResourceKey(
              observationBaseSchema.parse(base).resource,
            ) !== key,
        )
      )
        throw new Error('Invalid observation demand');
      return (
        Number(
          await script(
            'demandObservation',
            interestScript,
            [
              redisKey(namespace, 'observation', key, 'interest'),
              redisKey(namespace, 'observation', 'due'),
              redisKey(namespace, 'observation', 'live'),
              redisKey(namespace, 'observation', key, 'demand'),
              keys(resource)[3]!,
            ],
            [
              segment(nodeIncarnation),
              '5000',
              key,
              ...bases.flatMap((base) => [
                baseDigest(base),
                JSON.stringify(base),
              ]),
            ],
          ),
        ) === 1
      );
    },
    async readObservationDemand(
      resource: ObservationResource,
    ): Promise<readonly ObservationBase[]> {
      const key = observationResourceKey(resource);
      const result = await script(
        'readObservationDemand',
        readDemandScript,
        [
          redisKey(namespace, 'observation', key, 'interest'),
          redisKey(namespace, 'observation', 'due'),
          redisKey(namespace, 'observation', 'live'),
          redisKey(namespace, 'observation', key, 'demand'),
          keys(resource)[3]!,
        ],
        [],
      );
      if (!Array.isArray(result) || result.length > 64)
        throw new Error('Invalid observation demand result');
      return result.map((value) => {
        const base = observationBaseSchema.parse(JSON.parse(String(value)));
        if (observationResourceKey(base.resource) !== key)
          throw new Error('Invalid observation demand resource');
        return base;
      });
    },
    async discoverObservations(limit: number): Promise<readonly string[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
        throw new Error('Invalid discovery batch');
      const result = await script(
        'discoverObservations',
        discoverScript,
        [
          redisKey(namespace, 'observation', 'due'),
          redisKey(namespace, 'observation', 'live'),
        ],
        [String(limit)],
      );
      if (
        !Array.isArray(result) ||
        !result.every((value) => typeof value === 'string')
      )
        throw new Error('Invalid discovery result');
      return result;
    },
    async readObservations(
      resource: ObservationResource,
      incarnation: string,
      bases: readonly ObservationBase[],
    ): Promise<
      readonly { readonly contentRevision: number; readonly body: string }[]
    > {
      if (
        bases.length < 1 ||
        bases.length > 64 ||
        bases.some(
          (base) =>
            observationResourceKey(base.resource) !==
            observationResourceKey(resource),
        )
      )
        throw new Error('Invalid observation read');
      const result = await script(
        'readObservations',
        readScript,
        [sentinel, keys(resource)[3]!],
        [segment(incarnation), ...bases.map(baseDigest)],
      );
      if (!Array.isArray(result)) throw new Error('Invalid observation heads');
      return result.flatMap((row) =>
        Array.isArray(row) &&
        row[0] !== null &&
        row[0] !== false &&
        typeof row[1] === 'string'
          ? [{ contentRevision: Number(row[0]), body: row[1] }]
          : [],
      );
    },
  };
}
