export type Clock = {
  now(): string;
};

export type IdGenerator = {
  next(): string;
};

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export const systemId: IdGenerator = {
  next: () => crypto.randomUUID(),
};

export function fixedClock(instant: string): Clock {
  return { now: () => instant };
}

export function sequentialId(prefix = 'id'): IdGenerator {
  let sequence = 0;
  return {
    next: () => `${prefix}-${++sequence}`,
  };
}
