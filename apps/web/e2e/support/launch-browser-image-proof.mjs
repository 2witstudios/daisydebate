import { chromium } from 'playwright-core';
const [endpoint, trustedPort, foreignPort] = process.argv.slice(2);
const browser = await chromium.connect(endpoint);
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await context.newPage();
  const origin = `https://localhost:${trustedPort}`;
  const response = await page.goto(origin);
  if (response?.status() !== 200)
    throw new Error('Fresh fixture CA HTTPS proof failed');
  await page.evaluate(async (port) => {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`wss://localhost:${port}/ws`);
      socket.onopen = () => socket.send('fixture');
      socket.onmessage = (event) => {
        socket.close();
        if (event.data === 'fixture') resolve();
        else reject(new Error('WSS echo mismatch'));
      };
      socket.onerror = () => reject(new Error('Strict WSS failed'));
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    if (stream.getTracks().some((track) => track.readyState !== 'live'))
      throw new Error('Controlled media unavailable');
    stream.getTracks().forEach((track) => track.stop());
  }, trustedPort);
  const rejection = async (url, expected) => {
    try {
      await page.goto(url, { timeout: 15000 });
    } catch (error) {
      if (String(error).includes(expected)) return;
      throw new Error(
        `Strict TLS failed with an unexpected classification: ${expected}`,
      );
    }
    throw new Error(`Strict TLS accepted forbidden certificate: ${expected}`);
  };
  await rejection(
    `https://localhost:${foreignPort}`,
    'ERR_CERT_AUTHORITY_INVALID',
  );
  await rejection(
    `https://wrong.localhost:${trustedPort}`,
    'ERR_CERT_COMMON_NAME_INVALID',
  );
  await context.close();
} finally {
  await browser.close();
}
