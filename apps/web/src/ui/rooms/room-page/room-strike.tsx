import { isNamedSeat, type RoomView } from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { countdownClock } from '../../../features/rooms/duration-input';
import {
  resolutionCategoryLabel,
  strikeLabel,
} from '../../../features/debate-room/vocabulary';
import type { FormAction } from '../../form-action/form-action';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { StrikeSubmit } from './room-strike-confirm';

type Draw = NonNullable<RoomView['resolutionDraw']>;
export type Side = 'affirmative' | 'negative';

const sideWord: Readonly<Record<Side, string>> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
};

/** The debater on a side, by name, or the side's own word. */
export const nameOf = (view: RoomView, side: Side) =>
  view.participants
    .filter(isNamedSeat)
    .filter((seat) => seat.role === side)
    .map((seat) => seat.label)
    .join(' and ') || sideWord[side];

export const viewerSideOf = (view: RoomView, actorId: string): Side | null => {
  const seat = view.participants
    .filter(isNamedSeat)
    .find((p) => p.actorId === actorId);
  return seat && seat.role !== 'judge' ? seat.role : null;
};

/** The turn's time left as presented: the read's own count, ticking down from it. */
function Countdown({
  draw,
  mine,
}: {
  readonly draw: Draw;
  readonly mine: boolean;
}) {
  if (!draw.turn) return null;
  const left = draw.turn.remainingMs;
  return (
    <p
      role="timer"
      aria-label="Time left for this strike"
      className={`flex flex-col items-center rounded-xl px-3 py-2 ${mine ? 'bg-hue-clay-soft text-hue-clay' : 'bg-surface-sunken text-ink-muted'}`}
    >
      <span className="text-xs font-semibold">
        {mine ? 'Your time' : 'Their time'}
      </span>
      <span className="font-display text-3xl font-semibold tabular-nums">
        {countdownClock(left)}
      </span>
    </p>
  );
}

/** Strike progress for everyone who may not see the drawn texts. */
function Progress({
  draw,
  view,
}: {
  readonly draw: Draw;
  readonly view: RoomView;
}) {
  const config = view.config.resolutionDraw;
  const first: Side = config.enabled ? config.firstStriker : 'negative';
  const sideOf = (ordinal: number): Side =>
    ordinal % 2 === 0
      ? first
      : first === 'negative'
        ? 'affirmative'
        : 'negative';
  return (
    <ol aria-label="Strike progress" className="flex flex-wrap gap-2">
      {Array.from({ length: draw.drawSize - 1 }, (_, ordinal) => {
        const done = draw.strikes.some((s) => s.ordinal === ordinal);
        const current = draw.turn?.ordinal === ordinal;
        const state = done ? 'done' : current ? 'now' : 'to come';
        return (
          <li
            key={ordinal}
            className={`rounded-lg px-3 py-2 text-sm ${done ? 'bg-hue-teal-soft' : current ? 'border-2 border-hue-clay' : 'border border-dashed border-border-strong text-ink-muted'}`}
          >
            <span className="block font-semibold">Strike {ordinal + 1}</span>
            {nameOf(view, sideOf(ordinal))} · {state}
          </li>
        );
      })}
    </ol>
  );
}

/** The panel's heading and explanation, by who is looking and whose turn it is. */
const strikeCopy = (view: RoomView, draw: Draw, mine: boolean) => {
  const ordinal = Math.min(draw.strikes.length + 1, draw.drawSize - 1);
  if (draw.visibility === 'progress')
    return {
      ordinal,
      title: 'Hidden until the debaters finish striking',
      lede: `The debaters are striking from ${draw.drawSize} resolutions Daisy drew. You’ll see the one they debate when the last strike is made.`,
    };
  const title = !draw.turn
    ? 'The resolution is chosen'
    : mine
      ? 'Your turn: strike a resolution you don’t want to debate'
      : `${nameOf(view, draw.turn.side)} is striking…`;
  return {
    ordinal,
    title,
    lede: `Daisy drew ${draw.drawSize} resolutions. You and your opponent take turns striking one you don’t want to debate. The last one left is the resolution for this round.`,
  };
};

/**
 * The pre-round resolution strike (FMT-7): seated debaters see the drawn
 * resolutions and strike on their turn; everyone else sees progress only.
 * The radio list and the Strike button are one native form, so it works
 * without JavaScript; the submit button is the confirmation.
 */
export function RoomStrike({
  view,
  actorId,
  action,
  strikeIds,
}: {
  readonly view: RoomView;
  readonly actorId: string;
  readonly action: FormAction<RoomFormState>;
  readonly strikeIds: readonly string[];
}) {
  const draw = view.resolutionDraw;
  if (!draw || draw.revealedAt) return null;
  const viewerSide = viewerSideOf(view, actorId);
  const mine = Boolean(draw.turn && draw.turn.side === viewerSide);
  const copy = strikeCopy(view, draw, mine);
  return (
    <section
      aria-labelledby="room-strike-title"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">
            Choose the resolution · Strike {copy.ordinal} of {draw.drawSize - 1}
          </p>
          <h2
            id="room-strike-title"
            className="font-display text-2xl font-semibold"
          >
            {copy.title}
          </h2>
          <p className="text-sm text-ink-muted">{copy.lede}</p>
        </div>
        <Countdown draw={draw} mine={mine} />
      </div>
      {draw.visibility === 'progress' ? (
        <Progress draw={draw} view={view} />
      ) : (
        <StrikeForm
          draw={draw}
          view={view}
          viewerSide={viewerSide}
          action={action}
          commandId={strikeIds[draw.turn?.ordinal ?? 0] ?? ''}
        />
      )}
      {/* The room itself, never the refused post's notice, so a refresh reads fresh. */}
      <a href={`/rooms/${view.id}`} className="self-start text-sm font-strong">
        Refresh
      </a>
    </section>
  );
}

function StrikeForm({
  draw,
  view,
  viewerSide,
  action,
  commandId,
}: {
  readonly draw: Extract<Draw, { visibility: 'debater' }>;
  readonly view: RoomView;
  readonly viewerSide: Side | null;
  readonly action: FormAction<RoomFormState>;
  readonly commandId: string;
}) {
  const canStrike = view.capabilities.canStrike && draw.turn !== null;
  return (
    <AssemblyCommandForm action={action} className="flex flex-col gap-3">
      {AssemblyCommandFields({
        type: 'strike-resolution',
        version: view.version,
        commandId,
      })}
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
              className={`flex min-h-room-target items-start gap-3 rounded-lg p-4 ${struck ? 'bg-surface-sunken' : 'border border-border bg-surface has-checked:border-2 has-checked:border-hue-clay'}`}
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
                    <span className="rounded-full bg-surface-sunken px-2 py-1 text-xs font-bold tracking-wide text-ink-muted uppercase">
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
                  className={`text-base leading-tight wrap-anywhere ${struck ? 'text-ink-muted line-through' : 'font-strong'}`}
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
    </AssemblyCommandForm>
  );
}
