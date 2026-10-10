import type { readMessagingFile } from './operations';
/** Filename is encoded as data; private bytes never acquire a public object URL. */
export function messagingFileResponse(
  file: Awaited<ReturnType<typeof readMessagingFile>>,
) {
  const filename = encodeURIComponent(file.filename).replace(
    /['()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new Response(Uint8Array.from(file.bytes), {
    headers: {
      'content-type': file.mime,
      'content-disposition': `attachment; filename*=UTF-8''${filename}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}
