import type { CreateRoomDraft } from '../../../features/rooms/create-room-draft';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';

type Props = {
  readonly draft: CreateRoomDraft;
  readonly values: Readonly<Record<string, string>>;
  readonly change: (name: string, value: string) => void;
  readonly schedule: (intent: string) => void;
};

function DurationField({
  name,
  label,
  values,
  change,
}: Pick<Props, 'values' | 'change'> & {
  readonly name: string;
  readonly label: string;
}) {
  return (
    <label className="create-room-field">
      <span>{label}</span>
      <input
        className={controlClass}
        name={`duration.${name}`}
        value={values[`duration.${name}`] ?? ''}
        onChange={(event) => change(`duration.${name}`, event.target.value)}
        inputMode="decimal"
        pattern="[0-9]{1,6}:[0-5][0-9](\.[0-9]{1,3})?"
        placeholder="m:ss"
        required
        aria-label={`${label}, minutes and seconds`}
      />
    </label>
  );
}

function ScheduleButton({
  intent,
  label,
  disabled = false,
  schedule,
}: {
  readonly intent: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly schedule: Props['schedule'];
}) {
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      formNoValidate
      disabled={disabled}
      aria-label={label}
      className={buttonClass('secondary')}
      onClick={(event) => {
        event.preventDefault();
        schedule(intent);
      }}
    >
      {intent.startsWith('up:')
        ? '↑'
        : intent.startsWith('down:')
          ? '↓'
          : intent.startsWith('remove:')
            ? 'Remove'
            : label}
    </button>
  );
}

function SpeechRow({ index, ...props }: Props & { readonly index: number }) {
  const { draft, values, change, schedule } = props;
  const segment = draft.definition.segments[index]!;
  const field = (key: string) => `segment.${index}.${key}`;
  const side = values[field('side')] ?? segment.side;
  const sameSide = draft.definition.segments.filter(
    (item) => item.side === segment.side,
  ).length;
  return (
    <div className="create-room-speech">
      <input
        type="hidden"
        name={field('key')}
        value={values[field('key')] ?? segment.key}
      />
      <div className="create-room-speech-heading">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <div className="create-room-order">
          <ScheduleButton
            intent={`up:${index}`}
            label={`Move speech ${index + 1} up`}
            disabled={index === 0}
            schedule={schedule}
          />
          <ScheduleButton
            intent={`down:${index}`}
            label={`Move speech ${index + 1} down`}
            disabled={index === draft.definition.segments.length - 1}
            schedule={schedule}
          />
          <ScheduleButton
            intent={`remove:${index}`}
            label={`Remove speech ${index + 1}`}
            disabled={sameSide <= 1}
            schedule={schedule}
          />
        </div>
      </div>
      <div className="create-room-speech-fields">
        <label className="create-room-field">
          <span>Name</span>
          <input
            className={controlClass}
            name={field('label')}
            value={values[field('label')] ?? ''}
            onChange={(event) => change(field('label'), event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <DurationField
          name={`segment.${index}`}
          label="Time"
          values={values}
          change={change}
        />
        <label className="create-room-field">
          <span>Type</span>
          <select
            className={controlClass}
            name={field('type')}
            value={values[field('type')]}
            onChange={(event) => change(field('type'), event.target.value)}
          >
            <option value="speech">Speech</option>
            <option value="cross_ex">Question period</option>
          </select>
        </label>
        <label className="create-room-field">
          <span>Side</span>
          <select
            className={controlClass}
            name={field('side')}
            value={side}
            onChange={(event) => change(field('side'), event.target.value)}
          >
            <option value="affirmative">Affirmative</option>
            <option value="negative">Negative</option>
          </select>
        </label>
        <label className="create-room-field">
          <span>Speaker</span>
          <input
            className={controlClass}
            type="number"
            name={field('slot')}
            value={values[field('slot')]}
            onChange={(event) => change(field('slot'), event.target.value)}
            min={0}
            max={
              draft.definition.seats[
                side === 'affirmative' ? 'affirmative' : 'negative'
              ] - 1
            }
            required
          />
        </label>
      </div>
    </div>
  );
}

export function DraftSettings(props: Props) {
  const { draft, values, change, schedule } = props;
  return (
    <>
      <input type="hidden" name="segmentCount" value={values.segmentCount} />
      <details className="create-room-disclosure">
        <summary>
          Speeches and question periods{' '}
          <span>{draft.definition.segments.length} periods</span>
        </summary>
        <div className="create-room-disclosure-body">
          {draft.definition.segments.map((segment, index) => (
            <SpeechRow key={segment.key} {...props} index={index} />
          ))}
          <div className="create-room-add">
            <ScheduleButton
              intent="add-affirmative"
              label="Add affirmative speech"
              schedule={schedule}
              disabled={draft.definition.segments.length >= 64}
            />
            <ScheduleButton
              intent="add-negative"
              label="Add negative speech"
              schedule={schedule}
              disabled={draft.definition.segments.length >= 64}
            />
            <ScheduleButton
              intent="add-question"
              label="Add question period"
              schedule={schedule}
              disabled={draft.definition.segments.length >= 64}
            />
          </div>
        </div>
      </details>
      <details className="create-room-disclosure">
        <summary>Preparation and timing</summary>
        <div className="create-room-setting-grid create-room-disclosure-body">
          <DurationField
            name="preRound"
            label="Before the round"
            values={values}
            change={change}
          />
          <DurationField
            name="inRound"
            label="During the round, per side"
            values={values}
            change={change}
          />
          <DurationField
            name="countdown"
            label="Countdown before each period"
            values={values}
            change={change}
          />
        </div>
      </details>
      <details className="create-room-disclosure">
        <summary>Questions and floor rules</summary>
        <div className="create-room-setting-grid create-room-disclosure-body">
          <label className="create-room-field">
            <span>Question style</span>
            <select
              className={controlClass}
              name="questionStyle"
              value={values.questionStyle}
              onChange={(event) => change('questionStyle', event.target.value)}
            >
              <option value="cross-examination">Cross-examination</option>
              <option value="poi">Points of information (POI)</option>
            </select>
          </label>
          <label className="create-room-field">
            <span>End a speech early</span>
            <select
              className={controlClass}
              name="yielding"
              value={values.yielding}
              onChange={(event) => change('yielding', event.target.value)}
            >
              <option value="on">Allowed</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="create-room-field">
            <span>Return unused time to prep</span>
            <select
              className={controlClass}
              name="returnsTime"
              value={values.returnsTime}
              onChange={(event) => change('returnsTime', event.target.value)}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
        </div>
      </details>
      <details className="create-room-disclosure">
        <summary>Seats</summary>
        <div className="create-room-setting-grid create-room-disclosure-body">
          {(['seatAffirmative', 'seatNegative', 'seatJudge'] as const).map(
            (name, index) => (
              <label className="create-room-field" key={name}>
                <span>
                  {
                    ['Affirmative debaters', 'Negative debaters', 'Judges'][
                      index
                    ]
                  }
                </span>
                <input
                  className={controlClass}
                  type="number"
                  name={name}
                  value={values[name]}
                  min={name === 'seatJudge' ? 0 : 1}
                  max={name === 'seatJudge' ? 1 : 255}
                  onChange={(event) => change(name, event.target.value)}
                  required
                />
              </label>
            ),
          )}
        </div>
      </details>
    </>
  );
}
