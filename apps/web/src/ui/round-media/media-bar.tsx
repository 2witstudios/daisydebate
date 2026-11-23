'use client';
import { Announcement } from '../components/announcement/announcement';
import { Button } from '../components/button/button';
import type { MediaRuntime } from '../../features/round-media/media-runtime';
import type { MediaState } from '../../features/round-media/model/media-state';
import {
  controlsOf,
  statusOf,
} from '../../features/round-media/model/media-status';

const button =
  'min-h-room-target rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2';

/** The bar under the stage: everything on it is derived from the one media state. */
export function MediaBar({
  state,
  dispatch,
  questioning,
}: {
  readonly state: MediaState;
  readonly dispatch: MediaRuntime['dispatch'];
  /** This format lets a debater mute between questions. */
  readonly questioning: boolean;
}) {
  const status = statusOf(state);
  const controls = controlsOf(state);
  const muted = state.microphoneMuted;
  return (
    <div
      data-room-media="status"
      className="flex flex-wrap items-center gap-3 bg-surface-sunken px-3 py-2"
    >
      <Announcement
        as="p"
        kind="progress"
        className="m-0 text-sm text-ink-muted"
      >
        {status.message}
      </Announcement>
      {controls.enableSound ? (
        <Button
          variant="unstyled"
          type="button"
          className={button}
          onClick={() => dispatch({ type: 'enable-sound-pressed' })}
        >
          Enable sound
        </Button>
      ) : null}
      {questioning && controls.muteOffered ? (
        <Button
          variant="unstyled"
          type="button"
          className={button}
          disabled={!controls.muteEnabled}
          aria-pressed={!muted}
          onClick={() => dispatch({ type: 'mute-requested', muted: !muted })}
        >
          {muted ? 'Unmute microphone' : 'Mute microphone'}
        </Button>
      ) : null}
      {status.retry ? (
        <Button
          variant="unstyled"
          type="button"
          className={button}
          onClick={() => dispatch({ type: 'retry-pressed' })}
        >
          Retry camera and sound
        </Button>
      ) : null}
    </div>
  );
}
