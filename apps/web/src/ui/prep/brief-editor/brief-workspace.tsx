'use client';

import { Icon } from '../../components/icon/icon';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import type { PageTone } from '../../debate-room/room-state';
import { DocumentEditor } from '../../debate-room/editor/document-editor';
import { prepDestinations } from '../../../features/prep/actions';
import {
  briefOutline,
  evidenceHtml,
  findEvidence,
  withSection,
} from '../../../features/prep/briefs/brief-document';
import type { BriefEditorView } from '../../../features/prep/briefs/brief-editor';
import { controlClass } from '../form-controls/form-class';
import { TimeBar } from '../time-bar/time-bar';

const heading =
  'px-3 text-xs font-strong tracking-widest text-ink-faint uppercase';
const marginButton =
  'flex min-h-prep-control w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink';

/**
 * The brief as one rich-text document between its margins. The outline and
 * reading time are read back from the document as it is written; the
 * evidence margin searches the owner's cards and drops one in at the end.
 */
export function BriefWorkspace({ view }: { readonly view: BriefEditorView }) {
  const [html, setHtml] = useState(view.html);
  const [tone, setTone] = useState<PageTone>('light');
  const [search, setSearch] = useState('');
  const page = useRef<HTMLDivElement>(null);
  const outline = useMemo(
    () => briefOutline(html, view.pace, view.limitSeconds),
    [html, view.pace, view.limitSeconds],
  );
  const found = useMemo(
    () => findEvidence(view.evidence, search),
    [view.evidence, search],
  );
  const document = useMemo(
    () => ({
      id: view.id,
      title: view.title === '' ? 'New brief' : view.title,
      folder: 'library' as const,
      templateId: 'block' as const,
      html,
      createdAt: '',
      updatedAt: '',
    }),
    [view.id, view.title, html],
  );
  const goTo = (index: number) => {
    const headings = page.current?.querySelectorAll('h2');
    headings?.[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="grid min-h-0 flex-1 prep-brief-grid gap-8 px-6 max-compact:gap-5 max-compact:px-4">
      <div className="flex flex-col gap-6 pt-10 max-compact:order-last max-compact:pt-0 max-compact:pb-8">
        <nav aria-label="Outline" className="flex flex-col gap-1">
          <h2 className={heading}>Outline</h2>
          <ul className="flex flex-col">
            {outline.sections.map((section) => (
              <li key={section.index}>
                <button
                  type="button"
                  className={marginButton}
                  onClick={() => goTo(section.index)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {section.label}
                  </span>
                  {section.cards > 0 ? (
                    <span className="text-xs text-ink-faint tabular-nums">
                      <span className="sr-only">Cards: </span>
                      {section.cards}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={marginButton}
            onClick={() => setHtml((current) => withSection(current, outline))}
          >
            <Icon name="plus" size={16} />
            Section
          </button>
        </nav>
        <section
          aria-label="Time against the debate rules"
          className="flex flex-col gap-3 border-t border-border px-3 pt-4"
        >
          <TimeBar
            label="Whole brief, read as one speech"
            clock={outline.clock}
            budget={outline.budget}
            overText={`${outline.overClock} over · cut about ${outline.trimWords} words`}
          />
          <p className="text-xs text-ink-faint">{`${view.pace} words a minute`}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {outline.sections.map((section) => (
              <li key={section.index} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-ink-muted">
                  {section.label}
                </span>
                <span className="text-ink-faint tabular-nums">
                  {section.clock}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-label="Details"
          className="flex flex-col gap-3 border-t border-border px-3 pt-4"
        >
          <label className="flex flex-col gap-1 text-xs font-strong text-ink-muted">
            Side
            <select
              name="side"
              defaultValue={view.side}
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
              defaultValue={view.motion}
              className={controlClass}
            >
              {view.motion === '' ? <option value="">None</option> : null}
              <option value="[Motion A]">[Motion A]</option>
              <option value="[Motion B]">[Motion B]</option>
            </select>
          </label>
        </section>
      </div>

      <div
        ref={page}
        className="flex min-h-screen flex-col border-x border-border max-compact:min-h-0 max-compact:border-x-0"
      >
        <DocumentEditor
          document={document}
          access={view.accessLabel}
          page={tone}
          onPage={setTone}
          onChange={setHtml}
        />
      </div>

      <aside
        aria-label="Evidence"
        className="flex flex-col gap-3 pt-10 max-reflow:col-start-2 max-reflow:pt-0 max-compact:col-start-1"
      >
        <label className="flex h-prep-control items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 text-ink-muted">
          <Icon name="search" size={16} />
          <span className="sr-only">Find evidence</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base text-ink"
          />
        </label>
        <ul aria-label="Evidence results" className="flex flex-col gap-2">
          {found.map((card) => (
            <li
              key={card.id}
              className="flex items-start gap-2 rounded-md border border-border bg-surface-raised p-3"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  className={`text-xs font-strong tracking-wide uppercase ${
                    card.owner === 'Mine' ? 'text-hue-clay' : 'text-hue-teal'
                  }`}
                >
                  {`Card · ${card.owner}`}
                </span>
                <span className="text-sm font-strong">{card.title}</span>
                <span className="text-xs text-ink-faint">{card.cite}</span>
              </span>
              <button
                type="button"
                aria-label={`Add “${card.title}” to the brief`}
                className="inline-flex size-prep-control shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
                onClick={() =>
                  setHtml((current) => `${current}${evidenceHtml(card)}`)
                }
              >
                <Icon name="plus" size={18} />
              </button>
            </li>
          ))}
        </ul>
        {found.length === 0 ? (
          <p className="text-sm text-ink-muted">{`No cards match “${search}”`}</p>
        ) : null}
        <Link
          href={prepDestinations.addEvidence}
          className="flex min-h-prep-control items-center justify-center gap-2 rounded-sm border border-dashed border-border-strong text-sm text-ink-muted no-underline hover:text-ink hover:no-underline"
        >
          <Icon name="card" size={16} />
          Cut a new card from a source
        </Link>
      </aside>
    </div>
  );
}
