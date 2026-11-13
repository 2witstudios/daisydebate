/** Minutes and seconds left until an instant, by the server's clock; never below zero. */
export const remaining = (endsAt: string, nowMs: number) => {
  const total = Math.max(0, Math.ceil((Date.parse(endsAt) - nowMs) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
