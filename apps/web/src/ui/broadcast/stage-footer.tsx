import { DaisyMark } from '../components/daisy-mark/daisy-mark';

/** The branding bar, below every tile: this video is also the streamers' official feed. */
export function StageFooter({ siteLink }: { readonly siteLink: string }) {
  return (
    <footer className="broadcast-stage-brand">
      <span>
        <DaisyMark size={24} variant="reverse" />
        Daisy Debate
      </span>
      <span>{siteLink}</span>
    </footer>
  );
}
