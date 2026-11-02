export type MockDebate = {
  readonly topic: string;
  readonly spectators: number;
  readonly challenger: string;
  readonly defender: string;
};

export const debates: readonly MockDebate[] = [
  {
    topic: 'Climate Change Policies Are Effective',
    spectators: 412,
    challenger: 'Maya Singh',
    defender: 'Daniel Kim',
  },
  {
    topic: 'AI Will Create More Jobs Than It Destroys',
    spectators: 267,
    challenger: 'Sophia Lee',
    defender: 'Marcus Bell',
  },
];
