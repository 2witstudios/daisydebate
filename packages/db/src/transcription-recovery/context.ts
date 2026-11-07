type Unit = {
  readonly sourceKey: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
};
type Context = {
  readonly sourceKey: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly lastSequence: number;
  readonly units: number;
};
/** Receipt grouping only. A new context never fills a missing observation or establishes silence. */
export function contextBoundary(
  current: Context | null,
  unit: Unit,
): 'append' | 'new' {
  return current !== null &&
    current.sourceKey === unit.sourceKey &&
    current.startOffsetMs + current.durationMs === unit.startOffsetMs &&
    current.lastSequence + 1 === unit.firstSequence &&
    current.durationMs + unit.durationMs <= 30000 &&
    current.units < 128
    ? 'append'
    : 'new';
}
