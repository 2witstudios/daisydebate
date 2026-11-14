import type { JudgeBallot as Read } from '../../../features/tab/ballot-definition';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ConfiguredBallot } from '../ballot/configured-ballot';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';

/** One judge's ballot for one fixture, drawn from the event's ballot definition. */
export function JudgeBallot({
  ballot,
  submit,
}: {
  readonly ballot: Read;
  readonly submit: SampleSubmit;
}) {
  return (
    <ReadingPage>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">{ballot.context}</p>
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Your ballot
        </h1>
        {ballot.resolution === null ? null : (
          <p>
            <strong className="font-strong">Resolution:</strong>{' '}
            {ballot.resolution}
          </p>
        )}
      </header>
      <SampleForm action={submit('Submit ballot')} label="Your ballot">
        <ConfiguredBallot
          definition={ballot.definition}
          subjects={ballot.subjects}
          draft={ballot.draft}
          reasonReaders={ballot.reasonReaders}
        />
      </SampleForm>
    </ReadingPage>
  );
}
