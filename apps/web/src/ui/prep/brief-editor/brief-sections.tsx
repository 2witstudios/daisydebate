import type { BriefEditorView } from '../../../features/prep/brief-editor';
import { inertActions } from '../../../features/prep/actions';
import { wordCount } from '../../../features/prep/reading-time';
import { InertActionButton } from '../inert-action/inert-action';
import { TimeBar } from '../time-bar/time-bar';
import { EvidenceList, ResponseList, WordField } from './brief-fields';

const panel =
  'flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-1 max-compact:p-4';

export function FramingSection({ view }: { readonly view: BriefEditorView }) {
  const { brief, section } = view;
  if (section.kind !== 'framing') return null;
  return (
    <section aria-labelledby="sec-heading" className={panel}>
      <h2 id="sec-heading" className="text-lg font-bold">
        Motion and framing
      </h2>
      <WordField id="res" label="Motion" single value={brief.framing.motion} />
      <WordField
        id="burden"
        label="Burden and weighing"
        value={brief.framing.burden}
        words={wordCount(brief.framing.burden)}
      />
      <EvidenceList cards={brief.framing.cards} showCount={false} />
    </section>
  );
}

export function ContentionSection({
  view,
}: {
  readonly view: BriefEditorView;
}) {
  const { section, time } = view;
  if (section.kind !== 'contention') return null;
  const { contention, number } = section;
  return (
    <section aria-labelledby="sec-heading" className={panel}>
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="sec-heading"
          className="text-lg font-bold"
        >{`Contention ${number}`}</h2>
        <p className="text-sm text-ink-muted">{`${section.words} words · about ${section.clock}`}</p>
      </div>
      <WordField
        id={`tag-${contention.id}`}
        label="Tag line"
        single
        value={contention.tag}
      />
      <WordField
        id={`cl-${contention.id}`}
        label="Claim"
        value={contention.claim}
        words={section.claimWords}
      />
      <WordField
        id={`wa-${contention.id}`}
        label="Warrant"
        rows={6}
        value={contention.warrant}
        words={section.warrantWords}
      />
      <WordField
        id={`im-${contention.id}`}
        label="Impact"
        value={contention.impact}
        words={section.impactWords}
      />
      <EvidenceList
        cards={contention.cards}
        showCount
        findHref="/prep?view=cards"
      />
      <section
        aria-label="Anticipated responses"
        className="flex flex-col gap-3"
      >
        <h3 className="text-md font-strong">Anticipated responses</h3>
        <ResponseList responses={contention.responses} />
        <InertActionButton
          action={inertActions.addResponse}
          variant="ghost"
          symbol="plus"
        />
      </section>
      <TimeBar
        label={`Contention ${number} on its own`}
        clock={section.clock}
        budget={section.own}
        overText={`${time.overClock} over`}
        spareText={`${section.own.spareClock} to spare`}
      />
    </section>
  );
}

export function ResponsesSection({ view }: { readonly view: BriefEditorView }) {
  const { section } = view;
  if (section.kind !== 'responses') return null;
  return (
    <section aria-labelledby="sec-heading" className={panel}>
      <h2 id="sec-heading" className="text-lg font-bold">
        Anticipated responses
      </h2>
      {section.groups.length === 0 ? (
        <p className="text-sm text-ink-muted">No responses yet.</p>
      ) : (
        section.groups.map((group, index) => (
          <div key={`${group.label}-${index}`} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-ink-faint">{group.label}</h3>
            <ResponseList responses={group.responses} />
          </div>
        ))
      )}
      <InertActionButton action={inertActions.addResponse} symbol="plus" />
    </section>
  );
}
