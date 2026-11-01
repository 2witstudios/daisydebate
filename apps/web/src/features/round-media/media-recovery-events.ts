/** Browser events nudge the controller; only its typed paused state permits recovery. */
export function subscribeMediaRecovery(input: {
  readonly online: EventTarget;
  readonly visibility: EventTarget;
  readonly isVisible: () => boolean;
  readonly nudge: () => void;
}): () => void {
  const online = () => input.nudge();
  const visible = () => {
    if (input.isVisible()) input.nudge();
  };
  input.online.addEventListener('online', online);
  input.visibility.addEventListener('visibilitychange', visible);
  return () => {
    input.online.removeEventListener('online', online);
    input.visibility.removeEventListener('visibilitychange', visible);
  };
}
