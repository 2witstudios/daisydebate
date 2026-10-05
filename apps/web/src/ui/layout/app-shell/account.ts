/** Who the shell is showing: derived on the server from the durable session. */
export type ShellAccount =
  | { readonly state: 'anonymous' }
  | { readonly state: 'provisional' }
  | { readonly state: 'member'; readonly username: string };
