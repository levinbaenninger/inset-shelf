export interface PinMarkerProps {
  readonly left: string;
  readonly top: string;
  /** The ring's width as a share of the image, so it matches the mark drawn into copied images. */
  readonly width: string;
}

/** A hollow ring, so the detail under the pin stays readable; drawn the same way into copied images. */
export const PinMarker = ({ left, top, width }: PinMarkerProps) => (
  <span
    aria-hidden="true"
    className="pin-marker"
    style={{ "--pin-w": width, "--pin-x": left, "--pin-y": top }}
  />
);
