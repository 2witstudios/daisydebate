'use client';
import type { ReactNode } from 'react';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { buttonClass } from '../components/button/button-class';
import { Button } from '../components/button/button';
import { cn } from '../cn';
import { controlClass } from '../components/form-field/form-field-class';
import {
  leagueRequestDivisions,
  leagueRequestLimits,
  leagueRequestSchoolCounts,
  leagueRequestSeasonCounts,
} from '@daisy/protocol/league-request';
import {
  divisionsLabels,
  schoolCountLabels,
  seasonCountLabels,
  styleLabels,
} from '../../features/league-requests/labels';
import {
  honeypotField,
  initialRequestForm,
  requestFieldNames,
  requestFields,
  requestLost,
  type RequestField,
  type RequestFields,
  type RequestFormState,
} from '../../features/league-requests/request-form';

export const CONFIRMATION_HEADING_ID = 'league-request-sent';
const NOTICE_ID = 'league-request-notice';
const fieldId = (name: RequestField) => `league-request-${name}`;
const errorId = (name: RequestField) => `league-request-${name}-error`;

/** Where focus goes once an answer settles: the confirmation, the first field to fix, or the notice. */
const focusTarget = (answer: RequestFormState): string | undefined => {
  if (answer.kind === 'received') return CONFIRMATION_HEADING_ID;
  if (answer.kind === 'idle') return undefined;
  const fields = requestFields(answer);
  const first = requestFieldNames.find(
    (name) => name !== 'requestId' && fields.errors[name] !== undefined,
  );
  return first ? fieldId(first) : NOTICE_ID;
};

const invalid = 'aria-invalid:border-live disabled:opacity-60';
const inputClass = `${controlClass} ${invalid}`;
const textareaClass = `min-h-league-request-notes w-full min-w-0 resize-y rounded-md border border-border bg-surface-raised p-3 text-base text-ink ${invalid}`;

