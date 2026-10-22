/** Fixed text only; no raw error, receipt identity or request data is interpolated. */
export function nativeAttendanceResponse(
  response: Response,
  roundId: string,
): Response {
  const recorded = response.ok;
  const title = recorded
    ? 'Attendance recorded'
    : response.status === 503
      ? 'Attendance not confirmed'
      : 'Attendance not recorded';
  const message = recorded
    ? 'Your check-in for this speech has been recorded.'
    : response.status === 503
      ? 'Confirmation is pending. Return to the round and retry your check-in.'
      : 'This request could not record attendance. Return to the round and submit for an eligible speech window.';
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>${message}</p><a href="/rounds/${encodeURIComponent(roundId)}">Return to the round</a></html>`,
    {
      status: response.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}
