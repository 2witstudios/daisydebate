import {
  roundAnalysisSkills,
  roundAnalysisVersion,
  type RoundAnalysisReport,
} from './round-analysis';

/** A valid round analysis citing the line at segment 0, sequence 0. */
export const sampleRoundAnalysisReport: RoundAnalysisReport = {
  analysisVersion: roundAnalysisVersion,
  summary: 'You set up the access contention well and then let it drop.',
  improvements: ['Extend your first contention in every later speech.'],
  keyMoments: [
    {
      line: { segment: 0, sequence: 0 },
      happened: 'You claimed free transit improves access.',
      mattered: 'It was your strongest offense and went unanswered.',
      strongestReply: 'Weigh access against the cost argument explicitly.',
    },
  ],
  missedOpportunities: [],
  skills: Object.fromEntries(
    roundAnalysisSkills.map((skill) => [
      skill,
      { score: 3, note: 'Solid, with room to grow.' },
    ]),
  ) as RoundAnalysisReport['skills'],
  patterns: [],
};
