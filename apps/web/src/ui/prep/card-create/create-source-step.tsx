import Link from 'next/link';
import type { CardCreateView } from '../../../features/prep/cards/card-create';
import { buttonClass } from '../../components/button/button-class';
import {
  controlClass,
  fieldClass,
  labelClass,
  textareaClass,
} from '../form-controls/form-class';
import { DetailList } from '../detail-list/detail-list';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';
import { StateAlert } from '../state-alert/state-alert';

const link = 'no-underline hover:no-underline';
const modeSymbols: Readonly<Record<string, PrepIconName>> = {
  paste: 'copy',
  link: 'link',
  file: 'upload',
};

function NextLink({ href }: { readonly href: string }) {
  return (
    <Link href={href} className={`${buttonClass('primary')} ${link}`}>
      Next: highlight
      <PrepIcon name="arrowRight" size={18} />
    </Link>
  );
}

function FetchedPage(props: {
  readonly outcome: Extract<CardCreateView['outcome'], { kind: 'fetched' }>;
}) {
  const { outcome } = props;
  const rows: readonly (readonly [string, string])[] = [
    ['Title', outcome.title],
    ['Author', `${outcome.author} (check this)`],
    ['Published', outcome.published],
    ['Words', `${outcome.words.toLocaleString('en-US')} extracted`],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-4">
      <p className="flex items-center gap-2 text-base font-strong">
        <PrepIcon name="check" size={18} className="text-online" />
        Page fetched
      </p>
      <DetailList rows={rows} />
    </div>
  );
}

/** Step 1: where the source comes from. */
export function CreateSourceStep({ view }: { readonly view: CardCreateView }) {
  const { query, outcome } = view;
  return (
    <section aria-labelledby="source-heading" className="flex flex-col gap-4">
      <h2 id="source-heading" className="text-lg font-bold">
        Where is the source?
      </h2>
      <nav aria-label="Source type">
        <ul className="flex flex-wrap gap-2">
          {view.sourceModes.map((mode) => (
            <li key={mode.id}>
              <Link
                href={mode.href}
                aria-current={mode.current ? 'true' : undefined}
                className={`${buttonClass(mode.current ? 'primary' : 'secondary')} ${link}`}
              >
                <PrepIcon name={modeSymbols[mode.id] ?? 'copy'} size={18} />
                {mode.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {query.src === 'paste' ? (
        <>
          <div className={fieldClass}>
            <label htmlFor="src-text" className={labelClass}>
              Source text
            </label>
            <textarea
              id="src-text"
              name="src-text"
              rows={8}
              defaultValue={view.draft.text}
              placeholder="Paste the article or excerpt here"
              className={textareaClass}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">
              {`${view.draft.wordsDetected} words detected`}
            </p>
            {view.nextHref === null ? null : <NextLink href={view.nextHref} />}
          </div>
        </>
      ) : null}
      {query.src === 'link' ? (
        <>
          <form
            action="/prep/cards/new"
            method="get"
            className="flex items-end gap-3 max-compact:flex-col max-compact:items-stretch"
          >
            <input type="hidden" name="src" value="link" />
            <div className={`${fieldClass} flex-1`}>
              <label htmlFor="src-url" className={labelClass}>
                Link to the source
              </label>
              <input
                id="src-url"
                name="url"
                type="text"
                inputMode="url"
                defaultValue={query.url}
                placeholder="https://"
                className={controlClass}
              />
            </div>
            <button type="submit" className={buttonClass('primary')}>
              <PrepIcon name="download" size={18} />
              Fetch page
            </button>
          </form>
          {outcome.kind === 'invalid' ? (
            <p role="alert" className="text-sm text-live">
              Enter a link that starts with https:// or http://.
            </p>
          ) : null}
          {view.notice === null ? null : <StateAlert notice={view.notice} />}
          {outcome.kind === 'fetched' ? (
            <>
              <FetchedPage outcome={outcome} />
              <div className="flex justify-end">
                {view.nextHref === null ? null : (
                  <NextLink href={view.nextHref} />
                )}
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {query.src === 'file' ? (
        <>
          <label
            htmlFor="src-file"
            className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-raised p-6 text-center"
          >
            <PrepIcon name="upload" size={24} className="text-ink-muted" />
            <span className="text-base font-strong">
              Drop a PDF or DOCX here, or choose a file
            </span>
            <span className="text-sm text-ink-muted">Up to 20 MB</span>
            <input
              id="src-file"
              name="src-file"
              type="file"
              accept=".pdf,.docx"
              className="text-sm"
            />
          </label>
          <div className="flex justify-end">
            {view.nextHref === null ? null : <NextLink href={view.nextHref} />}
          </div>
        </>
      ) : null}
    </section>
  );
}
