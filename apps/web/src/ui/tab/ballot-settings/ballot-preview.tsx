'use client';

import type { ReactNode } from 'react';
import type {
  BallotDefinition,
  BallotSettings,
} from '../../../features/tab/ballot-definition';
import { ConfiguredBallot } from '../ballot/configured-ballot';

/** Who reads a previewed reason for decision. */
const previewReasonReaders = 'Both debaters and their coaches read this.';

/**
 * A ballot settings page: the judge's ballot as the main column and the
 * settings in a column to its right; on a narrow screen the ballot comes
 * first and the settings follow. The preview must stay outside every form
 * in the settings, so its sample answers are never posted (and the ballot's
 * fields, which seed from their own form, never read the settings').
 */
export function BallotPreviewLayout({
  preview,
  children,
}: {
  readonly preview: ReactNode;
  /** The settings column. */
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 max-rail:flex-col">
      {preview}
      <div className="flex w-host-aside shrink-0 flex-col gap-4 max-rail:w-full">
        {children}
      </div>
    </div>
  );
}

/**
 * What a judge sees: the ballot a definition gives, drawn with the sample
 * names and answers, disabled. `status` says which definition this is (the
 * saved one, a draft, a version not yet chosen) where that can differ.
 */
export function BallotPreview({
  definition,
  preview,
  status,
}: {
  /** Null where the format has no ballot. */
  readonly definition: BallotDefinition | null;
  readonly preview: BallotSettings['preview'];
  readonly status?: ReactNode;
}) {
  return (
    <section
      aria-label="Preview of the judge's ballot"
      className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5 max-rail:w-full max-narrow:p-3"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-bold">What a judge sees</h2>
        <p className="text-sm text-ink-muted">{preview.lede}</p>
        {status ? (
          <p role="status" className="text-sm font-strong text-ink">
            {status}
          </p>
        ) : null}
      </div>
      {definition ? (
        <ConfiguredBallot
          key={JSON.stringify(definition)}
          definition={definition}
          subjects={preview.subjects}
          draft={preview.draft}
          reasonReaders={previewReasonReaders}
          preview
        />
      ) : (
        <p className="text-ink-muted">
          This format has no ballot, so a judge is given none.
        </p>
      )}
    </section>
  );
}
