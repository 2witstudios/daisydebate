/** The right sidebar's tabs, the same in every Round. */
export type SidebarTab = 'transcript' | 'channels' | 'ai';
export const sidebarTabs: readonly SidebarTab[] = [
  'transcript',
  'channels',
  'ai',
];

/** A phone shows one panel at a time; the sidebar's tabs are among them. */
export type PhonePanel = 'doc' | SidebarTab | 'files' | 'room';

/** Which region a phone shows; the sidebar's own tab says which of its panels. */
export type PhoneView = 'doc' | 'sidebar' | 'files' | 'room';
export const phonePanels: readonly PhonePanel[] = [
  'doc',
  ...sidebarTabs,
  'files',
  'room',
];

export type Channel = {
  readonly id: string;
  readonly title: string;
};

export type Agent = {
  readonly id: string;
  readonly title: string;
};
