import type { BallotSettings as Read } from '../../../features/tab/ballot-definition';
import type { TimelineRail } from '../../../features/tab/tournament';
import { ActionLink } from '../action-control/action-control';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import type { SampleSubmit } from '../sample-form/sample-form';
import { BallotSettingsEditor } from './ballot-settings-editor';

/** An event's ballot definition, with the ballot it gives a judge. */
export function BallotSettings({
  rail,
  settings,
  submit,
}: {
  readonly rail: TimelineRail;
  readonly settings: Read;
  readonly submit: SampleSubmit;
}) {
  return (
    <HostShell rail={rail} current="setup">
      <BallotSettingsEditor
        settings={settings}
        submit={submit(settings.saveLabel)}
        header={
          <>
            <ActionLink action={settings.setup} className="self-start" />
            <EventSwitcher event={settings.event} />
          </>
        }
      />
    </HostShell>
  );
}
