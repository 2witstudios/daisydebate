import type { MessagingFileFormState } from '../forms/file-form';
/** Static refusal markup escapes all retained untrusted text and exposes no bytes or vendor keys. */
export function nativeFileResponse(
  channelId: string,
  messageId: string,
  state: MessagingFileFormState,
) {
  if (state.next)
    return new Response(null, {
      status: 303,
      headers: { location: state.next },
    });
  const action = `/api/messaging/channels/${channelId}/messages/${messageId}/attachments`;
  const discard =
    state.fileId && state.generation
      ? `<form method="post" action="/api/messaging/channels/${escapeText(channelId)}/files/discard"><input type="hidden" name="fileId" value="${escapeText(state.fileId)}"><input type="hidden" name="generation" value="${state.generation}"><button type="submit">Discard pending upload</button></form>`
      : '';
  const body = `<!doctype html><html lang="en"><head><title>Attach file</title></head><body><main><h1>Attach file</h1><p role="status">${escapeText(state.notice ?? '')}</p><p>Selected file: ${escapeText(state.filename)}</p><form method="post" enctype="multipart/form-data" action="${escapeText(action)}"><input type="hidden" name="requestId" value="${escapeText(state.requestId)}"><label>Image or PDF <input type="file" name="file" required accept="image/png,image/jpeg,image/webp,application/pdf"></label><button type="submit">Attach file</button></form>${discard}<a href="/messages/${escapeText(channelId)}">Back to conversation</a></main></body></html>`;
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
function escapeText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? '',
  );
}
