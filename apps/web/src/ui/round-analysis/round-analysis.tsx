import type { RoundAnalysisView } from '@daisy/protocol';
import {
  roundAnalysisPanel,
  type CitedLine,
  type RoundAnalysisPanel,
} from './round-analysis-view';

const cardClass = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const headingClass = 'text-sm font-strong';

function Quote({ quote }: { readonly quote: CitedLine | null }) {
  return quote ? (
    <blockquote className="border-l-2 border-border pl-3 text-sm text-ink-muted">
      <span className="font-strong">{quote.speaker}:</span> {quote.text}
    </blockquote>
  ) : null;
}

function Report({
  panel,
}: {
  readonly panel: Extract<RoundAnalysisPanel, { kind: 'report' }>;
}) {
  return (
    <>
      <p className="text-base text-ink">{panel.summary}</p>
      <section aria-labelledby="analysis-improvements">
        <h3 id="analysis-improvements" className={headingClass}>
          How to get better
        </h3>
        <ol className="list-decimal pl-5">
          {panel.improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
      {panel.keyMoments.length ? (
        <section
          aria-labelledby="analysis-moments"
          className="flex flex-col gap-3"
        >
          <h3 id="analysis-moments" className={headingClass}>
            Key moments
          </h3>
          {panel.keyMoments.map((moment) => (
            <div key={moment.happened} className="flex flex-col gap-1">
              <Quote quote={moment.quote} />
              <p>{moment.happened}</p>
              <p className="text-ink-muted">{moment.mattered}</p>
              <p>
                <span className="font-strong">Strongest reply: </span>
                {moment.strongestReply}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      {panel.missedOpportunities.length ? (
        <section
          aria-labelledby="analysis-missed"
          className="flex flex-col gap-3"
        >
          <h3 id="analysis-missed" className={headingClass}>
            Missed opportunities
          </h3>
          {panel.missedOpportunities.map((missed) => (
            <div key={missed.argument} className="flex flex-col gap-1">
              <Quote quote={missed.quote} />
              <p>{missed.argument}</p>
              <p>
                <span className="font-strong">Use it: </span>
                {missed.reply}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      <section aria-labelledby="analysis-skills">
        <h3 id="analysis-skills" className={headingClass}>
          Skills
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {panel.skills.map((skill) => (
            <div key={skill.name} className="contents">
              <dt className="font-strong">
                {skill.name}{' '}
                <span className="text-ink-muted">{skill.score}/5</span>
              </dt>
              <dd className="text-ink-muted">{skill.note}</dd>
            </div>
          ))}
        </dl>
      </section>
      {panel.patterns.length ? (
        <section aria-labelledby="analysis-patterns">
          <h3 id="analysis-patterns" className={headingClass}>
            Across your rounds
          </h3>
          <ul className="list-disc pl-5">
            {panel.patterns.map((pattern) => (
              <li key={pattern}>{pattern}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * The debater's own round analysis (DEC-247), from its own read: a premium
 * report, never a decision. `lines` lets cited moments quote the transcript
 * the page already shows.
 */
export function RoundAnalysis({
  view,
  lines,
}: {
  readonly view: RoundAnalysisView;
  readonly lines: readonly CitedLine[];
}) {
  const panel = roundAnalysisPanel(view, lines);
  return (
    <section aria-labelledby="round-analysis" className={cardClass}>
      <div className="flex flex-col gap-1">
        <h2 id="round-analysis" className="font-strong">
          Your round analysis
        </h2>
        <p className="text-sm text-ink-muted">
          Only you see this. It reviews how you debated and does not change the
          decision.
        </p>
      </div>
      {panel.kind === 'report' ? (
        <Report panel={panel} />
      ) : (
        <p className="text-ink-muted">{panel.text}</p>
      )}
    </section>
  );
}
