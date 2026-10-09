/** Context ownership only: competitive data belongs to the dedicated proof slot. */
export async function createLaunchContexts<
  Context extends { close(): Promise<void> },
>(
  count: number,
  open: () => Promise<Context>,
  signup: (context: Context) => Promise<{ readonly username: string }>,
) {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error('Invalid Launch account count');
  const contexts: Context[] = [];
  const members: { readonly context: Context; readonly username: string }[] =
    [];
  let closing: Promise<void> | undefined;
  const closeContexts = () =>
    (closing ??= (async () => {
      const results = await Promise.allSettled(
        contexts.map((context) => context.close()),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw new Error(
          'Launch contexts could not all close; suite-owned slot data retained',
        );
    })());
  try {
    for (let index = 0; index < count; index++) {
      const context = await open();
      contexts.push(context);
      const { username } = await signup(context);
      members.push({ context, username });
    }
    return { members, closeContexts };
  } catch {
    await closeContexts();
    throw new Error(
      'Launch account setup failed; suite-owned slot data retained',
    );
  }
}
