import { existsSync, writeFileSync } from 'node:fs';
import { createDatabase } from '@daisy/db';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { recognitionTestOptions } from './transcription-recovery.test-support';
if (import.meta.main) {
  const request = await Bun.stdin.json();
  const services = requireTestServices(process.env);
  const database = createDatabase({
    url: services.databaseUrl,
    nextActorId: createId,
  });
  try {
    const work = database.createTranscriptionRecovery(recognitionTestOptions);
    const result = await work.begin(request.claim);
    if (request.ready) {
      writeFileSync(request.ready, 'admission committed, reply withheld');
      const until = performance.now() + 10000;
      while (!existsSync(request.release)) {
        if (performance.now() > until)
          throw new Error('Recognition proof barrier timed out');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    process.stdout.write(JSON.stringify(result));
  } finally {
    await database.close();
  }
}
export function spawnRecognitionProcess(request: object) {
  const child = Bun.spawn([process.execPath, 'run', import.meta.filename], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify(request));
  child.stdin.end();
  return child;
}
