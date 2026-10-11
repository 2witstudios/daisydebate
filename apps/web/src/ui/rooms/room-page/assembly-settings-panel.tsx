import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import type { FormAction } from '../../form-action/form-action';
import { AssemblySummary } from './assembly-preview';
import { AssemblySettingsForm } from './assembly-settings-form';

export function AssemblySettingsPanel({
  view,
  commandId,
  action,
}: {
  readonly view: RoomView;
  readonly commandId: string;
  readonly action: FormAction<MockFormState>;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-4 border-b border-border pb-5"
      aria-label="Round settings"
    >
      <h2 className="font-display text-xl font-semibold">Round settings</h2>
      <AssemblySummary view={view} />
      {view.capabilities.canEdit ? (
        <AssemblySettingsForm
          view={view}
          commandId={commandId}
          action={action}
        />
      ) : null}
    </section>
  );
}
