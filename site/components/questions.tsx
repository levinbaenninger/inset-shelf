import { SOURCE } from "@/lib/site";
import { cn } from "@/lib/utils";

import { Heading, Section } from "./section";

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
    a: "It checks for a newer build at launch and every four hours, and installs it when you restart or quit.",
    // left out from 1024 to 1279px, where four answers fill the screen
    wideOnly: true,
  },
  {
    q: "Where does the shelf keep my items?",
    a: "On your computer, in one file called shelf.json, with images and files in a folder beside it.",
  },
  {
    q: "Is Inset finished?",
    a: "No. It is the third Inset prototype, from a school innovation project, built to test a running list beside your work.",
  },
];

const PLATFORMS = [
  { icon: "apple", w: 27, label: "macOS, Apple silicon and Intel" },
  { icon: "microsoft-windows-icon", w: 32, label: "Windows 11" },
];

export function Questions() {
  return (
    <Section id="questions" aria-labelledby="questions-h">
      <div className="wrap grid grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-12 flex flex-col items-start gap-6 sm:col-span-5">
          <Heading id="questions-h">Questions about the test build</Heading>
          <div className="flex flex-col gap-3">
            {PLATFORMS.map((platform) => (
              <p key={platform.icon} className="flex items-center gap-3">
                <img src={`/icons/${platform.icon}.svg`} alt="" width={platform.w} height={32} loading="lazy" className="h-8 w-auto" />
                {platform.label}
              </p>
            ))}
          </div>
          <a href={SOURCE.href} className="link-draw group font-medium">
            {SOURCE.label} <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-[3px]">→</span>
          </a>
        </div>
        <dl className="col-span-12 sm:col-span-7 sm:col-start-6 lg:col-span-6 lg:col-start-7">
          {QUESTIONS.map((item) => (
            <div
              key={item.q}
              className={cn("grid gap-2 border-b py-5 first:pt-0", item.wideOnly && "lg:max-xl:hidden")}
            >
              <dt className="text-lead font-medium">{item.q}</dt>
              <dd className="text-foreground/85">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
