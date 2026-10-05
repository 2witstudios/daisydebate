import Link from 'next/link';
import type { BriefEditorView } from '../../../features/prep/brief-editor';
import { inertActions } from '../../../features/prep/actions';
import { buttonClass } from '../../components/button/button-class';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { controlClass } from '../form-controls/form-class';
import { IconButtonInert } from '../inert-action/icon-button-inert';
import { InertActionButton } from '../inert-action/inert-action';
import { OfflineNotice } from '../offline-notice/offline-notice';
import { PrepIcon } from '../prep-icon/prep-icon';
import { VisibilityMark } from '../visibility-mark/visibility-mark';
import { BriefTimePanel } from './brief-time-panel';
import {
  ContentionSection,
  FramingSection,
  ResponsesSection,
} from './brief-sections';

const link = 'no-underline hover:no-underline';

/** The brief editor: outline, the open section, and time against the rules. */
export function BriefEditor({ view }: { readonly view: BriefEditorView }) {
  const { brief, outline } = view;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <Breadcrumb
        crumbs={[
          { label: 'Prep', href: '/prep' },
          { label: 'Briefs', href: '/prep?view=briefs' },
          { label: brief.title === '' ? 'New brief' : brief.title },
        ]}
      />
      <OfflineNotice />
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="brief-title" className="sr-only">
            Brief title
          </label>
          <input
            id="brief-title"
            name="brief-title"
            type="text"
            defaultValue={brief.title}
            placeholder="Name this brief"
            className="w-full bg-transparent font-display text-2xl leading-tight font-bold tracking-tight text-ink placeholder:text-ink-faint"
          />
        </div>
        <p className="text-sm text-ink-muted">{view.savedLabel}</p>
        <InertActionButton action={inertActions.saveBrief} symbol="check" />
        <Link
          href={view.shareHref}
          className={`${buttonClass('secondary')} ${link}`}
        >
          <PrepIcon name="share" size={18} />
          Share
        </Link>
        <InertActionButton
          action={inertActions.addToCase}
          variant="primary"
          symbol="briefcase"
        />
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-strong text-ink-muted">
          Side
          <select
            name="side"
            defaultValue={brief.side}
            className={controlClass}
          >
            <option value="aff">Aff</option>
            <option value="neg">Neg</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-strong text-ink-muted">
          Motion
          <select
            name="motion"
            defaultValue={brief.motion}
            className={controlClass}
          >
            {brief.motion === '' ? (
              <option value="">Choose a motion</option>
            ) : null}
            <option value="[Motion A]">[Motion A]</option>
            <option value="[Motion B]">[Motion B]</option>
          </select>
        </label>
        <span className="ml-auto">
          <VisibilityMark visibility={{ kind: 'private' }} />
        </span>
      </div>
      <div className="flex gap-5 max-compact:flex-col">
        <nav
          aria-label="Outline"
          className="flex w-rail shrink-0 flex-col gap-2 max-compact:w-full"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
              Outline
            </h2>
            <IconButtonInert label="Add contention" symbol="plus" />
          </div>
          <ul className="flex flex-col gap-2 max-compact:flex-row max-compact:overflow-x-auto">
            {outline.map((item) => (
              <li key={item.id} className="max-compact:shrink-0">
                <Link
                  href={item.href}
                  aria-current={item.current ? 'page' : undefined}
                  className={`flex min-h-12 items-center gap-2 rounded-md border px-3 py-2 text-ink no-underline hover:no-underline ${
                    item.current
                      ? 'border-accent bg-accent-soft'
                      : 'border-border bg-surface-raised'
                  }`}
                >
                  {item.reorderable ? (
                    <PrepIcon
                      name="grip"
                      size={16}
                      className="text-ink-faint max-compact:hidden"
                    />
                  ) : null}
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base font-strong">{item.label}</span>
                    <span className="text-xs text-ink-muted max-compact:hidden">
                      {item.detail}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <FramingSection view={view} />
          <ContentionSection view={view} />
          <ResponsesSection view={view} />
        </div>
        <BriefTimePanel view={view} />
      </div>
    </div>
  );
}
