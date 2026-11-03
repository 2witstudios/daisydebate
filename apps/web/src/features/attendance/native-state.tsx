import type { RoundView } from '@daisy/protocol';
import type { NativeAttendanceState } from './operations';
import { RoundAttendanceForm } from './native-form';

/** A check-in window is short, so a refused read asks again soon, as a GET. */
const ATTENDANCE_RETRY_SECONDS = 5;

/**
 * The check-in path for a page without JavaScript; `useRoundAttendance` checks
 * in otherwise. Render only the fresh read's own facts; no client or GET
 * produces attendance.
 */
export function RoundNativeAttendance({
  view,
  state,
}: {
  readonly view: RoundView;
  readonly state: NativeAttendanceState | null;
}) {
  // Check-ins exist only in an active Round; its read refuses any other state.
  if (view.status !== 'active') return null;
  return (
    <noscript>
      <NativeAttendanceSection view={view} state={state} />
    </noscript>
  );
}

function NativeAttendanceSection({
  view,
  state,
}: {
  readonly view: RoundView;
  readonly state: NativeAttendanceState | null;
}) {
  if (!state || state.roundId !== view.id)
    return (
      <section aria-label="Attendance">
        {/* Only a page with no script reads this: it holds no media to lose. */}
        <meta httpEquiv="refresh" content={String(ATTENDANCE_RETRY_SECONDS)} />
        <p role="status">Attendance status is unavailable. Trying again.</p>
      </section>
    );
  const label = (id: string) => {
    const segment = view.segments.find((segment) => segment.id === id);
    return (
      view.rules.segments.find((rule) => rule.key === segment?.rulesSegmentKey)
        ?.label ?? 'Speech'
    );
  };
  return (
    <section aria-label="Attendance">
      {state.recorded.map((receipt) => (
        <p key={receipt.segmentId}>
          Attendance recorded for {label(receipt.segmentId)}.
        </p>
      ))}
      {state.targets.map((target) => (
        <div key={target.segmentId}>
          <p>{label(target.segmentId)}</p>
          <RoundAttendanceForm
            roundId={view.id}
            segmentId={target.segmentId}
            commandId={target.commandId}
          />
        </div>
      ))}
      {state.targets.length === 0 && state.recorded.length === 0 ? (
        <p>No attendance check-in is currently available.</p>
      ) : null}
    </section>
  );
}
