export type PrivateObjectStore = {
  /** Immutable creation; never publish or return a signed bearer URL. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string, maxBytes: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
};
