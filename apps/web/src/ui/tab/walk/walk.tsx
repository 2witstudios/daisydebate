import Link from 'next/link';
import {
  sampleMomentLabels,
  sampleMoments,
  sampleViewerLabels,
  sampleViewers,
} from '../../../features/tab/sample/scene';
import type { Walk as Read } from '../../../features/tab/walk';
import { Button } from '../../components/button/button';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import type { FormStateAction } from '../../form-action/action-form';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ListCard } from '../list-card/list-card';
import { SampleForm } from '../sample-form/sample-form';

/**
 * Chooses who is looking at the sample tournament and when, and lists every
 * screen that viewer can open at that moment.
 */
export function Walk({
  walk,
  choose,
}: {
  readonly walk: Read;
  readonly choose: FormStateAction;
}) {
  return (
    <ReadingPage>
      <PageHeader title="Walk the sample tournament" />
      {/* Keyed on the scene: a select keeps the value it mounted with, so the
          form is made again when the choice it shows has changed. */}
      <SampleForm
        key={`${walk.scene.viewer}.${walk.scene.moment}`}
        action={choose}
        label="Viewer and moment"
        className="flex flex-wrap items-end gap-3"
      >
        <div className={fieldClass}>
          <label htmlFor="walk-viewer" className={labelClass}>
            Viewer
          </label>
          <select
            id="walk-viewer"
            name="viewer"
            defaultValue={walk.scene.viewer}
            className={controlClass}
          >
            {sampleViewers.map((viewer) => (
              <option key={viewer} value={viewer}>
                {sampleViewerLabels[viewer]}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="walk-moment" className={labelClass}>
            Moment
          </label>
          <select
            id="walk-moment"
            name="moment"
            defaultValue={walk.scene.moment}
            className={controlClass}
          >
            {sampleMoments.map((moment) => (
              <option key={moment} value={moment}>
                {sampleMomentLabels[moment]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Choose</Button>
      </SampleForm>
      <ListCard
        label={`${sampleViewerLabels[walk.scene.viewer]} · ${sampleMomentLabels[walk.scene.moment]}`}
      >
        <ol>
          {walk.steps.map((step) => (
            <li
              key={step.href}
              className="border-b border-border last:border-b-0"
            >
              <Link
                href={step.href}
                className="block px-4 py-3 font-strong text-ink"
              >
                {step.label}
              </Link>
            </li>
          ))}
        </ol>
      </ListCard>
    </ReadingPage>
  );
}
