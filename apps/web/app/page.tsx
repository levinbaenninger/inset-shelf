import { Capture } from "@/components/capture";
import { Closing } from "@/components/closing";
import { Details } from "@/components/details";
import { Faq } from "@/components/faq";
import { Hero } from "@/components/hero";
import { Divider } from "@/components/section";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Sources } from "@/components/sources";
import { Statement } from "@/components/statement";

const Home = () => (
  <>
    <SiteHeader />
    <main id="main">
      <Hero />
      <div className="rails border-rail md:border-x">
        <Capture />
        <Divider />
        <Statement />
        <Divider />
        <Sources />
        <Divider />
        <Details />
        <Divider />
        <Faq />
      </div>
      <Closing />
    </main>
    <SiteFooter />
  </>
);

export default Home;
