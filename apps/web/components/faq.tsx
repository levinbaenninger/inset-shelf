import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { REPO_URL } from "@/lib/site";

import { AppleGlyph, WindowsGlyph } from "./glyphs";
import { Section } from "./section";

const QUESTIONS = [
  {
    q: "Does it run on Windows?",
    a: "Yes, on Windows 11. The download page has the Windows installer beside the Mac builds for Apple silicon and Intel.",
  },
  {
    q: "Why is the download blocked at first?",
    a: "macOS blocks it because the builds are not signed with a developer certificate. Click Open Anyway in System Settings, under Privacy & Security, once.",
  },
  {
    q: "How does the download update?",
    a: "The Mac builds and the Windows installer check for a newer build at launch and every four hours. The portable Windows zip does not update itself.",
  },
  {
    q: "Where does the shelf keep my items?",
    a: "On your computer, in one file called shelf.json, with images and files in a folder beside it.",
  },
  {
    q: "Is Inset Shelf finished?",
    a: "No. It is the third Inset prototype, built to test a running list beside your work.",
  },
];

export const Faq = () => (
  <Section id="faq" aria-labelledby="faq-h">
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
      <div className="flex flex-col items-start lg:col-span-5">
        <h2 id="faq-h" className="text-title">
          Questions about the test build
        </h2>
        <p className="text-lead text-muted-foreground mt-5 max-w-[36ch]">
          Everything else, from permissions to keys, is in the{" "}
          <a
            href={`${REPO_URL}#readme`}
            className="text-brand underline-offset-4 hover:underline"
          >
            README
          </a>
          .
        </p>
        <ul className="mt-8 grid gap-3 text-[15px]">
          <li className="flex items-center gap-3">
            <AppleGlyph className="size-[18px]" />
            macOS, Apple silicon and Intel
          </li>
          <li className="flex items-center gap-3">
            <WindowsGlyph className="size-4 text-[#0078d4]" />
            Windows 11
          </li>
        </ul>
      </div>
      <Accordion
        type="single"
        collapsible
        defaultValue={QUESTIONS[0].q}
        className="lg:col-span-7"
      >
        {QUESTIONS.map((item) => (
          <AccordionItem
            key={item.q}
            value={item.q}
            className="border-b first:border-t"
          >
            <AccordionTrigger className="py-5 text-[17px] tracking-[-0.015em] hover:no-underline">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground max-w-[60ch] pb-6 text-[15px] leading-6">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  </Section>
);
