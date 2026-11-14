// What a change of a diagram keeps: the layout of the earlier diagram as a
// short text, `layout` in the result of the tool, which the model passes back
// with the changed description (`layout` in the input). Nothing is stored
// anywhere: the server is stateless and keeps no diagrams, so the earlier
// layout travels with the model's call, and the text is all of it.
//
// It holds what the grid pass needs to put the changed description where the
// earlier one was (shared/grid-layout.js, `keep`): the orientation (turned or
// not), the spacing (tight, narrow boxes), the font size of the shapes, the
// size of every kind of box, and the center and size of every column and row
// of the page's grid by the number the model gave it. Columns and rows that
// the model numbered as before stay where they were and never shrink; a new
// number gets the room it needs and moves only what comes after it.
//
// Format, version 1, lowercase letters and digits with dots between parts:
//
//   1 <flags> <font> <id:2> . <w> <columns> . <w> <rows> . <kinds> . <check:2>
//
// Every number is base 36: flags (1 turned, 2 tight, 4 narrow boxes), the
// shapes' font size, `id` a hash of the type and the title (a layout is
// only used for a diagram with the same type and title), `w` the digits of
// the numbers of that axis (2, or 3 where a column of a page made wide is
// 1296 px or more), a column or row is 1 + 2w characters (twice the step
// from the model's number before it, the step of its center in px, its size
// in px), a kind six (a hash of its key, its width and height), and `check`
// a hash of everything before it, so a text the model didn't copy exactly
// is not used. A layout that doesn't fit the format (a number too large)
// isn't written.

export const KEEP_VERSION = "1";

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

