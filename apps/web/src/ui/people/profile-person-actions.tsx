'use client';

import {
  competitionTypes,
  reportReasonLabels,
  reportReasons,
  type RatingDivision,
} from '@daisy/protocol';
import {
  offersRanked,
  rankedChallengeLine,
  rankedChallengeOf,
} from '../../features/challenges/challenge-ladder';
import {
  challengeFields,
  challengeFormUnavailable,
  initialChallengeForm,
} from '../../features/challenges/forms';
import {
  initialPersonBlock,
  personBlockNotice,
  personBlockUnavailable,
} from '../../features/contacts/block-form';
import {
  initialReportForm,
  reportFields,
  reportFormUnavailable,
} from '../../features/reports/form';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { useFormAction } from '../form-action/form-action';
import type { PersonActions } from './person-actions';

const modeLabels = {
  ranked: 'Ranked',
  casual: 'Casual',
} as const;

const summary =
  'cursor-pointer list-none rounded-sm px-3 py-2 text-sm font-semibold text-ink-muted hover:text-ink';

/**
 * Everything the people list's menu offers, as native forms on the profile,
 * which is where its three dots lead before any script (ADR 0103).
 */
export function ProfilePersonActions({
  username,
  memberDivision,
  theirDivision,
  actions,
}: {
  readonly username: string;
  /** The viewer's ladder division (ADR 0147); a hint, the send decides again. */
  readonly memberDivision: RatingDivision | null;
  /** The profile member's division, when their ratings name it. */
  readonly theirDivision: RatingDivision | null;
  readonly actions: Pick<PersonActions, 'sendChallenge' | 'report' | 'block'>;
}) {
  const ranked = rankedChallengeOf(memberDivision, theirDivision);
  const [sent, send, sending] = useFormAction(
    actions.sendChallenge,
    initialChallengeForm,
    challengeFormUnavailable,
  );
  const challengeNotice = challengeFields(sent).notice;
  const [reported, report, reporting] = useFormAction(
    actions.report,
    initialReportForm,
    reportFormUnavailable,
  );
  const reportNotice = reportFields(reported).notice;
  const [blocked, block, blocking] = useFormAction(
    actions.block,
    initialPersonBlock,
    personBlockUnavailable,
  );
  const blockNotice = personBlockNotice(blocked);
  return (
    <>
      <details>
        <summary className={summary}>Challenge</summary>
        <form action={send} className="flex flex-wrap items-center gap-2 pt-2">
          <input type="hidden" name="username" value={username} />
          <label>
            <span className="sr-only">Mode</span>
            <select
              name="mode"
              defaultValue={offersRanked(ranked) ? 'ranked' : 'casual'}
              className={controlClass}
            >
              {competitionTypes.map((mode) => (
                <option
                  key={mode}
                  value={mode}
                  disabled={mode === 'ranked' && !offersRanked(ranked)}
                >
                  {modeLabels[mode]}
                </option>
              ))}
            </select>
          </label>
          <p className="w-full text-sm text-ink-muted">
            {rankedChallengeLine(ranked, username)}
          </p>
          <input type="hidden" name="format" value="freestyle" />
          <Button type="submit" disabled={sending}>
            Send challenge
          </Button>
        </form>
      </details>
      <details>
        <summary className={summary}>Report</summary>
        <form
          action={report}
          className="flex flex-wrap items-center gap-2 pt-2"
        >
          <input type="hidden" name="username" value={username} />
          <input type="hidden" name="surface" value="profile" />
          <label>
            <span className="sr-only">Reason</span>
            <select name="reason" required className={controlClass}>
              {reportReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reportReasonLabels[reason]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary" disabled={reporting}>
            Send report
          </Button>
        </form>
      </details>
      {(challengeNotice ?? reportNotice) ? (
        <p role="status" className="text-sm text-ink-muted">
          {challengeNotice ?? reportNotice}
        </p>
      ) : null}
      <form action={block} className="inline-flex items-center gap-2">
        <input type="hidden" name="username" value={username} />
        <Button type="submit" variant="ghost" disabled={blocking}>
          Block
        </Button>
        {blockNotice ? (
          <p role="status" className="text-sm text-ink-muted">
            {blockNotice}
          </p>
        ) : null}
      </form>
    </>
  );
}
