type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ReportSubmission = 'received' | 'refused' | 'unavailable';

/** Posts a native form's fields; the handler validates them again. */
export async function submitReport(
  fetch: FetchLike,
  form: FormData,
): Promise<ReportSubmission> {
  try {
    const response = await fetch('/api/content-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetKind: form.get('targetKind'),
        targetId: form.get('targetId'),
        reason: form.get('reason'),
      }),
    });
    if (response.ok) return 'received';
    return response.status >= 500 ? 'unavailable' : 'refused';
  } catch {
    return 'unavailable';
  }
}

const answers: Readonly<Record<ReportSubmission, string>> = {
  received: 'Thanks. Your report reached the moderation team.',
  refused: 'That report could not be filed.',
  unavailable: 'Reporting is unavailable right now. Try again in a moment.',
};

/** What the reporter reads back; it never says what moderation decides. */
export const reportAnswerText = (result: ReportSubmission): string =>
  answers[result];

/** The notice a Round page came back with; anything else is dropped. */
export const reportNotice = (value: unknown): ReportSubmission | null =>
  value === 'received' || value === 'refused' || value === 'unavailable'
    ? value
    : null;
