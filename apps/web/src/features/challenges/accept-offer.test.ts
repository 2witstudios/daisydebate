import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomTemplate } from '../rooms/read-catalog';
import { acceptOffer, type AcceptOfferPorts } from './accept-offer';
import { moved, refusedWith } from '../forms/form-state';
import { challengeRefusal, challengeRefused } from './forms';

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
    const notice = await beforeMoveOn('r'.repeat(24), true);
    return notice ? refusedWith({}, notice) : moved('/rooms/room');
  },
  nameRoom: async () => ({ ok: true, status: 200 }),
  closeRoom: async () => {},
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
          await beforeMoveOn('r'.repeat(24), true);
          return moved('/rooms/room');
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
        moved('/rooms/room'),
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
        return moved('/rooms/room');
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
          challengeRefused(challengeRefusal('accept', 404)),
          challengeRefused(challengeRefusal('accept-placed', 409)),
        ],
        0,
      ],
    });
  });
  test('a room just opened that cannot be named closes', async () => {
    const closed: string[] = [];
    const answer = await acceptOffer(
      input,
      ports({
        nameRoom: async () => ({ ok: false, status: 404 }),
        closeRoom: async (roomId) => {
          closed.push(roomId);
        },
      }),
    );
    assert({
      given: 'the offer ended while the room opened',
      should: 'close the listed room naming them both, and say the offer ended',
      actual: [answer, closed],
      expected: [
        challengeRefused(challengeRefusal('accept-lost', 404)),
        ['r'.repeat(24)],
      ],
    });
  });
  test('a room the member already held stays theirs', async () => {
    const closed: string[] = [];
    await acceptOffer(
      input,
      ports({
        nameRoom: async () => ({ ok: false, status: 404 }),
        closeRoom: async (roomId) => {
          closed.push(roomId);
        },
        openRoom: async (_form, beforeMoveOn) => {
          const notice = await beforeMoveOn('h'.repeat(24), false);
          return refusedWith({}, notice ?? 'not opened');
        },
      }),
    );
    assert({
      given: 'a create answered with the room they already hold',
      should: 'leave that room alone',
      actual: closed,
      expected: [],
    });
  });
});
