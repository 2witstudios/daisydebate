export type MockDebate = {
  readonly topic: string;
  readonly viewers: number;
  readonly challenger: string;
  readonly defender: string;
};

export const debates: readonly MockDebate[] = [
  {
    topic: 'Climate Change Policies Are Effective',
    viewers: 412,
    challenger: 'Maya Singh',
    defender: 'Daniel Kim',
  },
  {
    topic: 'AI Will Create More Jobs Than It Destroys',
    viewers: 267,
    challenger: 'Sophia Lee',
    defender: 'Marcus Bell',
  },
];
