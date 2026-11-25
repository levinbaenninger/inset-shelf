import { CaptureChapters } from "@/components/capture-chapters";
import { Claim } from "@/components/claim";
import { Details } from "@/components/details";
import { Hero } from "@/components/hero";
import { Questions } from "@/components/questions";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Sources } from "@/components/sources";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="top">
        <Hero />
        <Claim />
        <CaptureChapters />
        <Sources />
        <Details />
        <Questions />
      </main>
      <SiteFooter />
    </>
  );
}
