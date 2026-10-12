/**
 * Minimal stroke icons, 20x20, currentColor. Hand-rolled rather than adding an
 * icon library for a handful of glyphs. Every use pairs the icon with a text label
 * elsewhere in the control -- icons here are reinforcement, never the only
 * identifier of what a button does.
 */
type IconProps = { className?: string };

const base = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconPin({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 18s6-5.2 6-9.6A6 6 0 0 0 4 8.4C4 12.8 10 18 10 18Z" />
      <circle cx="10" cy="8.3" r="2.2" />
    </svg>
  );
}




export function IconDownload({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3v9.5" />
      <path d="M6 9.2 10 13l4-3.8" />
      <path d="M3.5 15v1.3A1.7 1.7 0 0 0 5.2 18h9.6a1.7 1.7 0 0 0 1.7-1.7V15" />
    </svg>
  );
}




export function IconLayers({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3 3 7.2 10 11.4l7-4.2L10 3Z" />
      <path d="M3 11l7 4.2L17 11" />
    </svg>
  );
}
