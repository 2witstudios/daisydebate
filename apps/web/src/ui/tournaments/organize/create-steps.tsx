import {
  sizesFor,
  wizardHref,
  withStructure,
  wizardSummary,
  type Draft,
  type WizardQuery,
} from '../../../features/tournaments/create-wizard';
import { structureLabel } from '../../../features/tournaments/labels';
import { structures } from '../../../features/tournaments/tournament';
import { Notice } from '../notice/notice';
import {
  Field,
  Segmented,
  card,
  field,
  hint,
  labelClass,
} from './create-fields';

export function Basics({ draft }: { readonly draft: Draft }) {
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Basics</h2>
      <Field
        id="t-name"
        label="Name"
        note="Shown on the tournaments list and the bracket. Up to 60 characters."
      >
        <input id="t-name" defaultValue={draft.name} className={field} />
      </Field>
      <Field id="t-desc" label="Description">
        <textarea
          id="t-desc"
          rows={4}
          defaultValue={draft.description}
          className={`${field} h-auto p-3`}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Who can find it</legend>
        <label className="flex items-start gap-3 text-base text-ink">
          <input
            type="radio"
            name="vis"
            defaultChecked={draft.listed}
            className="mt-1"
          />
          <span>
            Listed on Tournaments. Anyone can find it, register and watch.
          </span>
        </label>
        <label className="flex items-start gap-3 text-base text-ink">
          <input
            type="radio"
            name="vis"
            defaultChecked={!draft.listed}
            className="mt-1"
          />
          <span>
            Unlisted, link only. Only people with the link can see and enter it.
          </span>
        </label>
      </fieldset>
    </div>
  );
}

export function Size({
  query,
  draft,
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
}) {
  const summary = wizardSummary(query);
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Size and structure</h2>
      <div className="flex flex-col gap-2">
        <p className={labelClass}>Structure</p>
        <Segmented
          label="Structure"
          options={structures.map((structure) => ({
            key: structure,
            text: structureLabel(structure),
            href: wizardHref(withStructure(query, structure)),
            on: structure === query.structure,
          }))}
        />
        <span className={hint}>
          Bracket and round-robin events are supported.
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <p className={labelClass}>Number of places</p>
        <Segmented
          label="Places"
          options={sizesFor(query.structure).map((places) => ({
            key: String(places),
            text: String(places),
            href: wizardHref({ ...query, places }),
            on: places === query.places,
          }))}
        />
      </div>
      <Notice icon="calendar">{summary.calc}</Notice>
      <Field id="seeding" label="Seeding">
        <select id="seeding" className={field} defaultValue={draft.seeding}>
          <option>{draft.seeding}</option>
          <option>Random draw</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        <Field id="rmin" label="Lowest rating allowed (optional)">
          <input id="rmin" placeholder="No minimum" className={field} />
        </Field>
        <Field
          id="rmax"
          label="Highest rating allowed (optional)"
          note="Provisional players are allowed unless you limit by rating."
        >
          <input id="rmax" placeholder="No maximum" className={field} />
        </Field>
      </div>
      <label className="flex items-start gap-3 text-base text-ink">
        <input
          type="checkbox"
          defaultChecked={draft.waitlist}
          className="mt-1"
        />
        <span>
          Keep a waitlist when full. The first person on the waitlist is entered
          automatically when someone withdraws.
        </span>
      </label>
    </div>
  );
}

export function Schedule({
  query,
  draft,
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
}) {
  const summary = wizardSummary(query);
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Schedule</h2>
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        <Field id="reg-open" label="Registration opens">
          <input
            id="reg-open"
            type="datetime-local"
            defaultValue={draft.registrationOpens}
            className={field}
          />
        </Field>
        <Field
          id="reg-close"
          label="Registration closes"
          note="Seeds and the bracket are made after this."
        >
          <input
            id="reg-close"
            type="datetime-local"
            defaultValue={draft.registrationCloses}
            className={field}
          />
        </Field>
      </div>
      <Field id="tz" label="Time zone" note="Times are shown in UTC for now.">
        <select id="tz" className={field}>
          <option>{draft.timeZone}</option>
        </select>
      </Field>
      <div className="flex flex-col gap-2">
        <h3 className={labelClass}>Round times</h3>
        <ul className="flex flex-col gap-2">
          {summary.roundRows.map((row) => (
            <li key={row.label} className="flex flex-wrap items-center gap-3">
              <span className="w-1/4 text-base text-ink-muted max-compact:w-full">
                {row.label}
              </span>
              <input
                type="date"
                aria-label={`${row.label} date`}
                defaultValue={row.date}
                className={`${field} w-1/3`}
              />
              <input
                type="time"
                aria-label={`${row.label} time`}
                defaultValue={row.time}
                className={`${field} w-1/4`}
              />
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        <Field id="checkin" label="Check-in opens before each round">
          <select id="checkin" className={field}>
            <option>{draft.checkIn}</option>
          </select>
        </Field>
        <Field
          id="grace"
          label="Forfeit grace after start"
          note="After this an absent debater can be recorded as a forfeit."
        >
          <select id="grace" className={field}>
            <option>{draft.grace}</option>
          </select>
        </Field>
      </div>
    </div>
  );
}
