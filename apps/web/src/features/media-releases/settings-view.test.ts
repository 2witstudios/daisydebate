import type { MinorReleaseRead } from '@daisy/db';
import type {
  MediaReleaseRecord,
  ReleaseRequest,
} from '@daisy/protocol/media-release';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mediaReleaseSettingsView } from './settings-view';

setupRitewayBun();

const read = (overrides: Partial<MinorReleaseRead> = {}): MinorReleaseRead => ({
  division: 'youth',
  standing: { kind: 'none' },
  clubs: [],
  privateYouthRounds: 14,
  ...overrides,
});
const request: ReleaseRequest = {
  id: 'r'.repeat(24),
  subjectUserId: 'm'.repeat(24),
  recipientEmail: 'elena.rivera@fastmail.com',
  requestedAt: '2026-11-15T10:00:00.000Z',
  expiresAt: '2026-11-29T10:00:00.000Z',
  outcome: null,
  resolvedAt: null,
  sends: 1,
  lastSentAt: '2026-11-15T10:00:00.000Z',
};
const release = (
  attestation: MediaReleaseRecord['attestation'],
): MediaReleaseRecord => ({
  id: 'p'.repeat(24),
  subjectUserId: 'm'.repeat(24),
  scope: 'publish',
  attestation,
  wordingVersion: '2026-11-v1',
  signedAt: '2026-11-16T14:32:00.000Z',
  withdrawnAt: null,
  withdrawnBy: null,
});

test('the minor’s media release section', () => {
  assert({
    given: 'no release and a club',
    should: 'count the private Rounds and offer the club',
    actual: mediaReleaseSettingsView(
      read({
        clubs: [{ id: 'c'.repeat(24), name: 'Lakeside Debate', askedAt: null }],
      }),
    ),
    expected: {
      kind: 'none',
      privateRounds: 'Your 14 Youth Rounds are private.',
      withdrawnNote: null,
      clubs: [{ id: 'c'.repeat(24), name: 'Lakeside Debate', asked: false }],
    },
  });
  assert({
    given: 'one private Round',
    should: 'say it in the singular',
    actual: (
      mediaReleaseSettingsView(read({ privateYouthRounds: 1 })) as {
        privateRounds: string;
      }
    ).privateRounds,
    expected: 'Your 1 Youth Round is private.',
  });
  assert({
    given: 'an open request',
    should: 'show when it was asked, until when, and the masked address',
    actual: mediaReleaseSettingsView(
      read({ standing: { kind: 'waiting', request } }),
    ),
    expected: {
      kind: 'waiting',
      line: 'Asked 15 Nov · link works until 29 Nov',
      recipient: 'e•••••@fastmail.com',
    },
  });
  assert({
    given: 'a parent’s release with no paid ads',
    should: 'name the signer and the day',
    actual: mediaReleaseSettingsView(
      read({
        standing: {
          kind: 'on_file',
          publish: release({
            kind: 'parent',
            name: 'Elena Rivera',
            relation: 'parent',
            email: 'e@x.co',
          }),
          paidAds: false,
        },
      }),
    ),
    expected: {
      kind: 'parent',
      line: 'Signed by Elena Rivera, parent · 16 Nov 2026',
      paidAds: false,
      wordingVersion: '2026-11-v1',
    },
  });
  assert({
    given: 'a club’s confirmation',
    should: 'name the club and who confirmed',
    actual: mediaReleaseSettingsView(
      read({
        standing: {
          kind: 'on_file',
          publish: release({
            kind: 'club',
            organizationId: 'o'.repeat(24),
            organizationName: 'Lakeside Debate',
            attestedByUserId: 'd'.repeat(24),
            name: 'Dana Mensah',
            role: 'coach',
          }),
          paidAds: false,
        },
      }),
    ),
    expected: {
      kind: 'club',
      line: 'Lakeside Debate · confirmed by Dana Mensah, coach · 16 Nov 2026',
      paidAds: false,
    },
  });
});
