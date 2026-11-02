import type { IconName } from "./keyLegend";

// One small icon set for the media and arrow keys, all drawn the same way (24 grid, 2px round strokes),
// so they read as one family on the caps instead of Studio's mix of colour emoji and text symbols.
const speaker = "M11 5 6 9H3v6h3l5 4z";
const sun = (rays: number) => (
  <>
    <circle cx="12" cy="12" r="3.5" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      return <line key={a} x1={12 + c * 6.5} y1={12 + s * 6.5} x2={12 + c * (6.5 + rays)} y2={12 + s * (6.5 + rays)} />;
    })}
  </>
);
const PATHS: Record<IconName, JSX.Element> = {
  "play-pause": (<><path d="M4 6v12l8-6z" /><line x1="16" y1="6" x2="16" y2="18" /><line x1="20" y1="6" x2="20" y2="18" /></>),
  mute: (<><path d={speaker} /><line x1="16" y1="9.5" x2="21" y2="14.5" /><line x1="21" y1="9.5" x2="16" y2="14.5" /></>),
  "vol-up": (<><path d={speaker} /><path d="M15 9.5a3.5 3.5 0 0 1 0 5" /><path d="M18 7a7 7 0 0 1 0 10" /></>),
  "vol-down": (<><path d={speaker} /><path d="M15 9.5a3.5 3.5 0 0 1 0 5" /></>),
  "bri-up": sun(3),
  "bri-down": sun(1.2),
  next: (<><path d="M5 6v12l9-6z" /><line x1="18" y1="6" x2="18" y2="18" /></>),
  prev: (<><path d="M19 6v12l-9-6z" /><line x1="6" y1="6" x2="6" y2="18" /></>),
  right: (<><line x1="5" y1="12" x2="19" y2="12" /><path d="m13 6 6 6-6 6" /></>),
  left: (<><line x1="19" y1="12" x2="5" y2="12" /><path d="m11 6-6 6 6 6" /></>),
  up: (<><line x1="12" y1="19" x2="12" y2="5" /><path d="m6 11 6-6 6 6" /></>),
  down: (<><line x1="12" y1="5" x2="12" y2="19" /><path d="m6 13 6 6 6-6" /></>),
};

export const KeyIcon = ({ name, label }: { name: IconName; label: string }) => (
  <svg className="ry-key-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
    {PATHS[name]}
  </svg>
);
