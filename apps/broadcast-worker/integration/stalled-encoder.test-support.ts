export {};

// The real worker spawns this executable in place of ffmpeg. A held response
// pins execution inside encoding until the parent releases it or SIGTERM wins.
const endpoint = process.env.ENCODER_TEST_ENDPOINT;
if (!endpoint) throw new Error('Encoder proof endpoint required');
await fetch(`${endpoint}/encoder`, {
  method: 'POST',
  body: String(process.pid),
});
for (const file of process.argv.slice(2).filter((arg) => arg.endsWith('.ts')))
  await Bun.write(file, 'encoded segment');
