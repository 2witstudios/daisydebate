'use client';

import { mediaReleaseWording } from '@daisy/protocol/media-release';
import type { SignState } from '../../../features/media-releases/parent-forms';
import {
  guardianRelationWords,
  releaseDate,
  releaseMoment,
} from '../../../features/media-releases/release-words';
import { Button } from '../../components/button/button';

/** A form's bound action, as `useFormAction` hands it to the form. */
type Dispatch = (payload: FormData) => void;

const panel = 'flex flex-col gap-3 rounded-xl bg-surface p-5 shadow-1';

/** The minor's initials, from the username: what the request card shows. */
const initials = (minor: string) =>
  minor
    .split(/[._-]/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || minor[0]!.toUpperCase();

export function Avatar({ minor }: { readonly minor: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-avatar-lg shrink-0 items-center justify-center rounded-full bg-surface-overlay text-sm font-bold"
    >
      {initials(minor)}
    </span>
  );
}

/** The request's facts beside the form ("The request"); on a phone, a card on top. */
export function RequestFacts(
  props: {
    readonly minor: string;
    readonly requestedAt: string;
    readonly expiresAt: string;
    readonly sentTo: string;
  } & {
    readonly notMe: Dispatch;
  },
) {
  return (
    <aside
      aria-label="About this request"
      className="flex w-release-aside shrink-0 flex-col gap-4 max-compact:hidden"
    >
      <div className={panel}>
        <span className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
          The request
        </span>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar minor={props.minor} />
          <span className="min-w-0">
            <strong className="block font-semibold">@{props.minor}</strong>
            <span className="block text-sm text-ink-muted">
              Youth – Freestyle
            </span>
          </span>
        </span>
        <dl className="flex flex-col">
          {[
            ['Asked', releaseDate(props.requestedAt)],
            ['Link works until', releaseDate(props.expiresAt)],
            ['Sent to', props.sentTo],
          ].map(([term, value], index) => (
            <div
              key={term}
              className={`flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 ${index === 0 ? '' : 'border-t border-border'}`}
            >
              <dt className="text-ink-muted">{term}</dt>
              <dd className="min-w-0 text-right font-semibold break-all">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <NotMe {...props} />
    </aside>
  );
}

/** "Not Sam's parent? Tell us and we'll close this request." */
export function NotMe({ notMe }: { readonly notMe: Dispatch }) {
  return (
    <form
      action={notMe}
      className="flex flex-col gap-2 rounded-xl border border-border p-5"
    >
      <strong>Questions?</strong>
      <span className="text-sm text-ink-muted">
        Write to releases@daisydebate.com. Not their parent? Tell us and we’ll
        close this request.
      </span>
      <Button
        type="submit"
        variant="ghost"
        className="min-h-release-target self-start"
      >
        This isn’t me
      </Button>
    </form>
  );
}

export function Signed({
  minor,
  sentTo,
  state,
}: {
  readonly minor: string;
  readonly sentTo: string;
  readonly state: Extract<SignState, { kind: 'signed' }>;
}) {
  const rows: readonly (readonly [string, string])[] = [
    ['Signed by', `${state.name}, ${guardianRelationWords[state.relation]}`],
    ['For', `@${minor}`],
    ['When', releaseMoment(state.signedAt)],
    ['Publish Rounds and clips', 'Allowed'],
    ['Paid advertising', state.paidAds ? 'Allowed' : 'Not allowed'],
    ['Release version', mediaReleaseWording.label],
  ];
  return (
    <section
      aria-labelledby="release-signed"
      className="flex max-w-release-column flex-col gap-6"
    >
      <div className="flex flex-col gap-3">
        <span className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
          Media release
        </span>
        <h1
          id="release-signed"
          className="font-display text-3xl leading-tight font-bold tracking-tight"
        >
          Release signed. Thank you.
        </h1>
        <p className="text-md text-ink-muted">
          We told @{minor}. A copy and a link to withdraw are on their way to{' '}
          {sentTo}.
        </p>
      </div>
      <dl className="overflow-hidden rounded-lg border border-border bg-surface-raised">
        {rows.map(([term, value], index) => (
          <div
            key={term}
            className={`flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-3 ${index === 0 ? '' : 'border-t border-border'}`}
          >
            <dt className="text-ink-muted">{term}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">What happens next</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-muted">
          <li>
            @{minor}’s Youth Rounds can be published once every Youth debater in
            a Round has a release.
          </li>
          <li>
            You can withdraw, or change the paid-ads choice, from the link in
            your copy.
          </li>
        </ul>
      </section>
    </section>
  );
}
