import { roundJudgeMessages } from '@daisy/ai-voice';
import { transcriptEvidenceInput } from '../round-runtime/transcript-evidence';

export const frozenJudgingMessages = (
  input: Parameters<typeof transcriptEvidenceInput>[0],
) => roundJudgeMessages(transcriptEvidenceInput(input));
