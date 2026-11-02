import { isNamedSeat, type DebateSide, type RoundView } from '@daisy/protocol';
import { sideName } from '../../features/round-runtime/round-reading';
import { countdownClock } from '../../features/rooms/duration-input';
import {
  resolutionCategoryLabel,
  strikeLabel,
} from '../../features/debate-room/vocabulary';
import { buttonClass } from '../components/button/button-class';
import { StrikeSubmit } from './strike-submit';

type Opening = NonNullable<RoundView['opening']>;
type Draw = NonNullable<Opening['draw']>;
/** The debater on a side, by name, or the side's own word. */
const nameOf = (view: RoundView, side: DebateSide) =>
  view.participants
    .filter(isNamedSeat)
    .filter((seat) => seat.role === side)
    .map((seat) => seat.label)
    .join(' and ') || sideName[side];

const viewerSideOf = (view: RoundView, actorId: string): DebateSide | null => {
  const seat = view.participants
    .filter(isNamedSeat)
    .find((p) => p.actorId === actorId);
  return seat && seat.role !== 'judge' ? seat.role : null;
};

/** The turn's time left, counted from its own due instant. */
function Countdown({
  draw,
  mine,
  nowMs,
}: {
  readonly draw: Draw;
  readonly mine: boolean;
  readonly nowMs: number;
}) {
  if (!draw.turn) return null;
  return (
    <p
      role="timer"
      aria-label="Time left for this strike"
      className={`flex flex-col items-center rounded-xl px-3 py-2 ${mine ? 'bg-hue-clay-soft text-hue-clay' : 'bg-surface-sunken'}`}
    >
      <span className="text-xs font-semibold">
        {mine ? 'Your time' : 'Their time'}
      </span>
      <span className="font-display text-3xl font-semibold tabular-nums">
        {countdownClock(Math.max(0, Date.parse(draw.turn.dueAt) - nowMs))}
      </span>
    </p>
  );
}

/** Strike progress for everyone who may not see the drawn texts. */
export function OpeningProgress({
  draw,
  view,
}: {
  readonly draw: Draw;
  readonly view: RoundView;
}) {
  return (
    <ol aria-label="Strike progress" className="flex flex-wrap gap-2">
      {Array.from({ length: draw.drawSize - 1 }, (_, ordinal) => {
        const struck = draw.strikes.find((s) => s.ordinal === ordinal);
        const done = struck !== undefined;
        const current = draw.turn?.ordinal === ordinal;
        const side = struck?.side ?? (current ? draw.turn?.side : undefined);
        const state = done ? 'done' : current ? 'now' : 'to come';
        return (
          <li
            key={ordinal}
            className={`rounded-lg px-3 py-2 text-sm ${done ? 'bg-hue-teal-soft' : current ? 'bg-hue-clay-soft' : 'bg-surface-sunken'}`}
          >
            <span className="block font-semibold">Strike {ordinal + 1}</span>
            {side ? `${nameOf(view, side)} · ` : ''}
            {state}
          </li>
        );
      })}
    </ol>
  );
}