function Field({
  name,
  label,
  fields,
  helper,
  children,
}: {
  readonly name: RequestField;
  readonly label: string;
  readonly fields: RequestFields;
  readonly helper?: string;
  readonly children: ReactNode;
}) {
  const error = fields.errors[name];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={fieldId(name)} className="font-strong text-ink">
        {label}
      </label>
      {children}
      {helper ? (
        <p id={`${fieldId(name)}-helper`} className="text-sm text-ink-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId(name)} className="text-sm text-live">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** What every control of one field shares: its name, id, value and error wiring. */
const controlProps = (
  name: RequestField,
  fields: RequestFields,
  pending: boolean,
) => ({
  id: fieldId(name),
  name,
  defaultValue: fields.values[name],
  disabled: pending,
  'aria-invalid': fields.errors[name] ? true : undefined,
  'aria-describedby': fields.errors[name] ? errorId(name) : undefined,
});

const twoUp = 'grid grid-cols-2 gap-4 max-narrow:grid-cols-1';

/**
 * The League "Talk to us" form (PYL-17), as the canvas draws it. A sent
 * request gives way to the confirmation; anything to fix comes back beside
 * its field with the typed values kept.
 */
export function LeagueRequestForm({
  requestId,
  action,
}: {
  readonly requestId: string;
  readonly action: FormAction<RequestFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialRequestForm(requestId),
    requestLost,
  );
  useFocusAfterAnswer(answer, focusTarget(answer), !pending);
  if (answer.kind === 'received')
    return (
      <section
        aria-labelledby={CONFIRMATION_HEADING_ID}
        className="flex min-w-0 flex-2 basis-league-request-form flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
      >
        <h2
          id={CONFIRMATION_HEADING_ID}
          tabIndex={-1}
          className="font-display text-lg font-bold"
        >
          Thanks. We&rsquo;ll reply within two working days.
        </h2>
        <p className="text-ink-muted">
          We&rsquo;ll write to the email you gave us to plan a call.
        </p>
        <a href="/pricing" className={`${buttonClass('secondary')} self-start`}>
          Back to plans
        </a>
      </section>
    );
  const fields = requestFields(answer);
  const props = (name: RequestField) => controlProps(name, fields, pending);
  return (
    <form
      action={post}
      noValidate
      aria-label="Talk to us about a league"
      className="flex min-w-0 flex-2 basis-league-request-form flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
    >
      <input type="hidden" name="requestId" value={fields.values.requestId} />
      {/* The spam trap: hidden from people and assistive technology alike. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="league-request-website">Website</label>
        <input
          id="league-request-website"
          type="text"
          name={honeypotField}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>
      <Field name="leagueName" label="League name" fields={fields}>
        <input
          {...props('leagueName')}
          type="text"
          autoComplete="organization"
          maxLength={leagueRequestLimits.leagueName}
          className={inputClass}
        />
      </Field>
      <div className={twoUp}>
        <Field name="schools" label="How many schools" fields={fields}>
          <select {...props('schools')} className={inputClass}>
            {leagueRequestSchoolCounts.map((count) => (
              <option key={count} value={count}>
                {schoolCountLabels[count]}
              </option>
            ))}
          </select>
        </Field>
        <Field name="seasons" label="Seasons a year" fields={fields}>
          <select {...props('seasons')} className={inputClass}>
            {leagueRequestSeasonCounts.map((count) => (
              <option key={count} value={count}>
                {seasonCountLabels[count]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className={twoUp}>
        <Field name="style" label="Styles" fields={fields}>
          <input type="hidden" name="style" value="freestyle" />
          <input
            id={fieldId('style')}
            type="text"
            value={styleLabels.freestyle}
            readOnly
            disabled={pending}
            className={inputClass}
          />
        </Field>
        <Field name="divisions" label="Divisions" fields={fields}>
          <select {...props('divisions')} className={inputClass}>
            {leagueRequestDivisions.map((divisions) => (
              <option key={divisions} value={divisions}>
                {divisionsLabels[divisions]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        name="needs"
        label="What you need"
        helper="Tournaments a season, what you use today, anything that has to work on day one."
        fields={fields}
      >
        <textarea
          {...props('needs')}
          aria-describedby={
            fields.errors.needs
              ? `${errorId('needs')} ${fieldId('needs')}-helper`
              : `${fieldId('needs')}-helper`
          }
          maxLength={leagueRequestLimits.needs}
          className={textareaClass}
        />
      </Field>
      <div className={twoUp}>
        <Field name="contactName" label="Your name" fields={fields}>
          <input
            {...props('contactName')}
            type="text"
            autoComplete="name"
            maxLength={leagueRequestLimits.contactName}
            className={inputClass}
          />
        </Field>
        <Field name="contactRole" label="Your role" fields={fields}>
          <input
            {...props('contactRole')}
            type="text"
            autoComplete="organization-title"
            maxLength={leagueRequestLimits.contactRole}
            className={inputClass}
          />
        </Field>
        <Field name="contactEmail" label="Email" fields={fields}>
          <input
            {...props('contactEmail')}
            type="email"
            autoComplete="email"
            maxLength={leagueRequestLimits.contactEmail}
            className={inputClass}
          />
        </Field>
        <Field name="contactPhone" label="Phone (optional)" fields={fields}>
          <input
            {...props('contactPhone')}
            type="tel"
            autoComplete="tel"
            placeholder="For a call, if you prefer"
            maxLength={leagueRequestLimits.contactPhone}
            className={inputClass}
          />
        </Field>
      </div>
      {(fields.notice ?? fields.errors.requestId) ? (
        <p
          id={NOTICE_ID}
          role="alert"
          tabIndex={-1}
          className="text-sm text-live"
        >
          {fields.notice ?? fields.errors.requestId}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          Send to Daisy
        </Button>
        <a href="/pricing" className={cn(buttonClass('ghost'), 'text-ink')}>
          Cancel
        </a>
      </div>
    </form>
  );
}
