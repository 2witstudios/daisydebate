import {
  observationResourceKey,
  observationHeaderSchema,
  observationFrameBytes,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';
import {
  claimScript,
  releaseScript,
  prepareScript,
  publishScript,
  retainScript,
  purgeScript,
  dropScript,
} from './observation-scripts';
import {
  baseDigest,
  createObservationRunner,
  segment,
  ttl,
  type ObservationRunnerInput,
} from './observation-runner';

type Fence = {
  readonly resource: ObservationResource;
  readonly purgeGeneration: number;
  readonly disclosureRevision: number;
};
/** Validates a resource fence; throws on malformed revisions. */
const fence = ({ resource, purgeGeneration, disclosureRevision }: Fence) =>
  observationHeaderSchema.parse({
    resource,
    purgeGeneration,
    disclosureRevision,
    contentRevision: 0,
  });
/** A body revision must be a valid header for, and belong to, its base's resource. */
function baseRevision(input: {
  readonly resource: ObservationResource;
  readonly base: ObservationBase;
  readonly purgeGeneration: number;
  readonly contentRevision: number;
}) {
  observationHeaderSchema.parse({
    resource: input.resource,
    contentRevision: input.contentRevision,
    disclosureRevision: input.base.disclosureRevision,
    purgeGeneration: input.purgeGeneration,
  });
  return (
    observationResourceKey(input.resource) ===
    observationResourceKey(input.base.resource)
  );
}
/** Guarded publication: claims, fences, bodies, heads and purges. */
export function createObservationCacheOperations(
  input: ObservationRunnerInput,
) {
  const { sentinel, keys, script, client } = createObservationRunner(input);
  return {
    async retainObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly base: ObservationBase;
      readonly purgeGeneration: number;
      readonly contentRevision: number;
      readonly ttlMs: number;
    }) {
      if (!baseRevision(input))
        throw new Error('Invalid observation retention');
      return (
        Number(
          await script(
            'retainObservation',
            retainScript,
            keys(input.resource).slice(0, 4),
            [
              segment(input.incarnation),
              segment(input.token),
              String(input.purgeGeneration),
              String(input.base.disclosureRevision),
              baseDigest(input.base),
              String(input.contentRevision),
              ttl(input.ttlMs),
            ],
          ),
        ) === 1
      );
    },
    async establishObservationIncarnation(candidate: string): Promise<string> {
      segment(candidate);
      await client.connect();
      await client.send('SET', [sentinel, candidate, 'NX', 'PX', '3600000']);
      const current = await client.get(sentinel);
      if (!current) throw new Error('Observation cache unavailable');
      return segment(current);
    },
    async claimObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly ttlMs: number;
    }) {
      return (
        Number(
          await script(
            'claimObservation',
            claimScript,
            keys(input.resource).slice(0, 2),
            [
              segment(input.incarnation),
              segment(input.token),
              ttl(input.ttlMs, 2000),
            ],
          ),
        ) === 1
      );
    },
    async releaseObservation(resource: ObservationResource, token: string) {
      return (
        Number(
          await script(
            'releaseObservation',
            releaseScript,
            [keys(resource)[1]!],
            [segment(token)],
          ),
        ) === 1
      );
    },
    async prepareObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly purgeGeneration: number;
      readonly disclosureRevision: number;
    }) {
      fence(input);
      return (
        Number(
          await script(
            'prepareObservation',
            prepareScript,
            keys(input.resource).slice(0, 4),
            [
              segment(input.incarnation),
              segment(input.token),
              String(input.purgeGeneration),
              String(input.disclosureRevision),
              '60000',
            ],
          ),
        ) === 1
      );
    },
    async publishObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly purgeGeneration: number;
      readonly base: ObservationBase;
      readonly contentRevision: number;
      readonly body: string;
      readonly ttlMs: number;
    }) {
      if (
        !baseRevision(input) ||
        Buffer.byteLength(input.body) > observationFrameBytes
      )
        throw new Error('Invalid observation body');
      return Number(
        await script(
          'publishObservation',
          publishScript,
          keys(input.resource),
          [
            segment(input.incarnation),
            segment(input.token),
            String(input.purgeGeneration),
            String(input.base.disclosureRevision),
            baseDigest(input.base),
            String(input.contentRevision),
            input.body,
            ttl(input.ttlMs),
            JSON.stringify({
              resource: input.resource,
              contentRevision: input.contentRevision,
            }),
          ],
        ),
      );
    },
    async dropObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
    }) {
      return (
        Number(
          await script('dropObservation', dropScript, keys(input.resource), [
            segment(input.incarnation),
            segment(input.token),
            JSON.stringify({ resource: input.resource, deleted: true }),
          ]),
        ) === 1
      );
    },
    async purgeObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly purgeGeneration: number;
      readonly disclosureRevision: number;
    }) {
      fence(input);
      return (
        Number(
          await script('purgeObservation', purgeScript, keys(input.resource), [
            segment(input.incarnation),
            String(input.purgeGeneration),
            String(input.disclosureRevision),
            '60000',
            JSON.stringify({
              resource: input.resource,
              purgeGeneration: input.purgeGeneration,
            }),
          ]),
        ) === 1
      );
    },
  };
}
