/** What the model asks of the world. Answers come back as later events carrying the request. */
export type FloorEffect =
  | { readonly type: 'discover'; readonly request: number }
  | { readonly type: 'open'; readonly request: number }
  | {
      readonly type: 'read-latest';
      readonly request: number;
      readonly channelId: string;
    }
  | {
      readonly type: 'read-older';
      readonly request: number;
      readonly channelId: string;
      readonly before: number;
    }
  | {
      readonly type: 'mark-read';
      readonly request: number;
      readonly channelId: string;
      readonly sequence: number;
    }
  /** Report expiry-reached when this time passes; null stops watching. */
  | { readonly type: 'watch-expiry'; readonly expiresAt: string | null };
