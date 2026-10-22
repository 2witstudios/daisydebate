import type { RoundBallotRead } from '@daisy/protocol';
export function BallotEvidence({ view }: { readonly view: RoundBallotRead }) {
  if (!view.freeze) return null;
  return (
    <section
      aria-label="Frozen recorded transcript"
      className="flex flex-col gap-3"
    >
      <h2 className="text-lg font-strong">Recorded transcript</h2>
      <p>
        Frozen at {view.freeze.frozenAt}.{' '}
        {view.freeze.completeness === 'incomplete'
          ? 'Some recorded coverage is missing. Judge only the evidence available.'
          : 'Recorded coverage is complete.'}
      </p>
      {view.freeze.utterances.length ? (
        <ol className="flex flex-col gap-3">
          {view.freeze.utterances.map((line) => (
            <li key={line.id}>
              <p className="font-strong">
                {view.round.rules.segments[line.segmentSequence]?.label}
              </p>
              <p className="whitespace-pre-wrap">{line.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>No recorded speech text is available.</p>
      )}
    </section>
  );
}
