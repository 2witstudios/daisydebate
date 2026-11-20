/** The transport tuning a fake `RealtimeApp` carries: the configuration defaults' caps. */
export const testTransport = {
  maxPerIp: 20,
  maxUnauthenticated: 4,
  maxPerActor: 8,
  ringLimit: 2_000,
  maxSubscriptions: 64,
  allowedOrigins: [],
};
/** One fake authority for both the admission and renewal lanes. */
export const bothLanes = <T>(reads: T) => ({
  admission: reads,
  renewal: reads,
});
