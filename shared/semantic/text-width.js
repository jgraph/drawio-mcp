// Text widths without a DOM, for sizing shapes to their labels.
//
// The engine runs where there is no canvas to measure text on (the
// Cloudflare Worker, Node), so it estimates widths from font metrics:
// the advance widths of Helvetica and Helvetica Bold (Adobe's core font
// metrics, in 1/1000 em) for printable ASCII. draw.io's default font is
// Helvetica, and the fonts browsers use in its place (Arial, Liberation Sans)
// share these widths. Other characters take the width of a lowercase letter,
// wide East Asian characters and emoji a full em.

// Advance widths of the characters 32 (space) to 126 (~), in that order.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

function isWide(code)
{
  return (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0xA4CF) ||
    (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF00 && code <= 0xFF60) ||
    (code >= 0xFFE0 && code <= 0xFFE6) || code >= 0x1F000;
}

/**
 * Estimated width in px of one line of text.
 *
 * @param {string} text - plain text, one line
 * @param {number} fontSize - in px
 * @param {boolean} [bold]
 * @returns {number}
 */
export function textWidth(text, fontSize, bold)
{
  const table = bold ? BOLD : REGULAR;
  let em = 0;

  for (const ch of String(text))
  {
    const code = ch.codePointAt(0);

    if (code >= 32 && code <= 126)
    {
      em += table[code - 32];
    }
    else if (isWide(code))
    {
      em += 1000;
    }
    else
    {
      em += bold ? 611 : 556;
    }
  }

  return em * fontSize / 1000;
}

/**
 * Width of the widest line of a multi-line text.
 *
 * @param {string} text - lines separated by \n
 * @param {number} fontSize
 * @param {boolean} [bold]
 * @returns {number}
 */
export function blockWidth(text, fontSize, bold)
{
  return String(text).split("\n").reduce(function(max, line)
  {
    return Math.max(max, textWidth(line, fontSize, bold));
  }, 0);
}
