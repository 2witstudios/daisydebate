/**
 * Where the operator listener may bind (ADR 0079): the machine's own
 * private 6PN address, resolved from `fly-local-6pn` and checked to be in
 * `fdaa::/16`, or a loopback literal in development and tests. Never a
 * wildcard, and a name that resolves elsewhere refuses to start.
 */
export async function resolveOperatorAddress(
  host: 'fly-local-6pn' | '127.0.0.1' | '::1',
  resolve: (name: string) => Promise<string>,
): Promise<string> {
  if (host !== 'fly-local-6pn') return host;
  const address = (await resolve(host)).toLowerCase();
  if (!/^fdaa:[0-9a-f:]+$/.test(address))
    throw new Error('fly-local-6pn did not resolve to a private 6PN address');
  return address;
}

/** The bound listener's lifecycle: started at boot, stopped in the shutdown drain. */
export type OperatorListener = { readonly stop: () => Promise<void> };

/**
 * Starts the private operator listener over the injected server factory.
 * It serves only the operator router; Next never answers here, and the
 * public listener has no operator route at all.
 */
export async function startOperatorListener(input: {
  readonly host: 'fly-local-6pn' | '127.0.0.1' | '::1';
  readonly port: number;
  readonly handle: (request: Request) => Promise<Response>;
  readonly resolve: (name: string) => Promise<string>;
  readonly serve: (options: {
    readonly hostname: string;
    readonly port: number;
    readonly fetch: (request: Request) => Promise<Response>;
  }) => { readonly stop: () => unknown };
}): Promise<OperatorListener & { readonly address: string }> {
  const address = await resolveOperatorAddress(input.host, input.resolve);
  const server = input.serve({
    hostname: address,
    port: input.port,
    fetch: input.handle,
  });
  return {
    address,
    stop: async () => {
      await server.stop();
    },
  };
}
