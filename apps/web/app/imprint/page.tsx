import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL, ISSUES_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Imprint · Inset Shelf",
  description: "Who runs the Inset Shelf website and how to reach them.",
};

const Imprint = () => (
  <LegalPage title="Imprint" updated="25 November 2026">
    <h2>Responsible for this website</h2>
    <p>
      Levin Bänninger
      <br />
      Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </p>
    <p>
      Inset Shelf is a non-commercial project. It sells nothing, shows no ads
      and the app is free to download.
    </p>
    <p>
      For bugs and questions about the app, the quickest way is an{" "}
      <a href={ISSUES_URL}>issue on GitHub</a>.
    </p>

    <h2>Links to other websites</h2>
    <p>
      This site links to other websites, mostly GitHub, where the downloads and
      the source code are. Their owners are responsible for what they publish.
      If a link leads somewhere it shouldn’t, please write and it will be
      removed.
    </p>

    <h2>Trademarks</h2>
    <p>
      The names and logos of other products shown on this site, such as GitHub,
      Claude, ChatGPT and Figma, belong to their owners. They appear only to
      show which apps and pages Inset Shelf can name.
    </p>
  </LegalPage>
);

export default Imprint;
