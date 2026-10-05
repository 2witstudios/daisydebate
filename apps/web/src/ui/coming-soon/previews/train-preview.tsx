import { trainFeedback, trainModes } from '../../mock/coming-soon';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Train screens replace this composition. */
export function TrainPreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Train" />
      <Panel title="Modes">
        <PreviewRows rows={trainModes} />
      </Panel>
      <Panel title="Argument drill · claim, warrant, impact">
        <p className="mb-3 text-base text-ink">
          Cities should fund public transit first, because every other service
          depends on people being able to reach it.
        </p>
        <PreviewRows rows={trainFeedback} />
        <div className="mt-3">
          <Button variant="secondary">Check structure</Button>
        </div>
      </Panel>
    </PreviewPage>
  );
}
