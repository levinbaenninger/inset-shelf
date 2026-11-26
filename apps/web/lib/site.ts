export const SITE_URL = "https://inset-shelf.levexis.workers.dev";

export const REPO_URL = "https://github.com/levinbaenninger/inset-shelf";

export const RELEASES_URL = `${REPO_URL}/releases`;

export const ISSUES_URL = `${REPO_URL}/issues`;

// Each build is a versioned release whose installers keep the same file names, so
// releases/latest/download always serves the newest one.
const LATEST = `${RELEASES_URL}/latest/download`;

export const DOWNLOADS = {
  mac: `${LATEST}/Inset-Shelf-mac-arm64.dmg`,
  macIntel: `${LATEST}/Inset-Shelf-mac-x64.dmg`,
  windows: `${LATEST}/Inset-Shelf-win-x64.exe`,
} as const;

export const CONTACT_EMAIL = "levin@baenninger.me";

export const NAV_LINKS = [
  { href: "/#capture", label: "Capture" },
  { href: "/#sources", label: "Sources" },
  { href: "/#details", label: "Details" },
  { href: "/#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

export const FIRST_OPEN =
  "The builds have no developer certificate. On a Mac, click Open Anyway in System Settings > Privacy & Security the first time.";
