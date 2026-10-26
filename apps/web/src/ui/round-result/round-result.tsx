import type { RoundBallotRead } from '@daisy/protocol';
import { ballotDebaters } from '../../features/round-ballots/presentation';
import { ballotEyebrowClass, sideTextClass } from '../ballot/ballot-class';
import { BallotSummary } from '../ballot/ballot-summary/ballot-summary';
import { StoredBallotScores } from '../ballot/stored-ballot-scores';
import { cn } from '../cn';
import {
  resultBallots,
  resultCoaching,
  transcriptSections,
} from './result-view';

const cardClass = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';

/**
 * Why the round went the way it did: the judges' official decision, then the
 * reader's own AI coaching, then the transcript a seated reader may read.
 * The decision and the coaching are labelled apart: only ballots decide.
 */
export function RoundResult({ view }: { readonly view: RoundBallotRead }) {
  const ballots = resultBallots(view);
  const coaching = resultCoaching(view);
  const sections = transcriptSections(view);
  return (
    <>
      {ballots.length ? (
        <section aria-labelledby="result-decision" className={cardClass}>
          <header className="flex flex-col gap-1">
            <h2 id="result-decision" className="font-strong">
              The decision
            </h2>
            <p className="text-sm text-ink-muted">
              The judges’ ballots decide the round. Each says who judged: a
              human judge or the AI judge.
            </p>
          </header>
          {ballots.map((entry) => (
            <section
              key={entry.title}
              aria-label={entry.title}
              className="flex min-w-0 flex-col gap-4"
            >
              <p className={ballotEyebrowClass}>
                Official decision · {entry.author}
              </p>
              {entry.voided ? (
                <p className="text-ink-muted">
                  This ballot was voided and does not count.
                </p>
              ) : null}
              <BallotSummary
                title={entry.title}
                ballot={entry.ballot}
                debaters={ballotDebaters(view)}
                feedbackTitle={`Feedback for you from the ${entry.author.toLowerCase()}`}
              />
              <StoredBallotScores
                title={`${entry.title} scores`}
                ballot={entry.ballot}
                debaters={ballotDebaters(view)}
              />
            </section>
          ))}
        </section>
      ) : null}
      {coaching ? (
        <section aria-labelledby="result-coaching" className={cardClass}>
          <header className="flex flex-col gap-1">
            <h2 id="result-coaching" className="font-strong">
              AI coaching for you
            </h2>
            <p className="text-sm text-ink-muted">
              Only you see this. It is advice from the transcript and does not
              change the decision.
            </p>
          </header>
          {coaching.kind === 'ready' ? (
            <p className="text-base text-ink">{coaching.text}</p>
          ) : (
            <p className="text-ink-muted">{coaching.text}</p>
          )}
        </section>
      ) : null}
      {view.transcript ? (
        <section aria-labelledby="result-transcript" className={cardClass}>
          <h2 id="result-transcript" className="font-strong">
            Transcript
          </h2>
          {view.transcript.completeness === 'incomplete' ? (
            <p className="text-sm text-ink-muted">
              Some speech was not captured, so this transcript is incomplete.
            </p>
          ) : null}
          {sections.length ? (
            <details>
              <summary className="cursor-pointer font-strong">
                Show the transcript
              </summary>
              {sections.map((section) => (
                <section key={section.key} className="pt-3">
                  <h3
                    className={cn(
                      'mb-1 text-sm font-strong',
                      sideTextClass(section.side),
                    )}
                  >
                    {section.heading}
                  </h3>
                  <ol className="flex flex-col gap-1">
                    {section.lines.map((line) => (
                      <li key={line.id} className="text-sm text-ink">
                        <span className="font-strong">{line.speaker}: </span>
                        {line.text}
                        {line.partial ? (
                          <span className="text-ink-muted"> (cut off)</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </details>
          ) : (
            <p className="text-ink-muted">No speech was captured.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
