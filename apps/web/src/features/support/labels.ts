import type { SupportTopic } from '@daisy/protocol/support-message';

/**
 * The words for each support topic, in the form's order: the form's options
 * and the owner's email read the same labels.
 */
export const supportTopicLabels: Readonly<Record<SupportTopic, string>> = {
  problem: 'Something isn’t working',
  question: 'A question',
  feedback: 'Feedback or an idea',
  account: 'My account or privacy',
  safety: 'A safety concern',
};
