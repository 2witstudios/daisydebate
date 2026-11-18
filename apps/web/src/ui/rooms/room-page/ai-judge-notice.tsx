import type { RoomView } from '@daisy/protocol';
import { UpgradePanel } from '../../components/upgrade-panel/upgrade-panel';
import { invitePeopleTitleId } from './invite-people-title';

/** Null is not the host's view, which offers no seating at all. */
export const aiJudgeSeatable = (seating: RoomView['aiJudgeSeating']) =>
  seating === 'free' || seating === 'included';

const usedCopy = {
  premium: 'You’ve used your free AI-judged Round. ',
  'with-bot': 'Your free AI-judged Round comes with your free bot Round. ',
  'not-included': '',
} as const;

const inviteJudge = {
  kind: 'dialog',
  label: 'Invite a judge',
  titleId: invitePeopleTitleId,
} as const;

/**
 * States what the host can do about judging (WATCH-16): free on ranked, and
 * for a free casual host past their one AI-judged Round, the upgrade panel in
 * place (PYL-11). A ballot that exists is never behind this; it speaks only
 * to seating, and never with a count.
 */
export function AiJudgeNotice({
  view,
}: {
  readonly view: Pick<
    RoomView,
    'aiJudgeSeating' | 'definition' | 'competitionType'
  >;
}) {
  if (view.definition.seats.judges === 0) return null;
  switch (view.aiJudgeSeating) {
    case 'free':
      return (
        <p role="status" className="py-3 text-sm text-ink-muted">
          {view.competitionType === 'ranked'
            ? 'An AI judge is free on ranked rounds.'
            : 'Your one free bot debate includes an optional AI judge.'}
        </p>
      );
    case 'premium':
    case 'with-bot':
    case 'not-included':
      return (
        <div className="py-3">
          <UpgradePanel
            title="AI judging on casual Rounds is Premium"
            alternative={inviteJudge}
          >
            {usedCopy[view.aiJudgeSeating]}
            Invite a person to judge, or get Premium for unlimited AI judging.
            Ranked Rounds include an AI judge free.
          </UpgradePanel>
        </div>
      );
    case 'fair-use':
      return (
        <p role="status" className="py-3 text-sm text-ink-muted">
          This account has reached today’s fair-use ceiling for AI judging.
          Invite a person to judge, or try again tomorrow.
        </p>
      );
    case 'included':
    case null:
      return null;
  }
}
