import { writeFileSync } from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(import.meta.dirname, "..");

/** The Inset mark from the brand folder (brand/inset/inset-mark.svg), on a 64-unit grid. */
const MARK = `<path d="M20 8H44C50.627 8 56 13.373 56 20V29H50V20C50 16.686 47.314 14 44 14H20C16.686 14 14 16.686 14 20V44C14 47.314 16.686 50 20 50H29V56H20C13.373 56 8 50.627 8 44V20C8 13.373 13.373 8 20 8Z"/><rect x="36" y="36" width="20" height="20" rx="6"/>`;
const BRAND = "#0069a8";

const traySvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 56 56"><g fill="${color}">${MARK}</g></svg>`;

const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<rect x="64" y="64" width="896" height="896" rx="200" fill="${BRAND}"/>
<g transform="translate(224 224) scale(9)" fill="#ffffff">${MARK}</g>
</svg>`;

const outputs: [svg: string, size: number, file: string][] = [
  [traySvg("#000000"), 16, "resources/trayTemplate.png"],
  [traySvg("#000000"), 32, "resources/trayTemplate@2x.png"],
  [traySvg(BRAND), 16, "resources/tray.png"],
  [traySvg(BRAND), 32, "resources/tray@2x.png"],
  [appSvg, 1024, "build/icon.png"],
];

for (const [svg, size, file] of outputs) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();

  writeFileSync(path.join(root, file), png);
}
