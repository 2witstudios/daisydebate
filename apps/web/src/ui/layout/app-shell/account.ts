/** Who the shell is showing: derived on the server from the durable session. */
export type ShellAccount =
  | { readonly state: 'anonymous' }
  | { readonly state: 'provisional' }
  /** Signed in with a username, waiting for beta access (ADR 0075). */
  | { readonly state: 'waitlisted' }
  | { readonly state: 'member'; readonly username: string };
