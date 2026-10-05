import Link from 'next/link';
import {
  cardCreateHref,
  type CardCreateView,
  type MarkTool,
} from '../../../features/prep/card-create';
import { buttonClass } from '../../components/button/button-class';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';
import { SourceText } from '../source-text/source-text';

const link = 'no-underline hover:no-underline';

const tools: readonly {
  readonly id: MarkTool;
  readonly label: string;
  readonly symbol: PrepIconName;
}[] = [
  { id: 'read', label: 'Read aloud', symbol: 'pencil' },
  { id: 'keep', label: 'Keep, do not read', symbol: 'bookmark' },
  { id: 'clear', label: 'Clear', symbol: 'x' },
];

/** Step 2: mark what is read aloud. */
export function CreateHighlightStep({
  view,
}: {
  readonly view: CardCreateView;
}) {
  const { draft, query } = view;
  return (
    <section
      aria-labelledby="highlight-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="highlight-heading" className="text-lg font-bold">
        Mark what you would read aloud
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Marking tool">
          <ul className="flex flex-wrap gap-2">
            {tools.map((tool) => (
              <li key={tool.id}>
                <Link
                  href={cardCreateHref({ ...query, tool: tool.id })}
                  aria-current={query.tool === tool.id ? 'true' : undefined}
                  className={`${buttonClass(query.tool === tool.id ? 'primary' : 'secondary')} ${link}`}
                >
                  <PrepIcon name={tool.symbol} size={18} />
                  {tool.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-sm text-ink-muted">
          {`${draft.readWords} words · about ${draft.readClock}`}
        </p>
      </div>
      <p className="rounded-lg bg-surface-raised p-5 text-md leading-normal text-ink-muted">
        <SourceText segments={draft.segments} />
      </p>
      <div className="flex items-center justify-between gap-3">
        {view.backHref === null ? null : (
          <Link
            href={view.backHref}
            className={`${buttonClass('secondary')} ${link}`}
          >
            Back
          </Link>
        )}
        {view.nextHref === null ? null : (
          <Link
            href={view.nextHref}
            className={`${buttonClass('primary')} ${link}`}
          >
            Next: cite and save
            <PrepIcon name="arrowRight" size={18} />
          </Link>
        )}
      </div>
    </section>
  );
}