// FNV-1a, 32 bit
function hash(text)
{
  let h = 0x811c9dc5;

  for (let i = 0; i < text.length; i++)
  {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return h >>> 0;
}

function fixed(n, width)
{
  const max = Math.pow(36, width);

  if (!Number.isInteger(n) || n < 0 || n >= max)
  {
    return null;
  }

  let s = n.toString(36);

  while (s.length < width)
  {
    s = "0" + s;
  }

  return s;
}

function read(s, at, width)
{
  const part = s.substr(at, width);

  if (part.length !== width || !/^[0-9a-z]+$/.test(part))
  {
    return NaN;
  }

  return parseInt(part, 36);
}

function hash2(text)
{
  return fixed(hash(text) % 1296, 2);
}

/** The hash a layout is tied to: the diagram's type and title. */
export function keepId(type, title)
{
  return hash2(String(type || "") + "\n" + String(title || "").trim());
}

/** The hash of a kind of box (grid-layout's kindKey). */
export function kindHash(key)
{
  return hash2(String(key));
}

function axisDigits(entries, width)
{
  let out = "";
  let m = 0;
  let c = 0;

  // Rounded down: a center or a size read back is never more than it was,
  // so the same description with its layout is drawn exactly as before
  // instead of a pixel further on.
  for (const e of entries)
  {
    const dm = fixed(Math.round((e.m - m) * 2), 1);
    const dc = fixed(Math.floor(e.c) - c, width);
    const s = fixed(Math.floor(e.s), width);

    if (dm == null || dc == null || s == null)
    {
      return null;
    }

    out += dm + dc + s;
    m = e.m;
    c = Math.floor(e.c);
  }

  return out;
}

// The axis with the fewest digits that hold its numbers.
function axisText(entries)
{
  for (let width = 2; width <= 3; width++)
  {
    const digits = axisDigits(entries, width);

    if (digits != null)
    {
      return width + digits;
    }
  }

  return null;
}

function readAxis(text)
{
  const out = [];
  const width = read(text, 0, 1);
  let m = 0;
  let c = 0;

  if ((width !== 2 && width !== 3) || (text.length - 1) % (1 + 2 * width) !== 0)
  {
    return null;
  }

  for (let i = 1; i < text.length; i += 1 + 2 * width)
  {
    const dm = read(text, i, 1);
    const dc = read(text, i + 1, width);
    const s = read(text, i + 1 + width, width);

    if (isNaN(dm) || isNaN(dc) || isNaN(s) || dm === 0)
    {
      return null;
    }

    m += dm / 2;
    c += dc;
    out.push({ m: m, c: c, s: s });
  }

  return out;
}

/**
 * The layout of a laid-out diagram as text, or null when there is nothing
 * to keep (no grid for the page) or it doesn't fit the format.
 *
 * @param {{policy: string, tight: boolean, dense: boolean, x: object[], y: object[],
 *   kinds: {key: string, w: number, h: number}[]}|null} keep - grid-layout's stats.keep
 * @param {{type: string, title: string, font: number}} diagram
 * @returns {string|null}
 */
export function encodeKeep(keep, diagram)
{
  if (keep == null || !Array.isArray(keep.x) || !Array.isArray(keep.y) || keep.x.length === 0 || keep.y.length === 0)
  {
    return null;
  }

  const flags = (keep.policy === "turned" ? 1 : 0) + (keep.tight ? 2 : 0) + (keep.dense ? 4 : 0);
  const font = fixed(Math.round(diagram.font || 0), 1);
  const x = axisText(keep.x);
  const y = axisText(keep.y);
  let kinds = "";

  for (const k of keep.kinds || [])
  {
    const w = fixed(Math.floor(k.w), 2);
    const h = fixed(Math.floor(k.h), 2);

    if (w == null || h == null)
    {
      return null;
    }

    kinds += kindHash(k.key) + w + h;
  }

  if (font == null || x == null || y == null)
  {
    return null;
  }

  const body = KEEP_VERSION + fixed(flags, 1) + font + keepId(diagram.type, diagram.title) + "." + x + "." + y + "." + kinds;

  return body + "." + hash2(body);
}

/**
 * Reads a layout the model passed back.
 *
 * @param {*} text - the `layout` of the input
 * @param {{type: string, title: string}} diagram - the changed description
 * @returns {{keep: object|null, error: string|null}} keep: what
 *   grid-layout's `keep` option takes, with `font` and `kinds.get(kindKey)`;
 *   error: why a layout that was given isn't used (null without one)
 */
export function decodeKeep(text, diagram)
{
  if (text == null || (typeof text === "string" && text.trim() === ""))
  {
    return { keep: null, error: null };
  }

  const s = String(text).trim().toLowerCase();
  const parts = s.split(".");

  if (parts.length !== 5 || parts[0].length !== 5 || parts[0].charAt(0) !== KEEP_VERSION ||
    hash2(parts.slice(0, 4).join(".")) !== parts[4])
  {
    return { keep: null, error: "not a layout from a result of this tool, or not copied exactly" };
  }

  if (parts[0].substr(3, 2) !== keepId(diagram.type, diagram.title))
  {
    return { keep: null, error: "the layout of a diagram with another type or title" };
  }

  const flags = read(parts[0], 1, 1);
  const font = read(parts[0], 2, 1);
  const x = readAxis(parts[1]);
  const y = readAxis(parts[2]);
  const kinds = new Map();

  if (x == null || y == null || isNaN(flags) || isNaN(font) || parts[3].length % 6 !== 0)
  {
    return { keep: null, error: "not a layout from a result of this tool, or not copied exactly" };
  }

  for (let i = 0; i < parts[3].length; i += 6)
  {
    kinds.set(parts[3].substr(i, 2), { w: read(parts[3], i + 2, 2), h: read(parts[3], i + 4, 2) });
  }

  return { error: null, keep: { policy: (flags & 1) ? "turned" : "", tight: (flags & 2) !== 0, dense: (flags & 4) !== 0,
    font: font, x: x, y: y, kinds: { get: function(key) { return kinds.get(kindHash(key)) || null; } } } };
}
