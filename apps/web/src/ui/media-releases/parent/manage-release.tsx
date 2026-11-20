'use client';

import {
  initialManageState,
  parentUnacknowledged,
  type ManageState,
} from '../../../features/media-releases/parent-forms';
import { releaseDate } from '../../../features/media-releases/release-words';
import { Button } from '../../components/button/button';
import {
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { Problem } from './problem';
import { ReleaseNotice } from './release-frame';
import { Counsel } from './release-terms';

const checkbox = 'mt-0.5 size-5 shrink-0 accent-accent';
export type ManageReleaseProps = {
  readonly minor: string;
  readonly signedAt: string;
  /** Whether the parent allowed paid advertising. */
  readonly paidAds: boolean;
  readonly withdraw: FormAction<ManageState>;
  readonly allowPaidAds: FormAction<ManageState>;
};

/**
 * The withdraw page, from the link in the signed copy (board "Signed and
 * withdraw"): the whole release, or paid advertising only, with a note and
 * the parent's confirmation; and, while paid ads are off, a way to allow
 * them. Each change uses the link up; a fresh one comes with the next copy.
 */
export function ManageRelease(props: ManageReleaseProps) {
  const who = `@${props.minor}`;
  const [state, withdraw, pending] = useFormAction(
    props.withdraw,
    initialManageState,
    parentUnacknowledged,
  );
  const [allowed, allowPaidAds] = useFormAction(
    props.allowPaidAds,
    initialManageState,
    parentUnacknowledged,
  );
  if (state.kind === 'withdrawn')
    return state.what === 'whole' ? (
      <ReleaseNotice title="Release withdrawn.">
        <p>
          Nobody may newly clip, download or reuse {who}’s Rounds, and Daisy’s
          clips of them come down. We told {who} and their school.
        </p>
      </ReleaseNotice>
    ) : (
      <ReleaseNotice title="Paid advertising withdrawn.">
        <p>
          Daisy stops using {who} in paid ads. The rest of the release stays in
          place. A fresh copy, with a new link, is on its way to you.
        </p>
      </ReleaseNotice>
    );
  if (allowed.kind === 'paid_ads_allowed')
    return (
      <ReleaseNotice title="Paid advertising allowed.">
        <p>A fresh copy, with a new link, is on its way to you.</p>
      </ReleaseNotice>
    );
  const values =
    state.kind === 'idle' ||
    state.kind === 'refused' ||
    state.kind === 'unacknowledged'
      ? state.values
      : {};
  return (
    <div className="flex max-w-release-column flex-col gap-8">
      <section className="flex flex-col gap-6 rounded-xl bg-surface p-6 shadow-1 max-narrow:p-4">
        <div className="flex flex-col gap-3">
          <span className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
            Media release · signed {releaseDate(props.signedAt)}
          </span>
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight wrap-anywhere">
            Withdraw {who}’s media release?
          </h1>
          <p className="text-md text-ink-muted">
            Withdrawing stops anyone newly clipping, downloading or reusing
            {who}’s Rounds. They keep playing ranked, and their Rounds can still
            be watched under each Room’s settings.
          </p>
        </div>
        <form action={withdraw} className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-bold">What to withdraw</legend>
            <label className="flex min-h-release-target cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="what"
                value="whole"
                defaultChecked={values['what'] !== 'paid_ads'}
                className={checkbox}
              />
              <span className="min-w-0">
                The whole release
                <span className="block text-sm text-ink-muted">
                  Daisy’s clips of {who} come down within{' '}
                  <Counsel>takedown period</Counsel>. Copies others already
                  saved or shared may remain.
                </span>
              </span>
            </label>
            <label
              className={`flex min-h-release-target items-start gap-3 ${props.paidAds ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
            >
              <input
                type="radio"
                name="what"
                value="paid_ads"
                disabled={!props.paidAds}
                defaultChecked={values['what'] === 'paid_ads'}
                className={checkbox}
              />
              <span className="min-w-0">
                Paid advertising only
                <span className="block text-sm text-ink-muted">
                  Keeps the rest of the release in place. Daisy stops using{' '}
                  {who} in paid ads.
                  {props.paidAds
                    ? null
                    : ' (You haven’t allowed this, so there is nothing to withdraw.)'}
                </span>
              </span>
            </label>
          </fieldset>
          <div className={fieldClass}>
            <label htmlFor="release-note" className={labelClass}>
              Anything we should know?{' '}
              <span className="font-book text-ink-muted">Optional</span>
            </label>
            <textarea
              id="release-note"
              name="note"
              rows={3}
              maxLength={1000}
              defaultValue={values['note'] ?? ''}
              className="w-full min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-ink"
            />
          </div>
          <label className="flex min-h-release-target cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="attests"
              required
              className={checkbox}
            />
            <span className="min-w-0">
              I am {who}’s parent or legal guardian, and I want to withdraw this
              release.
            </span>
          </label>
          <Problem state={state} />
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              className="min-h-release-target"
              aria-busy={pending}
            >
              Withdraw release
            </Button>
            <a
              href="/"
              className="inline-flex min-h-release-target items-center justify-center rounded-sm border border-border-strong px-5 font-strong text-ink no-underline hover:no-underline"
            >
              Keep it
            </a>
          </div>
          <p className="text-sm text-ink-muted">
            We tell {who} and their school. Want just one Round or clip taken
            down instead? {who} or their school can take any Round down from its
            page on Daisy.
          </p>
        </form>
      </section>
      {props.paidAds ? null : (
        <form
          action={allowPaidAds}
          className="flex flex-col gap-3 rounded-xl border border-border p-5"
        >
          <strong>Change paid-ads choice</strong>
          <p className="text-sm text-ink-muted">
            Paid advertising is not allowed now. You can also allow clips of{' '}
            {who} in Daisy’s paid advertising.{' '}
            <Counsel>ad-use terms and any compensation</Counsel>
          </p>
          <Problem state={allowed} />
          <Button
            type="submit"
            variant="secondary"
            className="min-h-release-target self-start"
          >
            Allow paid advertising
          </Button>
        </form>
      )}
    </div>
  );
}
