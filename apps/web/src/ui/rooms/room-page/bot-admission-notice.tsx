import type { RoomView } from '@daisy/protocol';
import { UpgradePanel } from '../../components/upgrade-panel/upgrade-panel';

const refusals = {
  'not-eligible': 'because access is unavailable.',
  'renewal-grace': 'until your subscription payment is restored.',
  'abuse-ceiling':
    'today: this account has reached the fair-use ceiling. Try again tomorrow.',
  capacity: 'right now: bots are busy, try again shortly.',
} as const;

/**
 * Whether a bot debater can start, never how many are left (PYL-10). A free
 * account that has used its one bot Round sees the upgrade panel in place.
 */
export function BotAdmissionNotice({
  admission,
}: {
  readonly admission: RoomView['botAdmission'];
}) {
  if (!admission) return null;
  if (admission.kind === 'unavailable')
    return (
      <p role="status" className="text-sm text-ink-muted">
        A round with a bot debater can’t start right now: bots are unavailable.
      </p>
    );
  const { refusal } = admission;
  if (refusal === null) return null;
  if (refusal === 'free-limit-reached')
    return (
      <UpgradePanel
        title="Your free bot Round is used"
        alternative={{ kind: 'link', label: 'Find a person', href: '/play' }}
      >
        Premium gives you unlimited bot Rounds. Or debate a person: that’s
        always free.
      </UpgradePanel>
    );
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-ink-muted">
      <p>A round with a bot debater can’t start {refusals[refusal]}</p>
      {refusal === 'renewal-grace' ? (
        <a href="/settings/billing" className="underline">
          Manage billing
        </a>
      ) : null}
    </div>
  );
}
