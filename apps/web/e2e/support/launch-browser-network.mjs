import net from 'node:net';
import dgram from 'node:dgram';
import { chromium } from 'playwright-core';

// A disposable container keeps localhost URLs and real ICE endpoints unchanged.
const ports = JSON.parse(process.env.DAISY_BROWSER_FORWARD_PORTS);
const listeners = ports.map((port) => {
  const server = net.createServer((incoming) => {
    const upstream = net.connect(port, 'host.docker.internal');
    incoming.on('error', () => upstream.destroy());
    upstream.on('error', () => incoming.destroy());
    incoming.pipe(upstream).pipe(incoming);
  });
  server.listen(port, '127.0.0.1');
  return server;
});
const udp = dgram.createSocket('udp4');
const peers = new Map();
udp.on('message', (message, peer) => {
  const id = `${peer.address}:${peer.port}`;
  let upstream = peers.get(id);
  if (!upstream) {
    upstream = dgram.createSocket('udp4');
    upstream.on('message', (reply) => udp.send(reply, peer.port, peer.address));
    upstream.on('error', () => {
      upstream.close();
      peers.delete(id);
    });
    peers.set(id, upstream);
  }
  upstream.send(message, 7882, 'host.docker.internal');
});
udp.bind(7882, '127.0.0.1');
const browser = await chromium.launchServer({
  port: 3400,
  host: '0.0.0.0',
  headless: true,
  channel: 'chromium',
  chromiumSandbox: true,
  args: ['--use-fake-device-for-media-stream'],
});
const launchArguments = browser.process().spawnargs;
if (
  process.getuid() === 0 ||
  launchArguments.some((arg) =>
    /^--(?:no-sandbox|disable-setuid-sandbox|disable-web-security|ignore-certificate-errors|allow-insecure-localhost|unsafely-treat-insecure-origin-as-secure)(?:=|$)/.test(
      arg,
    ),
  ) ||
  !launchArguments.includes('--use-fake-device-for-media-stream')
) {
  await browser.close();
  throw new Error(
    'Browser proof requires non-root sandboxed controlled devices',
  );
}
process.stdout.write(`Listening on ${browser.wsEndpoint()}\n`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await browser.close();
    for (const listener of listeners) listener.close();
    udp.close();
    for (const peer of peers.values()) peer.close();
  });
