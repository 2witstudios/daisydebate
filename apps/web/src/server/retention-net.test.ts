import { assert, setupRitewayBun, test } from 'riteway/bun';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';
import { retentionTargets } from './retention-targets';

setupRitewayBun();

type Targets = Parameters<typeof retentionTargets>[0];

/**
 * The retention net (RECON-4.6): every store the one retention sweep
 * prunes, by name. It must read the same before and after each feature
 * contributes its own targets through the one feature list.
 */
test('the retention sweep prunes the same stores, by name', () => {
  // Every purge answers nothing; only the names matter here.
  const database = new Proxy(
    {},
    { get: () => async () => 0 },
  ) as Targets['database'];
  const names = retentionTargets({
    database,
    redis: { sweepOnlinePresence: async () => 0 },
    provisionalLinks: provisionalLinkPurposes,
  }).map(({ name }) => name);
  assert({
    given: 'the production retention targets',
    should: 'name each store once, the same set as before RECON-4.6',
    actual: { names: [...names].sort(), unique: new Set(names).size },
    expected: { names: EXPECTED, unique: EXPECTED.length },
  });
});

const EXPECTED: readonly string[] = [
  'retention.audience_reactions',
  'retention.availability_samples',
  'retention.challenges',
  'retention.child_account_requests',
  'retention.club_seat_invitations',
  'retention.email_delivery',
  'retention.email_delivery_event',
  'retention.flag_evidence',
  'retention.flag_overrides',
  'retention.judging_stages',
  'retention.league_requests',
  'retention.mail_intents',
  'retention.media_release_requests',
  'retention.media_releases',
  'retention.messaging_unread_emails',
  'retention.moderation',
  'retention.notification_digests',
  'retention.notifications',
  'retention.outbox',
  'retention.pending_ballots',
  'retention.presence_online',
  'retention.provisional_user',
  'retention.reports',
  'retention.room_chat_messages',
  'retention.room_chat_read_states',
  'retention.room_chat_receipts',
  'retention.room_commands',
  'retention.room_invitations',
  'retention.round_analyses',
  'retention.round_check_in_attempts',
  'retention.round_commands',
  'retention.round_floor_messages',
  'retention.round_floor_read_states',
  'retention.round_floor_receipts',
  'retention.service_instances',
  'retention.session',
  'retention.social_declines',
  'retention.social_requests',
  'retention.spectator_chat',
  'retention.utterances',
  'retention.verification',
  'retention.watch_history',
];
