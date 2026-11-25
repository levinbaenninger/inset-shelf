import type { ComponentProps } from "react";

// The platform marks from public/icons, drawn in the current colour so they sit on black and light buttons.

export function AppleGlyph(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 256 315" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M213.8 167c.4 47.6 41.7 63.4 42.2 63.6-.3 1.1-6.6 22.6-21.8 44.7-13.1 19.2-26.7 38.2-48.1 38.6-21.1.4-27.8-12.5-51.9-12.5-24.1 0-31.6 12.1-51.5 12.9-20.7.8-36.4-20.7-49.6-39.8-27-39-47.6-110.3-19.9-158.4 13.8-23.9 38.4-39 65.1-39.4 20.3-.4 39.5 13.7 51.9 13.7 12.4 0 35.7-16.9 60.2-14.4 10.3.4 39 4.1 57.5 31.2-1.5.9-34.3 20-34 59.8M174.2 50.2C185.2 36.9 192.6 18.4 190.6 0c-15.8.6-35 10.5-46.3 23.8-10.2 11.8-19.1 30.6-16.7 48.7 17.6 1.4 35.6-8.9 46.6-22.3" />
    </svg>
  );
}

export function WindowsGlyph(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M0 0h121.3v121.3H0zM134.7 0H256v121.3H134.7zM0 134.7h121.3V256H0zM134.7 134.7H256V256H134.7z" />
    </svg>
  );
}
