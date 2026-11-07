/** The existing finite proof-read budget; commands are never repeated here. */
export async function readRoundReply<
  T extends { status(): number; headers(): Record<string, string> },
>(
  read: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((done) => setTimeout(done, ms)),
) {
  let response = await read();
  for (
    let attempt = 0;
    attempt < 5 &&
    response.status() === 503 &&
    response.headers()['retry-after'] === '1';
    attempt++
  ) {
    await wait(2000);
    response = await read();
  }
  return response;
}
