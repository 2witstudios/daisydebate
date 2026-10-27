import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import { controlClass } from '../../components/form-field/form-field-class';
import { DurationField, PrepToggle } from './assembly-settings-controls';

/**
 * The Resolution strike fieldset (FMT-7): source, how many are drawn, who
 * strikes first and the time per strike. A host list is the author's own
 * text. Turning the strike off asks for the resolution the room debates.
 */
export function DrawFields({
  view,
  state,
  disabled,
}: {
  readonly view: RoomView;
  readonly state: MockFormState;
  readonly disabled: boolean;
}) {
  const capability = view.definition.configurable.resolutionDraw;
  if (!capability) return null;
  const draw = view.config.resolutionDraw;
  const value = (name: string, fallback: string) =>
    state.error ? (state.values[name] ?? fallback) : fallback;
  const source = value(
    'drawSource',
    draw.enabled ? draw.source.kind : capability.sources[0]!,
  );
  const sizes = Array.from(
    { length: capability.drawSize.max - capability.drawSize.min + 1 },
    (_, i) => capability.drawSize.min + i,
  );
  return (
    <PrepToggle
      name="resolutionDraw"
      label="Resolution strike"
      hint="Before the round, the debaters take turns striking resolutions until one is left. It stays hidden from everyone else until then."
      checked={draw.enabled}
      state={state}
      disabled={disabled}
    >
      <div className="flex flex-col gap-3">
        <SourceFields
          sources={capability.sources}
          source={source}
          hostList={value(
            'drawResolutions',
            (view.authoredDrawSource?.resolutions ?? []).join('\n'),
          )}
          disabled={disabled}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-strong">Resolutions drawn</span>
          <select
            name="drawSize"
            disabled={disabled}
            defaultValue={value(
              'drawSize',
              String(
                draw.enabled
                  ? draw.drawSize
                  : sizes.at(Math.floor(sizes.length / 2)),
              ),
            )}
            className={controlClass}
          >
            {sizes.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-strong">Strikes first</span>
          <select
            name="drawFirstStriker"
            disabled={disabled}
            defaultValue={value(
              'drawFirstStriker',
              draw.enabled ? draw.firstStriker : capability.firstStrikers[0]!,
            )}
            className={controlClass}
          >
            {capability.firstStrikers.map((side) => (
              <option key={side} value={side}>
                {side === 'negative' ? 'Negative' : 'Affirmative'}
              </option>
            ))}
          </select>
        </label>
        <DurationField
          name="strikeWindow"
          label="Time per strike"
          hint="If time runs out, Daisy strikes the first one still in the draw."
          ms={draw.enabled ? draw.strikeWindowMs : 60_000}
          min={capability.strikeWindowMs.min}
          max={capability.strikeWindowMs.max}
          state={state}
          disabled={disabled}
        />
        {draw.enabled ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-strong">Resolution without a strike</span>
            <span className="text-xs text-ink-muted">
              Needed only if you turn the strike off.
            </span>
            <input
              name="drawTopic"
              autoComplete="off"
              disabled={disabled}
              defaultValue={value('drawTopic', '')}
              className={controlClass}
            />
          </label>
        ) : null}
      </div>
    </PrepToggle>
  );
}

/** Where the drawn resolutions come from, and the host's own list. */
function SourceFields({
  sources,
  source,
  hostList,
  disabled,
}: {
  readonly sources: readonly ('bank' | 'host')[];
  readonly source: string;
  readonly hostList: string;
  readonly disabled: boolean;
}) {
  return (
    <>
      {sources.length > 1 ? (
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-strong">
            Resolutions come from
          </legend>
          {sources.map((kind) => (
            <label key={kind} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="drawSource"
                value={kind}
                defaultChecked={source === kind}
                disabled={disabled}
                className="mt-1 size-4 shrink-0"
              />
              <span>
                {kind === 'bank' ? 'Daisy’s resolution bank' : 'My own list'}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <input type="hidden" name="drawSource" value={source} />
      )}
      {sources.includes('host') ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-strong">Your resolutions, one per line</span>
          <textarea
            name="drawResolutions"
            rows={4}
            disabled={disabled}
            defaultValue={hostList}
            className={controlClass}
          />
        </label>
      ) : null}
    </>
  );
}
