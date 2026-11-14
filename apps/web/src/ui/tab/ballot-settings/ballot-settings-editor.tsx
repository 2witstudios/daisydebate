'use client';

import { useState } from 'react';
import {
  applyBallotOption,
  type BallotOption,
  type BallotSettings,
} from '../../../features/tab/ballot-definition';
import { sourceLabel } from '../../../features/tab/settings';
import { Button } from '../../components/button/button';
import { PageHeader } from '../../components/page-header/page-header';
import { ConfiguredBallot } from '../ballot/configured-ballot';
import { inlineSelectClass } from '../choice-field/choice-field';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';

type Chosen = Readonly<Record<BallotOption['id'], string>>;

const chosenOf = (settings: BallotSettings): Chosen =>
  Object.fromEntries(
    settings.sections.flatMap((section) =>
      section.options.map((option) => [option.id, option.value]),
    ),
  ) as Chosen;

/** The definition the chosen options make, from the event's saved one. */
export const definitionOf = (settings: BallotSettings, chosen: Chosen) =>
  (Object.keys(chosen) as BallotOption['id'][]).reduce(
    (definition, id) => applyBallotOption(definition, id, chosen[id]),
    settings.definition,
  );

/**
 * A ballot definition's settings beside the ballot a judge would get: every
 * choice redraws the preview from the definition it makes.
 */
export function BallotSettingsEditor({
  settings,
  header,
  submit,
}: {
  readonly settings: BallotSettings;
  /** The links above the title, drawn by the server. */
  readonly header: React.ReactNode;
  readonly submit: ReturnType<SampleSubmit>;
}) {
  const [chosen, setChosen] = useState(() => chosenOf(settings));
  const definition = definitionOf(settings, chosen);
  return (
    <div className="flex items-start gap-6 max-rail:flex-col">
      <SampleForm
        action={submit}
        label="Ballot"
        className="flex min-w-0 flex-1 flex-col gap-5 max-rail:w-full"
      >
        {header}
        <PageHeader
          title="Ballot"
          lede={settings.lede}
          actions={<Button type="submit">{settings.saveLabel}</Button>}
        />
        <ListCard>
          {settings.sections.map((section, index) => (
            <section key={section.heading}>
              <ListHeading>{section.heading}</ListHeading>
              <ul>
                {index === 0
                  ? settings.locked.map((setting) => (
                      <ListRow
                        key={setting.label}
                        title={setting.label}
                        detail={`${sourceLabel(setting)} · locked`}
                        trailing={
                          <span className="text-sm">{setting.value}</span>
                        }
                      />
                    ))
                  : null}
                {section.options.map((option) => (
                  <ListRow
                    key={option.id}
                    title={
                      <label htmlFor={`ballot-setting-${option.id}`}>
                        {option.label}
                      </label>
                    }
                    detail={option.detail}
                    trailing={
                      <select
                        id={`ballot-setting-${option.id}`}
                        name={option.id}
                        value={chosen[option.id]}
                        onChange={(event) =>
                          setChosen({
                            ...chosen,
                            [option.id]: event.target.value,
                          })
                        }
                        className={inlineSelectClass}
                      >
                        {option.options.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </ListCard>
      </SampleForm>
      <aside
        aria-label="Preview of the judge's ballot"
        className="flex w-host-aside shrink-0 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5 max-rail:w-full"
      >
        <div className="flex flex-col">
          <h2 className="font-display text-xl font-bold">What a judge sees</h2>
          <p className="text-sm text-ink-muted">{settings.preview.lede}</p>
        </div>
        <ConfiguredBallot
          key={JSON.stringify(definition)}
          definition={definition}
          subjects={settings.preview.subjects}
          draft={settings.preview.draft}
          reasonReaders="Both debaters and their coaches read this."
          preview
        />
      </aside>
    </div>
  );
}
