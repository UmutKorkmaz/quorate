import { Seo } from "../components/Seo";
import { Hero } from "../components/Hero";
import { SolanaAppExample } from "../components/SolanaAppExample";
import { TerminalShowcase } from "../components/TerminalShowcase";
import { HowItWorks } from "../components/HowItWorks";
import { WhatIsQuorate } from "../components/WhatIsQuorate";
import { FeatureCards } from "../components/FeatureCards";
import { ProviderStrip } from "../components/ProviderStrip";
import { QuickStart } from "../components/QuickStart";
import { GitHubAction } from "../components/GitHubAction";
import { FAQ } from "../components/FAQ";
import {
  NPM_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL
} from "../lib/site";

const softwareApplicationLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Cross-platform",
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  downloadUrl: NPM_URL,
  softwareHelp: `${SITE_URL}/docs/faq`,
  author: {
    "@type": "Person",
    name: "Umut Korkmaz",
    url: "https://github.com/UmutKorkmaz"
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD"
  }
};

export function Home() {
  return (
    <>
      <Seo
        title={SITE_NAME}
        description={SITE_DESCRIPTION}
        path="/"
        jsonLd={softwareApplicationLd}
        ogType="website"
      />
      <Hero />
      <SolanaAppExample />
      <TerminalShowcase />
      <HowItWorks />
      <WhatIsQuorate />
      <FeatureCards />
      <ProviderStrip />
      <QuickStart />
      <GitHubAction />
      <FAQ />
    </>
  );
}
