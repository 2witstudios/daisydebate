import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createObservationChannelBody,
  observationProjectionRowBytes,
} from './observation-channel';
import { observationServerMessageSchema } from '../observation-messages';
setupRitewayBun();
const channelId = 'b'.repeat(24);
const base = {
  schema: 1 as const,
  resource: { kind: 'channel' as const, id: channelId },
  partition: { kind: 'shared' as const, policyKey: 'channel-messages-v1' },
  disclosureRevision: 3,
  window: { after: null, limit: 2 },
};
const header = {
  resource: base.resource,
  contentRevision: 9,
  disclosureRevision: 3,
  purgeGeneration: 0,
};
const row = (sequence: number, extra: Record<string, unknown> = {}) => ({
  id: String.fromCharCode(96 + sequence).repeat(24),
  channelId,
  authorActorId: 'c'.repeat(24),
  sequence,
  changeVersion: sequence,
  text: `m${sequence}`,
  createdAt: '2026-10-12T00:00:00.000Z',
  editedAt: null,
  removedAt: null,
  reactions: [],
  ...extra,
});
const channel = createObservationChannelBody({
  messageUnits: 100,
  pageItems: 50,
});
test('channel projection maps restricted rows into the shared body', () => {
  const projection = {
    base,
    header,
    rows: [
      row(5, { reactions: [{ reaction: 'up', count: 2 }] }),
      row(4, { removedAt: '2026-10-12T00:00:01.000Z', text: null }),
    ],
    continuation: 4,
  };
  assert({
    given: 'descending restricted rows and an included continuation',
    should: 'disclose permitted fields and erase removed content',
    actual: channel.fromProjection(projection),
    expected: {
      status: 'ready',
      body: {
        messages: [
          {
            id: row(5).id,
            channelId,
            authorActorId: 'c'.repeat(24),
            sequence: 5,
            changeVersion: 5,
            text: 'm5',
            createdAt: '2026-10-12T00:00:00.000Z',
            editedAt: null,
            reactions: [{ reaction: 'up', count: 2 }],
          },
          {
            id: row(4).id,
            channelId,
            sequence: 4,
            changeVersion: 4,
            unavailable: true,
          },
        ],
        continuation: 4,
      },
    },
  });
  assert({
    given: 'a final page without continuation',
    should: 'report no further history',
    actual: channel.fromProjection({
      ...projection,
      rows: [row(1)],
      continuation: null,
    }),
    expected: {
      status: 'ready',
      body: {
        messages: [
          {
            id: row(1).id,
            channelId,
            authorActorId: 'c'.repeat(24),
            sequence: 1,
            changeVersion: 1,
            text: 'm1',
            createdAt: '2026-10-12T00:00:00.000Z',
            editedAt: null,
            reactions: [],
          },
        ],
        continuation: null,
      },
    },
  });
});
test('channel projection refuses incoherent producer output', () => {
  const ok = { base, header, rows: [row(5), row(4)], continuation: 4 };
  const cases = [
    { ...ok, continuation: 5 },
    { ...ok, continuation: 'd'.repeat(24) },
    { ...ok, rows: [], continuation: 4 },
    { ...ok, rows: [row(4), row(5)] },
    { ...ok, rows: [row(5), row(5)], continuation: 5 },
    { ...ok, rows: [row(5), row(4), row(3)], continuation: 3 },
    { ...ok, rows: [row(5, { channelId: 'd'.repeat(24) }), row(4)] },
    { ...ok, rows: [row(5, { commandId: 'private' }), row(4)] },
    { ...ok, rows: [row(5, { text: 'x'.repeat(101) }), row(4)] },
    {
      ...ok,
      rows: [
        row(5, {
          reactions: [
            { reaction: 'up', count: 1 },
            { reaction: 'up', count: 1 },
          ],
        }),
        row(4),
      ],
    },
    {
      ...ok,
      rows: [
        row(5, {
          reactions: [
            { reaction: 'b', count: 1 },
            { reaction: 'a', count: 1 },
          ],
        }),
        row(4),
      ],
    },
    {
      ...ok,
      rows: [
        row(5, {
          reactions: [
            { reaction: 'a', count: 1 },
            { reaction: 'b', count: 1 },
            { reaction: 'a', count: 1 },
          ],
        }),
        row(4),
      ],
    },
    {
      ...ok,
      rows: [row(5, { reactions: [{ reaction: 'up', count: 0 }] }), row(4)],
    },
    { ...ok, header: { ...header, disclosureRevision: 4 } },
    {
      ...ok,
      header: {
        ...header,
        resource: { kind: 'channel' as const, id: 'd'.repeat(24) },
      },
    },
    {
      ...ok,
      base: { ...base, window: { after: 5, limit: 2 } },
    },
    {
      ...ok,
      base: {
        ...base,
        resource: { kind: 'room' as const, id: channelId },
        window: { after: null, limit: 2 },
      },
      header: {
        ...header,
        resource: { kind: 'room' as const, id: channelId },
      },
    },
  ];
  assert({
    given:
      'wrong continuation, ordering, window, channel, private field, oversized text, duplicate, unsorted or empty reactions, header or resource kind',
    should: 'report the projection unavailable rather than disclose it',
    actual: cases.map((input) => channel.fromProjection(input).status),
    expected: cases.map(() => 'unavailable'),
  });
});
test('message bounds must fit one worst-case item in a frame', () => {
  const maxUnits = Math.floor(observationProjectionRowBytes / 6) - 64;
  const fits = createObservationChannelBody({
    messageUnits: maxUnits,
    pageItems: 50,
  });
  const worst = row(1, {
    text: '\u0001'.repeat(maxUnits),
    replyToMessageId: 'e'.repeat(24),
    editedAt: '2026-10-12T00:00:00.000Z',
  });
  const mapped = fits.fromProjection({
    base: { ...base, window: { after: null, limit: 50 } },
    header,
    rows: [worst],
    continuation: 1,
  });
  const frame = {
    v: 1,
    type: 'observation.snapshot',
    id: 'r'.repeat(128),
    generation: Number.MAX_SAFE_INTEGER,
    base: {
      ...base,
      disclosureRevision: Number.MAX_SAFE_INTEGER,
      window: { after: Number.MAX_SAFE_INTEGER, limit: 50 },
    },
    contentRevision: Number.MAX_SAFE_INTEGER,
    purgeGeneration: Number.MAX_SAFE_INTEGER,
    body: mapped.status === 'ready' ? mapped.body : null,
  };
  assert({
    given: 'the largest accepted message units with worst-case JSON escapes',
    should: 'map the item and fit the snapshot frame bound',
    actual: [
      new TextEncoder().encode(JSON.stringify(worst)).byteLength <=
        observationProjectionRowBytes,
      mapped.status,
      observationServerMessageSchema.safeParse(frame).success,
    ],
    expected: [true, 'ready', true],
  });
  assert({
    given: 'message units whose worst-case item exceeds the row budget',
    should: 'refuse the bounds instead of truncating a valid message later',
    actual: (() => {
      try {
        createObservationChannelBody({
          messageUnits: Math.floor(observationProjectionRowBytes / 6),
          pageItems: 50,
        });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    })(),
    expected: 'Message units exceed the observation row budget',
  });
});
