import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withDownloadTransport } from '../integration/economics-download-transport.test-support';

setupRitewayBun();

test('controlled private transport distinguishes issued links, verified receipts, overlap and partial reads', async () => {
  await withDownloadTransport(async (transport) => {
    const payload = new Uint8Array(256 * 1024).map((_, n) => n % 251);
    transport.put('recordings/test/video.mp4', payload);
    const issue = () =>
      transport.objects.signedRead('recordings/test/video.mp4', {
        expiresInSeconds: 60,
        attachmentName: 'test.mp4',
      });
    const unused = issue();
    assert({
      given: 'an issued but unused actual S3 signed link',
      should: 'measure no transfer or completed receipt',
      actual: transport.facts(),
      expected: { attempts: 0, completed: 0, bytes: 0, peak: 0, active: 0 },
    });
    const tampered = new URL(unused);
    tampered.searchParams.set('X-Amz-Signature', 'not-issued');
    assert({
      given:
        'a URL outside this controlled receiver’s exact issued-link allowlist',
      should: 'refuse it without an observed transfer',
      actual: [(await fetch(tampered)).status, transport.facts().attempts],
      expected: [403, 0],
    });
    const progression = [];
    for (let n = 0; n < 2; n++) {
      await transport.receive(issue(), payload);
      progression.push(transport.facts());
    }
    assert({
      given: 'two complete sequential object reads',
      should:
        'increase independently verified volume without increasing interval high-water',
      actual: progression,
      expected: [1, 2].map((n) => ({
        attempts: n,
        completed: n,
        bytes: n * payload.length,
        peak: 1,
        active: 0,
      })),
    });
    const held = transport.hold();
    const overlap = [
      transport.receive(issue(), payload),
      transport.receive(issue(), payload),
    ];
    await transport.waitActive(2);
    held();
    await Promise.all(overlap);
    const partialRelease = transport.hold();
    const response = await fetch(issue());
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    partialRelease();
    await transport.waitActive(0);
    assert({
      given: 'two overlapping full reads and a cancelled partial read',
      should:
        'observe peak two while counting only full verified client receipts',
      actual: transport.facts(),
      expected: {
        attempts: 5,
        completed: 4,
        bytes: 4 * payload.length,
        peak: 2,
        active: 0,
      },
    });
    const wrong = payload.slice();
    wrong[0] = 255;
    const rejected = await transport.receive(issue(), wrong).then(
      () => false,
      () => true,
    );
    assert({
      given:
        'a complete response whose bytes do not match the expected owned object',
      should:
        'reject the hash mismatch without inventing a verified completion',
      actual: [
        rejected,
        transport.facts().attempts,
        transport.facts().completed,
      ],
      expected: [true, 6, 4],
    });
  });
});
