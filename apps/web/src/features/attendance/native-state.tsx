import type { RoundView } from '@daisy/protocol';
import type { NativeAttendanceRead } from './read-native';
import { RoundAttendanceForm } from './native-form';

/**
 * The check-in path for a page without JavaScript; `useRoundAttendance` checks
 * in otherwise. Render only the fresh read's own facts; no client or GET
 * produces attendance.
 */
export function RoundNativeAttendance({
  view,
  read,
  retrySeconds,
}: {
  readonly view: RoundView;
  /** Absent for a Round that is not active, which has nothing to read. */
  readonly read: NativeAttendanceRead | null;
  /** When a temporarily refused read asks again, as a GET; the page picks it. */
  readonly retrySeconds: number;
}) {
  // Check-ins exist only in an active Round; its read refuses any other state.
  if (view.status !== 'active' || !read) return null;
  return (
    <noscript>
      <NativeAttendanceSection
        view={view}
        read={read}
        retrySeconds={retrySeconds}
      />
    </noscript>
  );
}

function NativeAttendanceSection({
  view,
  read,
  retrySeconds,
}: {
  readonly view: RoundView;
  readonly read: NativeAttendanceRead;
  readonly retrySeconds: number;
}) {
  if (read.kind !== 'found' || read.state.roundId !== view.id)
    return read.kind === 'unavailable' && read.temporary ? (
      <section aria-label="Attendance">
        {/* Only a page with no script reads this: it holds no media to lose. */}
        <meta httpEquiv="refresh" content={String(retrySeconds)} />
        <p role="status">Attendance status is unavailable. Trying again.</p>
      </section>
    ) : (
      <section aria-label="Attendance">
        <p>Attendance status is unavailable. Refresh this page to try again.</p>
      </section>
    );
  const { state } = read;
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
