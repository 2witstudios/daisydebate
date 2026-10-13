import Link from 'next/link';
import type { BriefEditorView } from '../../../features/prep/briefs/brief-editor';
import { inertActions } from '../../../features/prep/actions';
import { buttonClass } from '../../components/button/button-class';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { InertActionButton } from '../inert-action/inert-action';
import { OfflineNotice } from '../offline-notice/offline-notice';
import { BriefWorkspace } from './brief-workspace';

const action = 'min-h-prep-control px-3 py-2 text-sm';
const link = 'no-underline hover:no-underline';

/**
 * The brief editor: a bar with the trail, save state, share, review and add
 * to case, then the brief as one document with its outline and time in the
 * left margin and evidence search in the right.
 */
export function BriefEditor({ view }: { readonly view: BriefEditorView }) {
  return (
    <div className="flex w-full flex-col">
      <header className="flex min-h-12 flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-2 max-compact:px-4">
        <div className="min-w-0 flex-1 max-compact:basis-full">
          <Breadcrumb
            crumbs={[
              { label: 'Prep', href: '/prep' },
              { label: 'Briefs', href: '/prep?view=briefs' },
              { label: view.title === '' ? 'New brief' : view.title },
            ]}
          />
        </div>
        <p className="text-xs text-ink-faint">{view.savedLabel}</p>
        <InertActionButton
          action={inertActions.saveBrief}
          variant="ghost"
          className={action}
        />
        <Link
          href={view.shareHref}
          className={`${buttonClass('secondary')} ${action} ${link}`}
        >
          Share
        </Link>
        <InertActionButton action={inertActions.addToCase} className={action} />
        <Link
          href={view.reviewHref}
          className={`${buttonClass('primary')} ${action} ${link}`}
        >
          Review
        </Link>
      </header>
      <div className="px-5 pt-3 empty:hidden max-compact:px-4">
        <OfflineNotice />
      </div>
      <BriefWorkspace view={view} />
    </div>
  );
}
