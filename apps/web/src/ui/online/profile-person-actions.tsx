'use client';

import {
  challengeFormats,
  challengeModes,
  reportReasonLabels,
  reportReasons,
} from '@daisy/protocol';
import { challengeFormUnavailable } from '../../features/challenges/forms';
import { personActionNotices } from '../../features/presence/person-action';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { useFormAction } from '../form-action/form-action';
import type { PersonActions } from './person-actions';

const labels = {
  ranked: 'Ranked',
  casual: 'Casual',
  freestyle: 'Freestyle',
  policy: 'Policy',
  value: 'Value',
} as const;

const summary =
  'cursor-pointer list-none rounded-sm px-3 py-2 text-sm font-semibold text-ink-muted hover:text-ink';

/**
 * Everything the online list's menu offers, as native forms on the profile,
 * which is where its three dots lead before any script (ADR 0097).
 */
export function ProfilePersonActions({
  username,
  actions,
}: {
  readonly username: string;
  readonly actions: Pick<PersonActions, 'sendChallenge' | 'report' | 'block'>;
}) {
  const [sent, send, sending] = useFormAction(
    actions.sendChallenge,
    {},
    challengeFormUnavailable,
  );
  const [reported, report, reporting] = useFormAction(
    actions.report,
    {},
    () => ({
      notice: personActionNotices.reportFailed,
    }),
  );
  const [blocked, block, blocking] = useFormAction(actions.block, {}, () => ({
    notice: personActionNotices.blockFailed,
  }));
  return (
    <>
      <details>
        <summary className={summary}>Challenge</summary>
        <form action={send} className="flex flex-wrap items-center gap-2 pt-2">
          <input type="hidden" name="username" value={username} />
          <label>
            <span className="sr-only">Mode</span>
            <select name="mode" defaultValue="ranked" className={controlClass}>
              {challengeModes.map((mode) => (
                <option key={mode} value={mode}>
                  {labels[mode]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Format</span>
            <select
              name="format"
              defaultValue="freestyle"
              className={controlClass}
            >
              {challengeFormats.map((format) => (
                <option key={format} value={format}>
                  {labels[format]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={sending}>
            Send challenge
          </Button>
          {sent.notice ? (
            <p role="status" className="text-sm text-ink-muted">
              {sent.notice}
            </p>
          ) : null}
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
          {reported.notice ? (
            <p role="status" className="text-sm text-ink-muted">
              {reported.notice}
            </p>
          ) : null}
        </form>
      </details>
      <form action={block} className="inline-flex items-center gap-2">
        <input type="hidden" name="username" value={username} />
        <Button type="submit" variant="ghost" disabled={blocking}>
          Block
        </Button>
        {blocked.notice ? (
          <p role="status" className="text-sm text-ink-muted">
            {blocked.notice}
          </p>
        ) : null}
      </form>
    </>
  );
}
