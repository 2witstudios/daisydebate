import type { DebateSide } from '@daisy/protocol';
import type { ReactNode } from 'react';
import type { Bot } from '../../../features/train/bots';
import type {
  AiDebateView,
  UiState,
} from '../../../features/ai-debate/context';
import { segmentAt } from '../../../features/ai-debate/context';
import { BotPortrait } from '../../components/bot-portrait/bot-portrait';
import { cn } from '../../cn';
import { sideName } from './parts';

/** Who holds the floor: the speaker, or in cross-examination the asker. */
function floorOf(state: UiState, view: AiDebateView, personSide: DebateSide) {
  if (state.phase !== 'live') return null;
  return segmentAt(view, state.segmentIndex).side === personSide
    ? 'person'
    : 'ai';
}

/** Microphone level steps for the four meter bars (RMS, 0..1). */
const BARS = [
  { at: 0.01, height: 'h-2' },
  { at: 0.03, height: 'h-3' },
  { at: 0.06, height: 'h-4' },
  { at: 0.1, height: 'h-5' },
] as const;

function Meter({ level }: { readonly level: number }) {
  return (
    <span aria-hidden="true" className="flex h-5 items-end gap-px">
      {BARS.map((bar) => (
        <span
          key={bar.at}
          className={cn(
            'w-1 rounded-round bg-stage-accent transition-opacity',
            bar.height,
            level >= bar.at ? 'opacity-100' : 'opacity-25',
          )}
        />
      ))}
    </span>
  );
}

function Tile({
  name,
  side,
  onFloor,
  corner,
  children,
}: {
  readonly name: string;
  readonly side: DebateSide;
  readonly onFloor: boolean;
  readonly corner?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <li
      aria-current={onFloor ? 'true' : undefined}
      className={cn(
        'relative room-video-tile overflow-hidden rounded-md bg-surface-stage transition-shadow',
        onFloor && 'ring-2 ring-stage-accent',
      )}
    >
      {children}
      <span className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-scrim/70 px-2 py-1 text-sm text-stage-ink">
        <span className="font-strong">{name}</span>
        <span className="text-stage-ink-muted">{sideName(side)}</span>
      </span>
      {corner ? (
        <span className="absolute right-3 bottom-3 rounded-md bg-scrim/70 px-2 py-1">
          {corner}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The two debaters as video tiles, the way a live round looks: the bot's
 * portrait (its mouth moves while it talks) and you, with your microphone
 * level. Whoever holds the floor is outlined. There is no video yet; the
 * tiles keep its place.
 */
export function Stage({
  bot,
  personSide,
  view,
  state,
  speaking,
  level,
  listening,
}: {
  readonly bot: Bot;
  readonly personSide: DebateSide;
  readonly view: AiDebateView;
  readonly state: UiState;
  readonly speaking: boolean;
  readonly level: number;
  /** The microphone is open. */
  readonly listening: boolean;
}) {
  const floor = floorOf(state, view, personSide);
  const aiSide = personSide === 'affirmative' ? 'negative' : 'affirmative';
  return (
    <ul
      aria-label="Debaters"
      className="flex justify-center gap-2 border-b border-border bg-surface-sunken p-2"
    >
      <Tile name={bot.name} side={aiSide} onFloor={floor === 'ai'}>
        {/* Its own backdrop, blurred across the tile like a call's background. */}
        <span aria-hidden="true" className="absolute inset-0 video-backdrop">
          <BotPortrait id={`${bot.id}-backdrop`} look={bot.look} />
        </span>
        <span className="absolute inset-x-0 top-6 bottom-0">
          <BotPortrait
            id={bot.id}
            look={bot.look}
            speaking={speaking}
            label={`${bot.name}, ${bot.tagline}`}
          />
        </span>
      </Tile>
      <Tile
        name="You"
        side={personSide}
        onFloor={floor === 'person'}
        corner={listening ? <Meter level={level} /> : null}
      >
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              'flex size-16 items-center justify-center rounded-round bg-stage-accent font-display text-xl font-bold text-stage-accent-ink transition-shadow',
              listening && level >= BARS[1].at && 'ring-4 ring-stage-accent/40',
            )}
          >
            You
          </span>
        </span>
      </Tile>
    </ul>
  );
}
