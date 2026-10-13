import {
  floorStates,
  liveCaptions,
  voiceBars,
} from '../../features/debate-room/stage';
import { cn } from '../cn';
import type { RoundSnapshot } from './round';
import { band, discLook, sideName, type StageProps } from './stage';

const meterHeights = ['h-1', 'h-2', 'h-3', 'h-4', 'h-5', 'h-6'] as const;

/** The bot's initial, name, level and side, and its voice level meter. */
function PersonaCard({
  round,
  compact,
  speaking,
}: {
  readonly round: RoundSnapshot;
  readonly compact: boolean;
  readonly speaking: boolean;
}) {
  const bot = round.opponent;
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-3 rounded-xl bg-surface-raised px-4 max-narrow:w-full max-narrow:flex-row max-narrow:py-2',
        compact ? 'flex-row' : 'w-room-persona flex-col justify-center',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-round bg-hue-plum font-display text-background max-narrow:size-room-disc-sm max-narrow:text-md',
          compact ? discLook.small : discLook.large,
          speaking && 'ring-4 ring-hue-plum-soft',
        )}
      >
        {bot.initials}
      </span>
      <div
        className={cn(
          'min-w-0 max-narrow:text-left',
          !compact && 'text-center',
        )}
      >
        <p
          className={cn(
            'm-0 font-display max-narrow:text-md',
            compact ? 'text-md' : 'text-xl',
          )}
        >
          {bot.name}
        </p>
        <p className="m-0 text-sm text-ink-muted">
          {['Bot', bot.bot?.level, sideName[bot.side]]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <span
        role="meter"
        aria-label="Voice level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, round.voiceLevel) * 100)}
        className="flex h-6 items-center gap-1 max-narrow:ml-auto"
      >
        {voiceBars(round.voiceLevel).map((step, index) => (
          <span
            key={index}
            className={cn(
              'w-1 rounded-round bg-hue-plum',
              meterHeights[step - 1],
            )}
          />
        ))}
      </span>
    </div>
  );
}

/** The live speech's latest lines, read out as they arrive. */
function Captions({
  round,
  compact,
}: {
  readonly round: RoundSnapshot;
  readonly compact: boolean;
}) {
  const captions = liveCaptions(
    round.transcript,
    round.speeches[round.liveIndex]?.id ?? null,
  );
  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Live captions"
      className={cn(
        'flex min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-xl bg-surface-raised max-narrow:p-3 max-narrow:text-md',
        compact
          ? 'gap-2 px-4 py-2 text-md'
          : 'gap-3 p-6 text-xl leading-normal',
      )}
    >
      {captions.map((line, index) => (
        <p
          key={line.id}
          className={cn('m-0', index < captions.length - 1 && 'text-ink-faint')}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}

/**
 * A bot has no camera: its persona card, a level meter from its voice and
 * live captions stand in for its tile (owner decision 6).
 */
export function BotStage({ round, preset }: StageProps) {
  const state = floorStates(round.phase).opponent;
  const name = round.opponent.name;
  const compact = preset === 'focus';
  return (
    <section
      aria-label={state ? `${name}, ${state.toLowerCase()}` : name}
      className={cn(band, 'max-narrow:flex-col')}
    >
      <PersonaCard round={round} compact={compact} speaking={state !== ''} />
      <Captions round={round} compact={compact} />
    </section>
  );
}
