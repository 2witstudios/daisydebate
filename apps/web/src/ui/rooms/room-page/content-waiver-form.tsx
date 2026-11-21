'use client';

import { Button } from '../../components/button/button';
import Link from 'next/link';
import {
  contentWaiverAt,
  contentWaiverDocument,
  youthContentWaiverDocument,
} from '../../../features/legal/agreements';
import { contentWaiverFields } from '../../../features/agreements/submit-content-waiver';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { RoomAnswerForm } from './assembly-command-form';

/**
 * The season's content waiver, signed in place before Ready (WATCH-15). A
 * native form with a required box: it works before hydration, and the server
 * refuses a post without the tick. The waiver stays on screen whatever the
 * answer: when one is lost the member signs again, which is the same
 * signature. A member under 18 signs the Youth waiver, which grants no
 * licence (ADR 0161); the server names which.
 */
export function ContentWaiverForm({
  action,
  version,
}: {
  readonly action: FormAction<RoomFormState>;
  /** The waiver this viewer's lobby signs, as the Room read named it. */
  readonly version: string | null;
}) {
  const waiver =
    (version === null ? null : contentWaiverAt(version)) ??
    contentWaiverDocument;
  const youth = waiver === youthContentWaiverDocument;
  const page = youth ? '/youth-content-waiver' : '/content-waiver';
  const name = youth ? 'Youth ranked content waiver' : 'ranked content waiver';
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
          Sign the {name}
        </h2>
        <p className="text-sm text-ink-muted">{waiver.lede}</p>
        <p className="text-sm text-ink-muted">
          You sign once per season, separately from the terms. If you’d rather
          not, play casual.
        </p>
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer font-semibold text-ink">
            Read the waiver, version {waiver.version}
          </summary>
          {waiver.sections.map((section) => (
            <div key={section.id} className="mt-3 flex flex-col gap-1">
              <h3 className="font-semibold text-ink">{section.heading}</h3>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          ))}
          <p className="mt-3">
            Also at <Link href={page}>the waiver page</Link> and the{' '}
            <Link href="/content-policy">ranked content policy</Link>.
          </p>
        </details>
        <input type="hidden" name="version" value={waiver.version} />
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="accepted" value="yes" required />
          <span>I agree to the {name} for this season.</span>
        </label>
        <Button variant="primary" type="submit">
          Sign waiver
        </Button>
      </section>
    </RoomAnswerForm>
  );
}
