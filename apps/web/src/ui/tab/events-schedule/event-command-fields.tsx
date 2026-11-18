import type { SetupEvent } from '@daisy/protocol/lobby/lobby-setup-read';
import type { HostEventsView } from '@daisy/protocol/lobby/host-events-read';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
export function EventMetadataFields({
  event,
  pins,
}: {
  readonly event: SetupEvent | null;
  readonly pins: HostEventsView['pinOptions'];
}) {
  return (
    <>
      <label className={fieldClass}>
        <span className={labelClass}>Event name</span>
        <input
          className={controlClass}
          name="name"
          defaultValue={event?.name ?? ''}
          maxLength={200}
          required
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Short label</span>
        <input
          className={controlClass}
          name="label"
          defaultValue={event?.label ?? ''}
          maxLength={12}
        />
      </label>
      {event ? (
        <p className="text-sm">
          {event.format.name}
          {event.template ? ` · follows ${event.template.name}` : ''}
        </p>
      ) : (
        <>
          <label className={fieldClass}>
            <span className={labelClass}>Format or template</span>
            <select className={controlClass} name="pin" required>
              <option value="">Choose a format or template</option>
              {pins.map((pin) => (
                <option key={pin.key} value={pin.key}>
                  {pin.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldClass}>
            <span className={labelClass}>Entry</span>
            <select className={controlClass} name="entryKind">
              <option value="person">Person</option>
              <option value="team">Team</option>
            </select>
          </label>
          <label className={fieldClass}>
            <span className={labelClass}>People per team</span>
            <input
              className={controlClass}
              type="number"
              name="teamSize"
              min={2}
              max={8}
              defaultValue={2}
            />
          </label>
        </>
      )}
    </>
  );
}
export function StageFields() {
  return (
    <>
      <label className={fieldClass}>
        <span className={labelClass}>Stage</span>
        <select name="stageKind" className={controlClass}>
          <option value="preliminary">Preliminary</option>
          <option value="elimination">Elimination</option>
        </select>
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Place</span>
        <select name="place" className={controlClass}>
          <option value="online">Online</option>
          <option value="in_person">In person</option>
        </select>
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Timing</span>
        <select name="timing" className={controlClass}>
          <option value="live">Live time slots</option>
          <option value="windowed">Windowed</option>
        </select>
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Opens at (UTC, windowed only)</span>
        <input type="datetime-local" className={controlClass} name="opensAt" />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Closes at (UTC, windowed only)</span>
        <input type="datetime-local" className={controlClass} name="closesAt" />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Division (elimination only)</span>
        <input className={controlClass} name="division" maxLength={200} />
      </label>
    </>
  );
}
export function RoundFields({
  name,
  selected,
  choices,
}: {
  readonly name: string | null;
  readonly selected: string;
  readonly choices: HostEventsView['resolutionChoices'];
}) {
  return (
    <>
      <label className={fieldClass}>
        <span className={labelClass}>Round name (optional)</span>
        <input
          className={controlClass}
          name="name"
          maxLength={200}
          defaultValue={name ?? ''}
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Resolution source</span>
        <select
          className={controlClass}
          name="resolution"
          defaultValue={selected}
        >
          <option value="">None</option>
          {choices.map((choice) => (
            <option key={choice.key} value={choice.key}>
              {choice.label} ·{' '}
              {choice.wording === null
                ? 'Room draw'
                : choice.wording.kind === 'shown'
                  ? choice.wording.text
                  : `wording withheld · added ${choice.wording.addedAt}`}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
export function SlotFields({
  name,
  startsAt,
}: {
  readonly name: string;
  readonly startsAt: string;
}) {
  return (
    <>
      <label className={fieldClass}>
        <span className={labelClass}>Time slot name</span>
        <input
          className={controlClass}
          name="name"
          maxLength={200}
          required
          defaultValue={name}
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Starts at (UTC)</span>
        <input
          className={controlClass}
          name="startsAt"
          type="datetime-local"
          required
          step="0.001"
          defaultValue={startsAt.replace(/Z$/, '')}
        />
      </label>
    </>
  );
}
export function ResolutionFields({
  pools,
}: {
  readonly pools: HostEventsView['setup']['resolutionPools'];
}) {
  return (
    <>
      <label className={fieldClass}>
        <span className={labelClass}>Pool</span>
        <select className={controlClass} name="poolId">
          <option value="">New pool</option>
          {pools.map((pool) => (
            <option key={pool.resolutionPoolId} value={pool.resolutionPoolId}>
              {pool.name}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>New pool name</span>
        <input className={controlClass} name="poolName" maxLength={200} />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Resolution</span>
        <textarea
          className={controlClass}
          name="text"
          required
          maxLength={300}
        />
      </label>
    </>
  );
}
