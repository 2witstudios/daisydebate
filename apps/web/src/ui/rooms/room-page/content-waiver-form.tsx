'use client';

import Link from 'next/link';
import {
  CONTENT_WAIVER_VERSION,
  contentWaiverDocument,
} from '../../../features/legal/agreements';
import { contentWaiverFields } from '../../../features/agreements/submit-content-waiver';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { buttonClass } from '../../components/button/button-class';
import type { FormAction } from '../../form-action/form-action';
import { RoomAnswerForm } from './assembly-command-form';

/**
 * The season's content waiver, signed in place before Ready (WATCH-15). A
 * native form with a required box: it works without JavaScript, and the server
 * refuses a post without the tick. The waiver stays on screen whatever the
 * answer: when one is lost the member signs again, which is the same
 * signature.
 */
export function ContentWaiverForm({
  action,
}: {
  readonly action: FormAction<RoomFormState>;
}) {
  return (
    <RoomAnswerForm
      action={action}
      fields={contentWaiverFields}
      className="w-full"
    >
      <section
        aria-labelledby="content-waiver-title"
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3"
      >
        <h2 id="content-waiver-title" className="text-md font-semibold">
          Sign the ranked content waiver
        </h2>
        <p className="text-sm text-ink-muted">{contentWaiverDocument.lede}</p>
        <p className="text-sm text-ink-muted">
          You sign once per season, separately from the terms. If you’d rather
          not, play casual.
        </p>
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer font-semibold text-ink">
            Read the waiver, version {CONTENT_WAIVER_VERSION}
          </summary>
          {contentWaiverDocument.sections.map((section) => (
            <div key={section.id} className="mt-3 flex flex-col gap-1">
              <h3 className="font-semibold text-ink">{section.heading}</h3>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          ))}
          <p className="mt-3">
            Also at <Link href="/content-waiver">the waiver page</Link> and the{' '}
            <Link href="/content-policy">ranked content policy</Link>.
          </p>
        </details>
        <input type="hidden" name="version" value={CONTENT_WAIVER_VERSION} />
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="accepted" value="yes" required />
          <span>I agree to the ranked content waiver for this season.</span>
        </label>
        <button type="submit" className={buttonClass('primary')}>
          Sign waiver
        </button>
      </section>
    </RoomAnswerForm>
  );
}
