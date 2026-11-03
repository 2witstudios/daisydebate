import type { ContentReportReason } from '@daisy/protocol';

export const reportReasonLabels: Readonly<Record<ContentReportReason, string>> =
  {
    harassment: 'Harassment',
    hate: 'Hate',
    sexual_content: 'Sexual content',
    violence: 'Violence or threats',
    self_harm: 'Self-harm',
    impersonation: 'Impersonation',
    spam: 'Spam',
    other: 'Something else',
    result_dispute: 'Dispute the result',
    integrity_concern: 'Integrity concern',
    abusive_feedback: 'Abusive feedback',
  };
