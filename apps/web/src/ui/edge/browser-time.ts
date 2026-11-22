/** Cancellable browser work. Keeping the host calls here also gives drivers
 * one place to obtain their real scheduler. */
export const delay = (run: () => void, ms: number) => setTimeout(run, ms);

export const cancelDelay = (timer: ReturnType<typeof delay> | undefined) =>
  clearTimeout(timer);

export const startTick = (run: () => void, ms: number) => setInterval(run, ms);

export const stopTick = (timer: ReturnType<typeof startTick> | undefined) =>
  clearInterval(timer);

export const nextFrame = (run: FrameRequestCallback) =>
  requestAnimationFrame(run);

export const cancelFrame = (frame: number) => cancelAnimationFrame(frame);

export function scheduleDelay(run: () => void, ms: number): () => void {
  const timer = delay(run, ms);
  return () => cancelDelay(timer);
}

export function scheduleTick(
  run: () => void,
  ms: number,
  host?: Pick<Window, 'setInterval' | 'clearInterval'>,
): () => void {
  if (host !== undefined) {
    const timer = host.setInterval(run, ms);
    return () => host.clearInterval(timer);
  }
  const timer = startTick(run, ms);
  return () => stopTick(timer);
}

export const windowDelay = (run: () => void, ms: number): number =>
  window.setTimeout(run, ms);

export const cancelWindowDelay = (timer: number): void =>
  window.clearTimeout(timer);
