'use client';

import { useId, useState } from 'react';
import type {
  BallotOption,
  BallotSettings,
} from '../../../features/tab/ballot-definition';
import { applyBallotOption } from '../../../features/tab/ballot-rules';
import { sourceLabel } from '../../../features/tab/settings';
import { Button } from '../../components/button/button';
import { PageHeader } from '../../components/page-header/page-header';
import { inlineSelectClass } from '../choice-field/choice-field';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';
import { BallotPreview, BallotPreviewLayout } from './ballot-preview';

type Chosen = Readonly<Partial<Record<BallotOption['id'], string>>>;

const chosenOf = (settings: BallotSettings): Chosen =>
  Object.fromEntries(
    settings.sections.flatMap((section) =>
      section.options.map((option) => [option.id, option.value]),
    ),
  );

/** The definition the chosen options make, from the event's saved one. */
const definitionOf = (settings: BallotSettings, chosen: Chosen) =>
  (Object.entries(chosen) as [BallotOption['id'], string][]).reduce(
    (definition, [id, value]) => applyBallotOption(definition, id, value),
    settings.definition,
  );

/**
 * The ballot a judge would get, as the page's main column, with the
 * definition's settings in a column to its right: every choice redraws the
 * preview from the definition it makes. On a narrow screen the ballot comes
 * first and the settings follow. The preview stays outside the settings
 * form, so its sample answers are never posted; the header's Save posts the
 * form by its id.
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
  const formId = useId();
  const [chosen, setChosen] = useState(() => chosenOf(settings));
  const definition = definitionOf(settings, chosen);
  return (
    <div className="flex flex-col gap-5">
      {header}
      <PageHeader
        title="Ballot"
        lede={settings.lede}
        actions={
          <Button type="submit" form={formId}>
            {settings.saveLabel}
          </Button>
        }
      />
      <BallotPreviewLayout
        preview={
          <BallotPreview definition={definition} preview={settings.preview} />
        }
      >
        <SampleForm
          id={formId}
          action={submit}
          label="Ballot settings"
          className="flex flex-col gap-4"
        >
          <ListCard>
            {settings.sections.map((section) => (
              <section key={section.heading}>
                <ListHeading>{section.heading}</ListHeading>
                <ul>
                  {section.locked.map((setting) => (
                    <ListRow
                      key={setting.label}
                      title={setting.label}
                      detail={`${sourceLabel(setting)} · locked`}
                      trailing={
                        <span className="text-sm">{setting.value}</span>
                      }
                    />
                  ))}
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
                          value={chosen[option.id] ?? option.value}
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
          {/* Narrow, the settings follow the whole ballot: Save again
              beside them, so nobody scrolls back up to the header. */}
          <div className="hidden max-rail:block">
            <Button type="submit">{settings.saveLabel}</Button>
          </div>
        </SampleForm>
      </BallotPreviewLayout>
    </div>
  );
}
