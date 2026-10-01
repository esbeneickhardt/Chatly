// How to name an attachment where a *short label* is wanted (a reply
// quote, the "Replying to" banner) rather than the full file listing.
//
// The server stores — and every other place in the app shows — exactly
// the filename the uploader's device sent; there is no separate
// "original" vs. "hashed" name to choose between. But plenty of
// devices/apps send a name that's itself machine-generated: a phone
// camera's `17895058467123352784638444487746.jpg`, Windows' snipping
// tool's `{453C540C-C0CE-4F19-8A32-A371BDD48080}.png`, a social app's
// random token. Quoted verbatim in a one-line reply preview those tell
// the reader nothing, so they're replaced by what the file *is*
// ("Image", "Video", …) — the real name stays available as a tooltip.

const GUID_RE = /^[{(]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[})]?$/i;

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Whether `filename`'s base name reads as generated rather than
 * written by a person. Deliberately conservative — a wrongly-flagged
 * human name only costs a generic label (with the real name in the
 * tooltip), but the common generated shapes are all clear-cut:
 * GUIDs, long runs of digits/hex, and long random mixed-case tokens. */
export function looksMachineGenerated(filename: string): boolean {
  const base = stripExtension(filename).trim();
  if (base === "") return false;
  if (GUID_RE.test(base)) return true;

  // A long run of nothing but digits/hex (timestamps-as-names,
  // content hashes, phone-camera counters), ignoring separators.
  const compact = base.replace(/[-_. ]/g, "");
  if (compact.length >= 12 && /^[0-9a-f]+$/i.test(compact)) return true;

  // A long single token with no spaces whose case flips back and forth
  // and which contains digits — random base64/base62 ids. "MyHolidayPhoto"
  // flips a few times but has no digits and is short; sentences have spaces.
  if (base.length >= 20 && !/\s/.test(base) && /\d/.test(base)) {
    const flips = (base.match(/[a-z][A-Z]/g) ?? []).length;
    if (flips >= 5) return true;
  }
  return false;
}

/** A readable label for an attachment: its real filename, unless that
 * looks machine-generated, in which case a plain description of the
 * kind of file. */
export function friendlyFileLabel(filename: string, mime: string): string {
  if (!looksMachineGenerated(filename)) return filename;
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1) : "";
  return ext !== "" && ext.length <= 5 ? `${ext.toUpperCase()} file` : "File";
}
