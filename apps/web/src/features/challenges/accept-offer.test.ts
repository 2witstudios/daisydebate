import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomTemplate } from '../rooms/read-catalog';
import { acceptOffer, type AcceptOfferPorts } from './accept-offer';
import { challengeRefusal } from './forms';

setupRitewayBun();

const id = 'c'.repeat(24);
const template = {
  formatId: 'freestyle',
  formatVersion: 1,
  preset: {
    version: 3,
    config: { resolutionDraw: { enabled: true } },
  },
} as unknown as RoomTemplate;
const offer = {
  id,
  actorId: 'a'.repeat(24),
  username: 'ada',
  mode: 'casual',
  format: 'freestyle',
  createdAt: '2026-11-02T00:00:00.000Z',
  expiresAt: '2026-11-02T00:02:00.000Z',
} as const;
const input = { challengeId: id, username: 'bea', actorId: 'b'.repeat(24) };
const ports = (
  overrides: Partial<AcceptOfferPorts> = {},
): AcceptOfferPorts => ({
  nextId: () => 'd'.repeat(24),
  readOffers: async () => [offer],
  inARoom: async () => false,
  readCatalog: async () => ({
    kind: 'found',
    choices: [template],
    resolutions: [],
  }),
  openRoom: async (_form, beforeMoveOn) => {
    const notice = await beforeMoveOn('r'.repeat(24));
    return notice ? { error: notice } : { next: '/rooms/room' };
  },
  nameRoom: async () => ({ ok: true, status: 200 }),
  ...overrides,
});

describe('acceptOffer', () => {
  test('opens the room, names it and moves on', async () => {
    const named: string[] = [];
    const forms: FormData[] = [];
    const answer = await acceptOffer(
      input,
      ports({
        openRoom: async (form, beforeMoveOn) => {
          forms.push(form);
          await beforeMoveOn('r'.repeat(24));
          return { next: '/rooms/room' };
        },
        nameRoom: async (roomId) => {
          named.push(roomId);
          return { ok: true, status: 200 };
        },
      }),
    );
    assert({
      given: 'a standing offer',
      should: 'hold both seats, name the room and go there',
      actual: [answer, named, forms[0]?.getAll('holdSeatFor')],
      expected: [
        { next: '/rooms/room' },
        ['r'.repeat(24)],
        [input.actorId, offer.actorId],
      ],
    });
  });
  test('an offer gone, or a member already placed, opens nothing', async () => {
    let opened = 0;
    const counting = {
      openRoom: async () => {
        opened += 1;
        return { next: '/rooms/room' };
      },
    };
    const answers = [
      await acceptOffer(
        input,
        ports({ ...counting, readOffers: async () => [] }),
      ),
      await acceptOffer(
        input,
        ports({ ...counting, inARoom: async () => true }),
      ),
    ];
    assert({
      given: 'no such offer, then a member in a room',
      should: 'refuse each and open no room',
      actual: [answers, opened],
      expected: [
        [
          { notice: challengeRefusal('accept', 404) },
          { notice: challengeRefusal('accept-placed', 409) },
        ],
        0,
      ],
    });
  });
  test('a room that cannot be named still holds them', async () => {
    assert({
      given: 'the offer ended while the room opened',
      should: 'say so, and that the room is still open',
      actual: await acceptOffer(
        input,
        ports({ nameRoom: async () => ({ ok: false, status: 404 }) }),
      ),
      expected: { notice: challengeRefusal('accept-lost', 404) },
    });
  });
});
