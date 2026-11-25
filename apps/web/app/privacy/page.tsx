import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL, RELEASES_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy · Inset Shelf",
  description:
    "What the Inset Shelf website and app do with your data: no cookies, no analytics, items kept on your computer.",
};

const Privacy = () => (
  <LegalPage title="Privacy" updated="25 November 2026">
    <p>
      This notice explains what personal data the Inset Shelf website and the
      Inset Shelf app process, in line with the Swiss Federal Act on Data
      Protection (revDSG). The short version: the website has no cookies, no
      analytics and no tracking, and the app keeps your items on your own
      computer.
    </p>

    <h2>Who is responsible</h2>
    <p>
      Levin Bänninger, <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      Write to this address for any question or request about your data.
    </p>

    <h2>Visiting this website</h2>
    <p>
      The site is a set of static pages served by Cloudflare Workers
      (Cloudflare, Inc.). To deliver a page, Cloudflare processes the standard
      data every web request carries, such as your IP address, your browser’s
      user agent, the address you asked for and the time, and keeps it in its
      logs. Cloudflare may process this data outside Switzerland, including in
      the United States. Its{" "}
      <a href="https://www.cloudflare.com/privacypolicy/">privacy policy</a>{" "}
      applies to that processing.
    </p>
    <ul>
      <li>The site sets no cookies and uses no local storage.</li>
      <li>There is no analytics, no tracking pixel and no advertising.</li>
      <li>
        Fonts, icons and scripts come from this site itself. The pages make no
        requests to Google Fonts or any other outside service.
      </li>
      <li>
        The docs search runs in your browser, from an index downloaded from this
        site. What you type is not sent anywhere.
      </li>
      <li>
        The shelf at the top of the home page works in your browser tab only.
        When you tap Shift twice, it reads the text you selected and shows it
        there; nothing is sent or stored, and it is gone when you reload. The
        Copy with Details button writes its sample text to your clipboard only
        when you click it.
      </li>
    </ul>

    <h2>Downloads and links to GitHub</h2>
    <p>
      The download buttons and the links to the source code, releases and issues
      go to GitHub (GitHub, Inc.). Once you follow one, GitHub processes your
      request under the{" "}
      <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">
        GitHub Privacy Statement
      </a>
      .
    </p>

    <h2>The Inset Shelf app</h2>
    <p>
      The app has no account and no server of its own. Your items, images, files
      and settings stay on your computer:
    </p>
    <ul>
      <li>
        The shelf is one file, <code>shelf.json</code>, with images and files in
        an <code>attachments</code> folder and the settings in{" "}
        <code>settings.json</code> next to it.
      </li>
      <li>
        Next to it, <code>shelf.json.prev</code> keeps the shelf as it was
        before the last save, so an item you deleted stays there until the next
        save, and its images and files until the app starts after that. If the
        app ever can’t read the shelf at launch, it keeps that file as{" "}
        <code>shelf.unreadable-&lt;date&gt;.json</code> and starts a new one.
      </li>
      <li>
        On macOS they are in{" "}
        <code>~/Library/Application Support/Inset Shelf</code>, on Windows in{" "}
        <code>%APPDATA%\Inset Shelf</code>.
      </li>
      <li>
        To save where an item came from, the app reads the app, window title and
        page address of the window in front, only with the permissions you
        granted. That stays in the same file.
      </li>
    </ul>
    <p>The app connects to the internet in these cases only:</p>
    <ul>
      <li>
        <strong>Updates.</strong> At launch and every four hours, the installed
        app checks the latest release on{" "}
        <a href={RELEASES_URL}>GitHub Releases</a> and downloads a newer build
        from there. GitHub sees the request, including your IP address. A copy
        run from a portable zip doesn’t check.
      </li>
      <li>
        <strong>Spell checking on Windows.</strong> The note field uses the
        spell checker built into Electron. On Windows it downloads a dictionary
        for your language from a Google server; your words are not sent. On
        macOS the system’s own spell checker is used.
      </li>
      <li>
        <strong>Links you open.</strong> Opening an item’s page or a link in a
        note hands it to your browser or to the app it belongs to.
      </li>
    </ul>

    <h2>Your rights</h2>
    <p>
      Under the revDSG you can ask what data about you is processed, and have it
      corrected or deleted. This website keeps no data about you itself; for the
      request logs, Cloudflare is the place to ask. To delete everything the app
      stored, quit it and delete its folder named above, with these copies.
      Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with any
      request.
    </p>

    <h2>Changes</h2>
    <p>
      If the website or the app starts to handle data differently, this page
      changes with it, and the date at the top moves.
    </p>
  </LegalPage>
);

export default Privacy;
