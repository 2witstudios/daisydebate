import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  mediaHearingSeats,
  mediaPublicationParticipants,
} from './media-publication-authority';

setupRitewayBun();

type Seats = Parameters<typeof mediaPublicationParticipants>[0];
type Round = Parameters<typeof mediaPublicationParticipants>[2];
const seat = (id: string, kind: 'bot' | 'human', eligible = true) => ({
  id,
  kind,
  role: 'negative',
  eligible,
});
const seats = [
  seat('floor', 'bot'),
  seat('listening', 'bot'),
  seat('expired', 'bot'),
  seat('stale', 'bot'),
  seat('ineligible', 'bot', false),
  seat('person', 'human'),
] as unknown as Seats;
const round = { segments: [{ id: 'old' }, { id: 'now' }] } as unknown as Round;
const now = '2026-10-27T12:00:00.000Z';
const live = new Date('2026-10-27T12:00:30.000Z');
const lease = (
  participantId: string,
  floor: boolean,
  segmentId = 'now',
  expiresAt = live,
) => ({ participantId, segmentId, expiresAt, floor });
const leases = [
  lease('floor', true),
  lease('listening', false),
  lease('expired', true, 'now', new Date(now)),
  lease('stale', true, 'old'),
  lease('ineligible', true),
];

test('a bot seat publishes only on the floor, and hears with or without it (ISSUE-764)', () => {
  assert({
    given:
      'bot seats on the floor, off it, with an expired claim, a claim on an old segment and an ineligible seat, beside a human',
    should:
      'grant publication to the floor seat alone, hearing to both live current claims, and leave the human untouched',
    actual: {
      publish: mediaPublicationParticipants(seats, leases, round, now)
        .filter((entry) => entry.eligible)
        .map((entry) => entry.id),
      hear: mediaHearingSeats(seats, leases, round, now),
    },
    expected: {
      publish: ['floor', 'person'],
      hear: ['floor', 'listening'],
    },
  });
});
