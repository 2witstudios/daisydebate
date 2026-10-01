import Link from 'next/link';
import type { SharePanel as Model } from '../../../features/watch/replay-panels';
import {
  replayHiddenFields,
  replayQueryHref,
  type ReplayQuery,
} from '../../../features/watch/replay-query';
import { replayHref } from '../../../features/watch/routes';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { CopyLink } from '../copy-link/copy-link';
import { InertButton } from '../inert-button/inert-button';

export type SharePanelProps = {
  readonly id: string;
  readonly query: ReplayQuery;
  readonly share: Model;
};

function Manager({ id, query, share }: SharePanelProps) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <AutoSubmitForm
        action={replayHref(id)}
        aria-label="Who can replay this debate"
        className="flex flex-col gap-2"
      >
        {replayHiddenFields(query, ['vis']).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-strong text-ink">
            Who can replay this debate
          </legend>
          {share.options.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex items-start gap-2 rounded-sm border border-border p-2 has-checked:border-accent has-checked:bg-accent-soft',
                option.locked && 'opacity-60',
              )}
            >
              <input
                type="radio"
                name="vis"
                value={option.value}
                defaultChecked={option.checked}
                disabled={option.locked}
              />
              <span className="flex flex-col">
                <span className="text-base font-strong text-ink">
                  {option.label}
                </span>
                <span className="text-sm text-ink-muted">{option.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className={cn(buttonClass('ghost'), 'self-start')}
        >
          Use this choice
        </button>
      </AutoSubmitForm>
      <p className="text-sm text-ink-muted">
        Making a debate less visible removes it from the archive at once and
        signs out anyone still watching. It does not erase the rating change.
      </p>
      <div className="flex items-center gap-3">
        <InertButton action="saveVisibility" variant="primary">
          Save visibility
        </InertButton>
        <Link
          href={replayQueryHref(id, { ...query, manage: false, vis: null })}
          className="text-base font-strong"
        >
          Close
        </Link>
      </div>
    </div>
  );
}

/** Who can replay, the owner's visibility manager, and the link to share. */
export function SharePanel({ id, query, share }: SharePanelProps) {
  return (
    <section
      aria-label="Sharing"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1"
    >
      <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Share and visibility
      </span>
      <div className="flex items-center justify-between gap-3">
        <Badge tone={share.visibility === 'Private' ? 'gold' : 'accent'}>
          {share.visibility}
        </Badge>
        {share.canManage && !share.manageOpen ? (
          <Link
            href={replayQueryHref(id, {
              ...query,
              manage: true,
              pane: 'share',
            })}
            className={cn(
              buttonClass('secondary'),
              'no-underline hover:no-underline',
            )}
          >
            Manage visibility
          </Link>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">{share.description}</p>
      <div>
        <CopyLink path={share.linkPath} />
      </div>
      {share.manageOpen ? (
        <Manager id={id} query={query} share={share} />
      ) : null}
      <p className="text-xs text-ink-faint">{share.retention}</p>
    </section>
  );
}
