import { writeFileSync } from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(import.meta.dirname, "..");

/**
 * The Shelf mark on a 64-unit grid: the Inset mark (a frame with its bottom-right corner open)
 * with a running list set into that corner. The 4-unit stroke is 1 px in the 16 px tray icon
 * (4 units a pixel) and 2 px at @2x; the list lines and straight edges sit on whole pixels at both.
 * The frame ends stop one stroke short of the list, the same gap as between the list lines.
 */
const MARK = `<path d="M26 58H14A8 8 0 0 1 6 50V14A8 8 0 0 1 14 6H50A8 8 0 0 1 58 14V34"/><path d="M34 42H58M34 50H58M34 58H58"/>`;
const STROKE = `fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"`;
const BRAND = "#0069a8";

const traySvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g ${STROKE} stroke="${color}">${MARK}</g></svg>`;

// The mark spans 4–60 on both axes; scaled by 8 it is centred on the tile.
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<rect x="64" y="64" width="896" height="896" rx="200" fill="${BRAND}"/>
<g transform="translate(256 256) scale(8)" ${STROKE} stroke="#ffffff">${MARK}</g>
</svg>`;

const outputs: [svg: string, size: number, file: string][] = [
  [traySvg("#000000"), 16, "resources/trayTemplate.png"],
  [traySvg("#000000"), 32, "resources/trayTemplate@2x.png"],
  [traySvg(BRAND), 16, "resources/tray.png"],
  [traySvg(BRAND), 32, "resources/tray@2x.png"],
  // A dark Windows taskbar hides the brand blue; its icons are white there.
  [traySvg("#ffffff"), 16, "resources/tray-on-dark.png"],
  [traySvg("#ffffff"), 32, "resources/tray-on-dark@2x.png"],
  [appSvg, 1024, "build/icon.png"],
];

for (const [svg, size, file] of outputs) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();

  writeFileSync(path.join(root, file), png);
}
