'use client';

import { Announcement } from '../components/announcement/announcement';
import { competitionTypes, type CompetitionType } from '@daisy/protocol/round';
import { reportReasonLabels, reportReasons } from '@daisy/protocol/reports';
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
  modes,
  actions,
}: {
  readonly username: string;
  readonly modes: readonly CompetitionType[];
  readonly actions: Pick<PersonActions, 'sendChallenge' | 'report' | 'block'>;
}) {
  const ranked = modes.includes('ranked');
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
      {modes.length > 0 ? (
        <details>
          <summary className={summary}>Challenge</summary>
          <form
            action={send}
            className="flex flex-wrap items-center gap-2 pt-2"
          >
            <input type="hidden" name="username" value={username} />
            <label>
              <span className="sr-only">Mode</span>
              <select
                name="mode"
                defaultValue={ranked ? 'ranked' : 'casual'}
                className={controlClass}
              >
                {competitionTypes.map((mode) => (
                  <option
                    key={mode}
                    value={mode}
                    disabled={!modes.includes(mode)}
                  >
                    {modeLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="format" value="freestyle" />
            <Button type="submit" disabled={sending}>
              Send challenge
            </Button>
          </form>
        </details>
      ) : null}
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
        <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
          {challengeNotice ?? reportNotice}
        </Announcement>
      ) : null}
      <form action={block} className="inline-flex items-center gap-2">
        <input type="hidden" name="username" value={username} />
        <Button type="submit" variant="ghost" disabled={blocking}>
          Block
        </Button>
        {blockNotice ? (
          <Announcement
            as="p"
            kind="progress"
            className="text-sm text-ink-muted"
          >
            {blockNotice}
          </Announcement>
        ) : null}
      </form>
    </>
  );
}
