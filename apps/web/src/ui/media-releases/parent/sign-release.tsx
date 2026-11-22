'use client';

import { StatusRegion } from '../../components/status-region/status-region';
import {
  initialSignState,
  parentUnacknowledged,
  type SignState,
} from '../../../features/media-releases/parent-forms';
import { releaseDay } from '../../../features/media-releases/release-words';
import { Button } from '../../components/button/button';
import { errorClass } from '../../components/form-field/form-field-class';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { problemOf } from './problem';
import { ReleaseNotice } from './release-frame';
import { Avatar, NotMe, RequestFacts, Signed } from './sign-release-parts';
import { ReleaseTerms, ReleaseUnchanged } from './release-terms';
import {
  ReleasePaidAdsFields,
  ReleaseSignatureFields,
} from './release-signature-fields';

export type SignReleaseProps = {
  readonly minor: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  /** The address the request went to: the parent's own, who holds the link. */
  readonly sentTo: string;
  readonly sign: FormAction<SignState>;
  readonly decline: FormAction<SignState>;
  readonly notMe: FormAction<SignState>;
};

/**
 * The parent signs (board "Parent signs", desktop and phone): the release,
 * what does not change, the separate paid-ads choice, and the signature.
 * Declining, or saying the request is not theirs, closes it.
 */
export function SignRelease(props: SignReleaseProps) {
  const [state, sign, pending] = useFormAction(
    props.sign,
    initialSignState,
    parentUnacknowledged,
  );
  const [answered, decline] = useFormAction(
    props.decline,
    initialSignState,
    parentUnacknowledged,
  );
  const [notMeState, notMe] = useFormAction(
    props.notMe,
    initialSignState,
    parentUnacknowledged,
  );
  if (state.kind === 'signed')
    return <Signed minor={props.minor} sentTo={props.sentTo} state={state} />;
  for (const other of [answered, notMeState])
    if (other.kind === 'answered')
      return (
        <ReleaseNotice
          title={
            other.outcome === 'declined'
              ? 'You declined the release.'
              : 'Thanks. We closed this request.'
          }
        >
          <p>
            {other.outcome === 'declined'
              ? `We told @${props.minor}. Nobody may clip, download or reuse their Rounds, and nothing else changes.`
              : 'Nothing was signed, and we won’t use this link again.'}
          </p>
        </ReleaseNotice>
      );
  const values =
    state.kind === 'idle' ||
    state.kind === 'refused' ||
    state.kind === 'unacknowledged'
      ? state.values
      : {};
  const refusal = problemOf([state, answered, notMeState]);
  return (
    <div className="flex flex-wrap items-start gap-10">
      <div className="flex w-full max-w-release-column min-w-0 flex-1 flex-col gap-8">
        <div className="hidden items-center gap-3 rounded-xl bg-surface p-4 shadow-1 max-compact:flex">
          <Avatar minor={props.minor} />
          <span className="min-w-0">
            <strong className="block font-semibold">@{props.minor}</strong>
            <span className="block text-sm text-ink-muted">
              Asked {releaseDay(props.requestedAt)} · link works until{' '}
              {releaseDay(props.expiresAt)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
            Media release
          </span>
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight wrap-anywhere max-narrow:text-2xl">
            Let Daisy and others reuse @{props.minor}’s debate Rounds?
          </h1>
          <p className="text-lg text-ink-muted">
            @{props.minor} asked you to sign. Their Rounds can be watched on
            Daisy under each Room’s settings, and ranked Rounds are public, but
            nobody may clip, download or reuse them without a release.
          </p>
        </div>
        <ReleaseTerms minor={props.minor} />
        <ReleaseUnchanged minor={props.minor} />
        <form action={sign} className="flex flex-col gap-8">
          <ReleasePaidAdsFields minor={props.minor} values={values} />
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5">
            <h2 className="font-display text-xl font-bold">Sign</h2>
            <ReleaseSignatureFields minor={props.minor} values={values} />
            {refusal === undefined ? null : (
              <StatusRegion as="p" role="alert" className={errorClass}>
                {refusal}
              </StatusRegion>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                className="min-h-release-target"
                aria-busy={pending}
              >
                Sign release
              </Button>
              <Button
                type="submit"
                variant="secondary"
                className="min-h-release-target"
                formAction={decline}
                formNoValidate
              >
                Decline
              </Button>
            </div>
            <p className="text-sm text-ink-muted">
              We record your name, this email address, the time and the release
              version. Declining tells @{props.minor} you said no and changes
              nothing else.
            </p>
          </section>
        </form>
        <div className="hidden max-compact:block">
          <NotMe notMe={notMe} />
        </div>
      </div>
      <RequestFacts {...props} notMe={notMe} />
    </div>
  );
}
