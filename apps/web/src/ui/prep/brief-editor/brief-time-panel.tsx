import type { BriefEditorView } from '../../../features/prep/brief-editor';
import { TimeBar } from '../time-bar/time-bar';

/** Reading time against the debate rules, for the whole brief and by section. */
export function BriefTimePanel({ view }: { readonly view: BriefEditorView }) {
  const { time } = view;
  return (
    <aside
      aria-label="Time against the debate rules"
      className="flex w-rail shrink-0 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-1 max-compact:w-full"
    >
      <h2 className="text-md font-bold">Time against the debate rules</h2>
      <TimeBar
        label="Whole brief, read as one speech"
        clock={time.whole.clock}
        budget={time.budget}
        overText={`${time.overClock} over · cut about ${time.trimWords} words`}
      />
      <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm">
        <p className="font-strong">Your reading pace</p>
        <p className="text-ink-muted">{`${view.paceLabel} words a minute`}</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          By section
        </h3>
        <ul className="flex flex-col gap-1 text-sm">
          {time.sections.map((section) => (
            <li key={section.label} className="flex justify-between">
              <span>{section.label}</span>
              <span className="text-ink-muted tabular-nums">
                {section.clock}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
