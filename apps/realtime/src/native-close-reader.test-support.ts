import { serverMessageSchema, type ServerMessage } from '@daisy/protocol';

/** Test-only physical reader: capture authentication frames, then consume only close control. */
export function createNativeCloseReader() {
  const frames: ServerMessage[] = [];
  let closeCode: number | undefined;
  let captureApplicationFrames = true;
  return {
    frames,
    discardApplicationFrames() {
      captureApplicationFrames = false;
    },
    closeCode: () => closeCode,
    consume(opcode: number, payload: Buffer) {
      if (opcode === 8) {
        closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        return true;
      }
      if (opcode === 1 && captureApplicationFrames)
        frames.push(
          serverMessageSchema.parse(JSON.parse(payload.toString()), {
            jitless: true,
          }),
        );
      return false;
    },
  };
}
