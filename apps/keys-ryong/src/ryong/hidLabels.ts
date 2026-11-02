// Key-cap labels for HID usages that ZMK Studio has no short name for.
//
// Studio falls back to the full HID name ("AC Desktop Show All Windows"), which spills out of the key.
// Here such names become readable words ("Show All Wins"); labels longer than a few letters are drawn
// smaller, on up to two lines (see .ry-key > span[data-ry-long] in ryong.css).

type Labels = { short?: string; med?: string; long?: string };

// Common media / system keys, named the way people know them.
const KNOWN: Record<string, Labels> = {
  "AC Desktop Show All Windows": { short: "Windows" },
  "AC Desktop Show All Applications": { short: "Apps" },
  "AC Search": { short: "Search" },
  "AC Find": { short: "Find" },
  "AC Home": { short: "Home" },
  "AC Back": { short: "Back" },
  "AC Forward": { short: "Forward" },
  "AC Refresh": { short: "Refresh" },
  "AC Stop": { short: "Stop" },
  "AC Bookmarks": { short: "Bookmarks" },
  "AC Zoom In": { short: "Zoom In" },
  "AC Zoom Out": { short: "Zoom Out" },
  "AC Full Screen View": { short: "Full Screen" },
  "AC Next Keyboard Layout Select": { short: "Next Layout" },
  "AL Calculator": { short: "Calc" },
  "AL Email Reader": { short: "Mail" },
  "AL Internet Browser": { short: "Web" },
  "AL Local Machine Browser": { short: "My Computer" },
  "AL Terminal Lock/Screensaver": { short: "Lock" },
  "AL Control Panel": { short: "Settings" },
  "AL Keyboard Layout": { short: "Keyboard Layout" },
  "AL Calendar/Schedule": { short: "Calendar" },
  "AL Contacts/Address Book": { short: "Contacts" },
  "Voice Command": { short: "Voice" },
  "Emoji Picker": { short: "Emoji" },
  "Dictation": { short: "Dictate" },
  "Do Not Disturb": { short: "Do Not Disturb" },
};

const PREFIXES = /^(AC|AL|Keyboard|Consumer|System|Display)\s+/;

const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

export function tidyLabels(labels: Labels): Labels {
  const full = labels.short;
  // Labels that Studio already shortened (have med/long) or that are already short stay as they are.
  if (!full || labels.med || labels.long || full.length <= 6) return labels;
  if (KNOWN[full]) return KNOWN[full];

  // Everything else: drop the "AC"/"AL"… prefix and keep it short enough for two small lines on a key.
  const name = full.replace(PREFIXES, "").replace(/\s*\/\s*/g, " / ");
  return { short: cut(name, 18) };
}
