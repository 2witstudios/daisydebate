import { Announcement } from '../../components/announcement/announcement';
import type { RoomView } from '@daisy/protocol/room-contract';

const refusals = {
  'not-eligible': 'because access is unavailable.',
  'renewal-grace': 'until your subscription payment is restored.',
  'abuse-ceiling':
    'today: this account has reached the fair-use ceiling. Try again tomorrow.',
  capacity: 'right now: bots are busy, try again shortly.',
} as const;

/**
 * Whether a bot debater can start, never how many are left (PYL-10). Bot
 * debates are no part of any offer: unreleased they are coming soon, and a
 * used free bot Round points to a person, never to Premium.
 */
export function BotAdmissionNotice({
  admission,
}: {
  readonly admission: RoomView['botAdmission'];
}) {
  if (!admission) return null;
  if (admission.kind === 'unavailable')
    return (
      <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
        A round with a bot debater can’t start right now: bots are unavailable.
      </Announcement>
    );
  if (admission.kind === 'coming-soon')
    return (
      <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
        Bot debates are coming soon.
      </Announcement>
    );
  const { refusal } = admission;
  if (refusal === null) return null;
  if (refusal === 'free-limit-reached')
    return (
      <Announcement
        as="div"
        kind="progress"
        className="flex flex-col gap-1 text-sm text-ink-muted"
      >
        <p>Your free bot Round is used. Debating a person is always free.</p>
        <a href="/play" className="underline">
          Find a person
        </a>
      </Announcement>
    );
  return (
    <Announcement
      as="div"
      kind="progress"
      className="flex flex-col gap-1 text-sm text-ink-muted"
    >
      <p>A round with a bot debater can’t start {refusals[refusal]}</p>
      {refusal === 'renewal-grace' ? (
        <a href="/settings/billing" className="underline">
          Manage billing
        </a>
      ) : null}
    </Announcement>
  );
}
