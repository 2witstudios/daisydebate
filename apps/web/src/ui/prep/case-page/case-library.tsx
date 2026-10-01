import Link from 'next/link';
import type { CaseView } from '../../../features/prep/case-view';
import { Icon } from '../../components/icon/icon';
import { controlClass } from '../form-controls/form-class';
import { IconButtonInert } from '../inert-action/icon-button-inert';
import { PrepIcon } from '../prep-icon/prep-icon';

/** The left panel: find a brief or card to add. Search is a GET form. */
export function CaseLibraryPanel({ view }: { readonly view: CaseView }) {
  return (
    <aside
      aria-label="Add from your library"
      className="flex w-rail shrink-0 flex-col gap-3 max-rail:w-full"
    >
      <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Add from your library
      </h2>
      <form
        action={`/prep/cases/${view.case.id}`}
        method="get"
        role="search"
        className="flex flex-col gap-2"
      >
        {view.query.view === 'compose' ? null : (
          <input type="hidden" name="view" value={view.query.view} />
        )}
        <label
          className={`${controlClass} flex items-center gap-2 text-ink-muted`}
        >
          <Icon name="search" size={16} />
          <input
            type="search"
            name="q"
            defaultValue={view.query.q}
            placeholder="Find a brief or card"
            aria-label="Find a brief or card"
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
          />
        </label>
      </form>
      {view.sources.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing matches that search.</p>
      ) : (
        <ul className="flex flex-col">
          {view.sources.map((source) => (
            <li key={source.id} className="flex min-h-12 items-center gap-2">
              <span
                className={`inline-flex size-avatar-sm shrink-0 items-center justify-center rounded-sm ${
                  source.kind === 'brief'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-gold-soft text-gold'
                }`}
              >
                <PrepIcon
                  name={source.kind === 'brief' ? 'doc' : 'card'}
                  size={14}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-strong">{source.title}</span>
                <span className="text-xs text-ink-muted">{source.detail}</span>
              </span>
              <IconButtonInert
                label={`Add ${source.title} to speech`}
                symbol="plus"
              />
            </li>
          ))}
        </ul>
      )}
      <Link href="/prep" className="text-sm font-strong">
        Open library
      </Link>
    </aside>
  );
}
