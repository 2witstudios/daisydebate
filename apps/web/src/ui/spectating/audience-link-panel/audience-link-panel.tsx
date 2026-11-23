'use client';

import { Announcement } from '../../components/announcement/announcement';
import { Button } from '../../components/button/button';
import type { AudienceLinkAnswer } from '../../../features/audience-link/submit-issue';
import { Panel } from '../../components/panel/panel';
import { buttonClass } from '../../components/button/button-class';
import { useFormAction } from '../../form-action/form-action';
import { CopyableUrlField } from '../../watch/copy-link/copyable-url-field';

const unavailable = (): AudienceLinkAnswer => ({ kind: 'unavailable' });

/**
 * Issues or replaces an unlisted Round's link with a native post. The link is
 * stored only as a hash, so this answer is the one time it can ever be shown.
 */
export function AudienceLinkPanel({
  issued,
  action,
}: {
  readonly issued: boolean;
  readonly action: () => Promise<AudienceLinkAnswer>;
}) {
  const [answer, formAction, pending] = useFormAction<AudienceLinkAnswer>(
    action,
    { kind: 'idle' },
    unavailable,
  );
  const hasLink = issued || answer.kind === 'issued';
  return (
    <Panel title="Share by link">
      <div className="flex flex-col gap-4 text-base">
        <p>
          This Round is unlisted. Only people with its link can watch it or its
          Recording, and they need no account.
        </p>
        {answer.kind === 'issued' ? (
          <Announcement
            as="div"
            kind="progress"
            className="flex flex-col gap-2"
          >
            <CopyableUrlField url={answer.url} label="Round link" />
            <p className="text-sm text-ink-muted">
              Copy it now. It is shown only this once.
            </p>
          </Announcement>
        ) : null}
        {answer.kind === 'refused' ? (
          <Announcement as="p" kind="problem">
            That link could not be made.
          </Announcement>
        ) : null}
        {answer.kind === 'unavailable' ? (
          <Announcement as="p" kind="problem">
            Links are unavailable right now. Try again in a moment.
          </Announcement>
        ) : null}
        <form action={formAction}>
          <Button
            variant="unstyled"
            type="submit"
            disabled={pending}
            className={buttonClass(hasLink ? 'secondary' : 'primary')}
          >
            {hasLink ? 'Replace link' : 'Create link'}
          </Button>
        </form>
        {hasLink ? (
          <p className="text-sm text-ink-muted">
            Replacing the link stops the old one for anyone opening it from now
            on. People already watching the Broadcast are not cut off from its
            feed.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