function StrikeForm({
  draw,
  view,
  opening,
  viewerSide,
  participantId,
  commandId,
  post,
  pending,
}: {
  readonly draw: Extract<Draw, { visibility: 'debater' }>;
  readonly view: RoundView;
  readonly opening: Opening;
  readonly viewerSide: DebateSide | null;
  readonly participantId: string;
  readonly commandId: string;
  readonly post: (form: FormData) => void;
  readonly pending: boolean;
}) {
  const canStrike = opening.canStrike && draw.turn !== null;
  return (
    <form action={post} aria-busy={pending} className="flex flex-col gap-3">
      <input type="hidden" name="version" value="1" />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="expectedVersion" value={view.version} />
      <input type="hidden" name="type" value="strike_resolution" />
      <input type="hidden" name="participantId" value={participantId} />
      <input
        type="hidden"
        name="ordinal"
        value={String(draw.turn?.ordinal ?? draw.strikes.length)}
      />
      <fieldset className="flex w-full flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">
          {canStrike ? 'Pick one to strike' : 'The drawn resolutions'}
        </legend>
        {draw.items.map((item) => {
          const struck = draw.strikes.find((s) => s.position === item.position);
          return (
            <label
              key={item.position}
              className={`flex min-h-room-target items-start gap-3 rounded-lg p-4 ${struck ? 'bg-surface-sunken' : 'border border-border bg-surface'}`}
            >
              <input
                type="radio"
                name="position"
                value={String(item.position)}
                required
                disabled={!canStrike || Boolean(struck)}
                className="mt-1 size-5 shrink-0 accent-hue-clay"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  {item.category ? (
                    <span className="rounded-full bg-surface-sunken px-2 py-1 text-xs font-bold">
                      {resolutionCategoryLabel[item.category]}
                    </span>
                  ) : null}
                  {struck ? (
                    <span className="text-sm font-semibold text-hue-clay">
                      {strikeLabel(struck, viewerSide, (side) =>
                        nameOf(view, side),
                      )}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`text-base leading-tight wrap-anywhere ${struck ? 'text-ink-muted line-through' : ''}`}
                >
                  {item.text}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {canStrike ? (
        <StrikeSubmit
          texts={Object.fromEntries(
            draw.items.map((item) => [String(item.position), item.text]),
          )}
        />
      ) : null}
    </form>
  );
}

/**
 * The opening's strike (ADR 0098): the resolutions and nothing else. A native
 * form, so it works without JavaScript; a strike can't be undone, so the
 * submit asks once more with it.
 */
export function OpeningStrike({
  view,
  opening,
  draw,
  actorId,
  nowMs,
  commandId,
  post,
  pending,
}: {
  readonly view: RoundView;
  readonly opening: Opening;
  readonly draw: Draw;
  readonly actorId: string;
  readonly nowMs: number;
  readonly commandId: string;
  readonly post: (form: FormData) => void;
  readonly pending: boolean;
}) {
  const viewerSide = viewerSideOf(view, actorId);
  const mine = Boolean(draw.turn && draw.turn.side === viewerSide);
  const participantId =
    view.participants.filter(isNamedSeat).find((p) => p.actorId === actorId)
      ?.id ?? '';
  const ordinal = Math.min(draw.strikes.length + 1, draw.drawSize - 1);
  const title = !draw.turn
    ? 'The resolution is chosen'
    : mine
      ? 'Your strike'
      : `${nameOf(view, draw.turn.side)} is striking`;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-reading flex-col gap-4 p-4">
      <section
        aria-labelledby="opening-strike-title"
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">
              Strike {ordinal} of {draw.drawSize - 1}
            </p>
            <h1
              id="opening-strike-title"
              className="font-display text-2xl font-semibold"
            >
              {title}
            </h1>
          </div>
          <Countdown draw={draw} mine={mine} nowMs={nowMs} />
        </div>
        {draw.visibility === 'debater' ? (
          <StrikeForm
            draw={draw}
            view={view}
            opening={opening}
            viewerSide={viewerSide}
            participantId={participantId}
            commandId={commandId}
            post={post}
            pending={pending}
          />
        ) : (
          <OpeningProgress draw={draw} view={view} />
        )}
        <a
          href={`/rounds/${view.id}/room`}
          className={`${buttonClass('secondary')} self-start`}
        >
          Refresh
        </a>
      </section>
    </main>
  );
}

/** A debater's record of how the resolution was chosen, kept through prep. */
export function OpeningChosen({
  view,
  draw,
  actorId,
}: {
  readonly view: RoundView;
  readonly draw: Draw;
  readonly actorId: string;
}) {
  if (!draw.revealedAt || draw.visibility !== 'debater') return null;
  const viewerSide = viewerSideOf(view, actorId);
  const struckAt = new Map(draw.strikes.map((s) => [s.position, s]));
  const ordered = [...draw.items].sort(
    (a, b) =>
      (struckAt.get(a.position)?.ordinal ?? Infinity) -
      (struckAt.get(b.position)?.ordinal ?? Infinity),
  );
  return (
    <details className="px-4 py-1 text-sm">
      <summary className="min-h-room-target cursor-pointer font-strong">
        How it was chosen
      </summary>
      <ol className="mt-2 flex flex-col gap-2">
        {ordered.map((item) => {
          const strike = struckAt.get(item.position);
          return (
            <li key={item.position} className="flex flex-col gap-1">
              <span
                className={
                  strike ? 'text-ink-muted line-through' : 'font-strong'
                }
              >
                {item.text}
              </span>
              <span className="text-xs text-ink-muted">
                {strike
                  ? strikeLabel(strike, viewerSide, (side) =>
                      nameOf(view, side),
                    )
                  : 'Debated'}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Where the opening stands, for a judge or a spectator: no drawn text reaches them. */
export function OpeningStatus({
  view,
  nowMs,
}: {
  readonly view: RoundView;
  readonly nowMs: number;
}) {
  const { opening } = view;
  if (!opening) return null;
  const { step, draw } = opening;
  if (step.step === 'strike' && draw)
    return <OpeningProgress draw={draw} view={view} />;
  if (step.step === 'prep')
    return (
      <p role="timer" aria-label="Prep before the round">
        Prep ·{' '}
        <span className="tabular-nums">
          {countdownClock(Math.max(0, Date.parse(step.endsAt) - nowMs))}
        </span>
      </p>
    );
  return null;
}
