/** One fake authority for both the admission and renewal lanes. */
export const bothLanes = <T>(reads: T) => ({
  admission: reads,
  renewal: reads,
});
