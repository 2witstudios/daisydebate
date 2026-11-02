import { chromium } from 'playwright-core';
const [endpoint, trustedPort, foreignPort] = process.argv.slice(2);
const browser = await chromium.connect(endpoint);
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const sandbox = await context.newPage();
  await sandbox.goto('chrome://sandbox');
  await sandbox.waitForFunction(
    () =>
      document.querySelector('#evaluation')?.textContent ===
      'You are adequately sandboxed.',
  );
  const sandboxStatus = await sandbox
    .locator('#sandbox-status')
    .evaluate((table) => {
      const rows = Object.fromEntries(
        [...table.querySelectorAll('tr')].map((row) =>
          [...row.querySelectorAll('td')].map((cell) => cell.textContent),
        ),
      );
      return {
        layer1: ['Namespace', 'SUID'].includes(rows['Layer 1 Sandbox']),
        pidNamespace: rows['PID namespaces'] === 'Yes',
        networkNamespace: rows['Network namespaces'] === 'Yes',
        seccomp: rows['Seccomp-BPF sandbox'] === 'Yes',
      };
    });
  if (!Object.values(sandboxStatus).every(Boolean))
    throw new Error('Prepared browser renderer sandbox status failed');
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.sandbox.proof', ...sandboxStatus })}\n`,
  );
  await sandbox.close();
  const page = await context.newPage();
  const origin = `https://localhost:${trustedPort}`;
  await context.grantPermissions(['camera', 'microphone'], { origin });
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
