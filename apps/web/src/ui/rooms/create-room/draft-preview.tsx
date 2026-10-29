import type { CreateRoomDraft } from '../../../features/rooms/create-room-draft';
import { clockDuration } from '../../../features/rooms/duration-input';
import { shapeLabel } from '../../../features/debate-room/vocabulary';

export function DraftPreview({
  draft,
  title,
}: {
  readonly draft: CreateRoomDraft;
  readonly title: string;
}) {
  const { config, definition } = draft;
  const durations = definition.segments.map(
    (segment) =>
      config.speechTiming.segmentDurationOverrides[segment.key] ??
      segment.defaultDurationMs,
  );
  const before = config.preRoundPrep.enabled
    ? config.preRoundPrep.durationMs
    : 0;
  const during = config.inRoundPrep.enabled
    ? config.inRoundPrep.budgetMsPerSide
    : 0;
  const countdowns =
    definition.segments.length * config.speechTiming.countdownMs;
  const total = durations.reduce(
    (sum, duration) => sum + duration,
    before + 2 * during + countdowns,
  );
  return (
    <aside className="create-room-preview" aria-label="Room preview">
      <span className="create-room-eyebrow">Your room</span>
      <div className="create-room-preview-stage">
        <span className="create-room-eyebrow">
          {draft.ranked ? 'Ranked' : 'Unranked'} ·{' '}
          {draft.custom ? 'Custom' : draft.basis.label}
        </span>
        <h2>{title || 'Your next debate'}</h2>
        <p>
          {draft.resolutionMethod === 'strike'
            ? 'Resolution by strike'
            : draft.resolutionMethod === 'custom'
              ? 'Custom resolution'
              : draft.resolutionMethod === 'policy'
                ? 'Policy res'
                : 'Value res'}
        </p>
        {draft.custom ? <p>Based on {draft.basis.label}</p> : null}
      </div>
      <div className="create-room-preview-stats">
        <div>
          <strong>{shapeLabel(definition.seats)}</strong>
          <span>Debaters</span>
        </div>
        <div>
          <strong>{Math.round(total / 60_000)} min</strong>
          <span>Scheduled time</span>
        </div>
      </div>
      <details className="create-room-preview-schedule" open>
        <summary>Round at a glance</summary>
        <dl>
          {before > 0 ? (
            <div>
              <dt>Prep before the round</dt>
              <dd>{clockDuration(before)}</dd>
            </div>
          ) : null}
          {definition.segments.map((segment, index) => (
            <div key={segment.key}>
              <dt>{segment.label}</dt>
              <dd>{clockDuration(durations[index]!)}</dd>
            </div>
          ))}
          <div className="create-room-preview-total">
            <dt>Prep during play</dt>
            <dd>{clockDuration(during)} / side</dd>
          </div>
          <div>
            <dt>Countdowns</dt>
            <dd>{clockDuration(countdowns)}</dd>
          </div>
          <div>
            <dt>Scheduled total</dt>
            <dd>{clockDuration(total)}</dd>
          </div>
        </dl>
      </details>
      {draft.resolutionMethod === 'strike' ? (
        <p className="create-room-preview-note">Strike time is additional.</p>
      ) : null}
    </aside>
  );
}
