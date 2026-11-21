import {
  placeField,
  speakerPlaceField,
  tiedPlaceField,
} from '../../../features/judge/ballot';
import type { BallotSubject } from '../../../features/judge/ballot-plan';
import { FormField } from '../../components/form-field/form-field';

const selectClass =
  'min-h-10 w-full min-w-0 rounded-md border border-border bg-surface-raised px-3 text-base text-ink';

/**
 * A ranking ballot's decision: one choice per place, best first, each
 * offering every subject. Native selects the browser owns (`defaultValue`),
 * so it posts before hydration and a refusal restores what was posted;
 * the parse refuses a subject placed twice.
 */
export function RankingChoice({
  subjects,
  values,
  kind = 'decision',
  ties = false,
}: {
  /** Who is ranked, in display order. */
  readonly subjects: readonly BallotSubject[];
  /** The places as posted last time; none on a fresh ballot. */
  readonly values: Readonly<Record<string, string>>;
  readonly kind?: 'decision' | 'speakers';
  readonly ties?: boolean;
}) {
  const field = kind === 'speakers' ? speakerPlaceField : placeField;
  if (ties)
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Places, with ties allowed</legend>
        {subjects.map((subject) => (
          <FormField
            key={subject.key}
            id={`ballot-${tiedPlaceField(subject.key)}`}
            label={subject.name}
          >
            <select
              id={`ballot-${tiedPlaceField(subject.key)}`}
              name={tiedPlaceField(subject.key)}
              defaultValue={values[tiedPlaceField(subject.key)] ?? ''}
              className={selectClass}
            >
              <option value="" disabled>
                Choose a place
              </option>
              {subjects.map((_, index) => (
                <option key={index} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </FormField>
        ))}
        <p className="text-sm text-ink-muted">
          Use consecutive places. Subjects tied together share a place.
        </p>
      </fieldset>
    );
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">The order they finished in</legend>
      {subjects.map((_, index) => {
        const place = index + 1;
        const id = `ballot-${field(place)}`;
        return (
          <FormField key={place} id={id} label={`Place ${place}`}>
            <select
              id={id}
              name={field(place)}
              defaultValue={values[field(place)] ?? ''}
              className={selectClass}
            >
              <option value="" disabled>
                Choose who placed here
              </option>
              {subjects.map((subject) => (
                <option key={subject.key} value={subject.key}>
                  {`${subject.name} · ${subject.role}`}
                </option>
              ))}
            </select>
          </FormField>
        );
      })}
    </fieldset>
  );
}
