import "react";

// Custom properties carry the few values the page computes at run time, such as where a pin was dropped.
declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
