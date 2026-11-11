import {
  recordingBuildSteps,
  type RecordingBuildProgress,
  type RecordingPreparation,
} from '@daisy/protocol';
import { clockTime } from '../recording-player/recording-player-copy';

/** A step in its own units: nothing here is an estimate of the whole. */
const buildStepCopy = ({
  step,
  done,
  total,
}: RecordingBuildProgress): string => {
  switch (step) {
    case 'reading':
      return `Reading the captured video: part ${done + 1} of ${total}`;
    case 'composing':
      return `Joining the video: ${clockTime(done)} of ${clockTime(total)}`;
    case 'encoding':
      return `Encoding for playback: ${clockTime(done)} of ${clockTime(total)}`;
    case 'uploading':
      return `Saving the video: ${done} of ${total} files`;
    case 'verifying':
      return 'Checking the saved video';
  }
};

const preparationCopy = (preparation: RecordingPreparation | null): string => {
  switch (preparation?.stage) {
    case 'building':
      return buildStepCopy(preparation.progress);
    case 'capturing':
      return 'The video is still being captured.';
    case 'waiting':
    case undefined:
      return 'Waiting for its turn to be prepared.';
  }
};

/** Where a Recording really is, and whether it is running late. */
export function RecordingPreparationStatus({
  preparation,
}: {
  readonly preparation: RecordingPreparation | null | undefined;
}) {
  const progress =
    preparation?.stage === 'building' ? preparation.progress : null;
  return (
    <div
      aria-label="Recording preparation"
      className="flex flex-col gap-1 text-sm"
    >
      <p role="status">
        {progress
          ? `Step ${recordingBuildSteps.indexOf(progress.step) + 1} of ${recordingBuildSteps.length}. `
          : null}
        {preparationCopy(preparation ?? null)}
      </p>
      {progress && progress.total > 0 ? (
        <progress
          value={progress.done}
          max={progress.total}
          aria-label="Progress of this step"
          className="w-full"
        />
      ) : null}
      {preparation?.stage !== 'capturing' && preparation?.delayed ? (
        <p className="text-ink-muted">
          This is taking longer than it should. It is still being worked on, and
          nothing has been lost.
        </p>
      ) : null}
    </div>
  );
}
