import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  mediaHearingSeats,
  mediaPublicationParticipants,
  mediaWithdrawnSeats,
} from './media-publication-authority';

setupRitewayBun();

type Seats = Parameters<typeof mediaPublicationParticipants>[0];
type Round = Parameters<typeof mediaPublicationParticipants>[2];
const seat = (id: string, kind: 'bot' | 'human', eligible = true) => ({
  id,
  kind,
  seat: { kind: 'side' as const, side: 'negative', slot: 0 },
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
const round = {
  segments: [{ id: 'old' }, { id: 'now' }],
  checkpoint: {},
} as unknown as Round;
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

test('a seat that left the Round is withdrawn in place, never revoked (TAB-6.8)', () => {
  const left = {
    ...round,
    checkpoint: { absent_participant_ids: ['person', 'floor'] },
  } as unknown as Round;
  assert({
    given: 'a human and a floor-holding bot recorded absent by leave',
    should:
      'withdraw both beside the access-revoked seats, keep every seat eligible so the room is never rotated, and stop the bot hearing',
    actual: {
      withdrawn: mediaWithdrawnSeats(['revoked', 'person'], left),
      eligible: mediaPublicationParticipants(seats, leases, left, now)
        .filter((entry) => entry.eligible)
        .map((entry) => entry.id),
      hear: mediaHearingSeats(seats, leases, left, now),
    },
    expected: {
      withdrawn: ['revoked', 'person', 'floor'],
      eligible: ['floor', 'person'],
      hear: ['listening'],
    },
  });
});
