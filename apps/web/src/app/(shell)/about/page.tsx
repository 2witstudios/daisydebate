import type { Metadata } from 'next';
import { requestAudienceLinks } from '../audience-links';
import { AboutPage } from '../../../ui/about/about-page/about-page';

export const metadata: Metadata = {
  title: 'About Daisy',
  alternates: { canonical: '/about' },
};

/** Public: Daisy's vision, and where its common questions are answered. */
export default async function About() {
  return <AboutPage audience={await requestAudienceLinks()} />;
}
