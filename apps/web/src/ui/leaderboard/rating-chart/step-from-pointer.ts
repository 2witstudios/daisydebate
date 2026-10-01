/**
 * The debate a pointer is over: its x within the chart's box, mapped onto
 * the plot's margins and rounded to a whole debate.
 */
export function stepFromPointer(
  clientX: number,
  box: { readonly left: number; readonly width: number },
  plot: { readonly left: number; readonly right: number },
  viewWidth: number,
  lastStep: number,
): number {
  if (box.width === 0 || lastStep === 0) return 0;
  const x = ((clientX - box.left) / box.width) * viewWidth;
  const step = Math.round(
    ((x - plot.left) / (plot.right - plot.left)) * lastStep,
  );
  return Math.min(lastStep, Math.max(0, step));
}
