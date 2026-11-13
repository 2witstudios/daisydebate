import type {
  StageSeatView,
  StageSnapshot,
} from '../../features/stage-capture/stage-access';
import { DaisyMark } from '../components/daisy-mark/daisy-mark';
import { remaining } from './stage-clock';

type Waiting = Exclude<StageSnapshot, { readonly phase: 'speech' }>;

type SlateFacts = {
  readonly headline: string;
  readonly endsAt: string | null;
  readonly next: string | null;
  readonly mark: boolean;
};

const slateFacts = (snapshot: Waiting): SlateFacts => {
  const none = { endsAt: null, next: null, mark: false };
  switch (snapshot.phase) {
    case 'prep':
      return { ...none, headline: 'Preparation', endsAt: snapshot.endsAt };
    case 'between':
      return {
        ...none,
        headline: 'Next speech soon',
        endsAt: snapshot.endsAt,
        next: snapshot.next.label,
      };
    case 'judging':
      return { ...none, headline: 'Judges are deciding' };
    case 'slate':
      return { ...none, headline: 'Starting soon', mark: true };
  }
};

const namesOf = (
  seats: readonly StageSeatView[],
  side: StageSeatView['side'],
) =>
  seats
    .filter((seat) => seat.side === side)
    .map((seat) => seat.label)
    .join(' · ');

/**
 * The frame outside a speech: what the Round is waiting for, how long when it has a
 * deadline, and who is debating. Appearance only; the observer's revocation is what
 * keeps a private phase private.
 */
export function StageSlate(props: {
  readonly snapshot: Waiting;
  readonly nowMs: number;
}) {
  const { snapshot } = props;
  const facts = slateFacts(snapshot);
  const sides = (
    [
      ['Affirmative', namesOf(snapshot.seats, 'affirmative')],
      ['Negative', namesOf(snapshot.seats, 'negative')],
    ] as const
  ).filter(([, names]) => names !== '');
  return (
    <section
      className="broadcast-stage-slate"
      data-clock={facts.endsAt !== null}
    >
      {facts.mark ? <DaisyMark size={112} variant="reverse" /> : null}
      <h1>{facts.headline}</h1>
      {facts.endsAt === null ? null : (
        <strong>{remaining(facts.endsAt, props.nowMs)}</strong>
      )}
      {facts.next === null ? null : <p>Next: {facts.next}</p>}
      <dl>
        {sides.map(([side, names]) => (
          <div key={side}>
            <dt>{side}</dt>
            <dd>{names}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
