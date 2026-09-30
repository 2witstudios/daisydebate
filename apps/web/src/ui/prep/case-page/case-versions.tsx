import Link from 'next/link';
import type { CaseView } from '../../../features/prep/case-view';
import { inertActions } from '../../../features/prep/actions';
import { Badge } from '../../components/badge/badge';
import { InertActionButton } from '../inert-action/inert-action';
import { controlClass } from '../form-controls/form-class';

/** The version rail: save a version, and walk the history. */
export function CaseVersions({ view }: { readonly view: CaseView }) {
  return (
    <aside
      aria-label="Versions"
      className="flex w-rail shrink-0 flex-col gap-4 max-rail:w-full"
    >
      <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Versions
      </h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="vnote" className="text-sm font-strong">
          Note for this version
        </label>
        <input
          id="vnote"
          name="vnote"
          type="text"
          placeholder="What changed?"
          className={controlClass}
        />
        <InertActionButton
          action={inertActions.saveVersion}
          variant="primary"
          label={`Save as v${view.nextVersion}`}
        />
      </div>
      <ul className="flex flex-col gap-3">
        {view.versions.map((row) => (
          <li key={row.key} className="flex items-start gap-3">
            <span className="w-8 shrink-0 text-sm font-bold text-ink-muted">
              {row.tag}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-strong">{row.title}</span>
              <span className="text-sm text-ink-muted">{row.sub}</span>
            </span>
            {row.draft ? <Badge tone="gold">Draft</Badge> : null}
            {row.compareHref === null ? null : (
              <Link href={row.compareHref} className="text-sm font-strong">
                {row.draft ? 'Review' : 'Compare'}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
