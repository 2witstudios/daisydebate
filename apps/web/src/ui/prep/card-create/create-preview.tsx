import type { CardCreateView } from '../../../features/prep/cards/card-create';
import { SourceText } from '../source-text/source-text';

/** The rail beside every step: a live look at the card and its citation. */
export function CreatePreview({ view }: { readonly view: CardCreateView }) {
  const { fields, completeness } = view.cite;
  return (
    <aside
      aria-label="Preview"
      className="flex w-rail shrink-0 flex-col gap-4 max-rail:w-full"
    >
      <section className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-1">
        <h2 className="font-display text-lg leading-tight font-bold">
          Untitled card
        </h2>
        <p className="text-sm text-ink-muted">
          <strong className="text-ink">{fields.author}</strong>
          {` · ${fields.qualifications}, ${fields.publication}`}
        </p>
        <p className="text-base leading-normal text-ink-muted">
          <SourceText segments={view.draft.segments} />
        </p>
      </section>
      <section className="flex flex-col gap-2 rounded-lg bg-surface p-5 shadow-1">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Citation</h2>
          <p className="text-sm text-ink-muted">{`${completeness.filled} of ${completeness.total} fields`}</p>
        </div>
        <progress
          max={completeness.total}
          value={completeness.filled}
          aria-label="Citation completeness"
          className="h-2 w-full overflow-hidden rounded-round bg-surface-overlay accent-accent"
        />
        <p className="text-sm text-ink-muted">
          {completeness.missing.length === 0
            ? 'Citation complete'
            : `Missing: ${completeness.missing.join(', ')}`}
        </p>
      </section>
    </aside>
  );
}
