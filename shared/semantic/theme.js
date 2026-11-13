// The calm theme as role styles: the colors of shared/xml-reference.md
// ("Color themes"), which are the colors draw.io's Fusion theme gives new
// shapes. The engine picks a role per node; the model never writes a style.

export const FONT_COLOR = "#1B1F24";

// fill / stroke per role
export const ROLES =
{
  step: { fill: "#EEF4FF", stroke: "#9DB8F2" },
  decision: { fill: "#FFF6E0", stroke: "#E8C36A" },
  start: { fill: "#E7F6EC", stroke: "#8BCB9F" },
  end: { fill: "#E7F6EC", stroke: "#8BCB9F" },
  success: { fill: "#E7F6EC", stroke: "#8BCB9F" },
  error: { fill: "#FDECEC", stroke: "#EBA3A3" },
  retry: { fill: "#FFF0E5", stroke: "#F0B48A" },
  data: { fill: "#F3EEFF", stroke: "#B9A6F0" },
  external: { fill: "#F2F4F7", stroke: "#B8C0CC" },
  note: { fill: "#FFF9DB", stroke: "#E9D58A" },
  container: { fill: "#F7F8FA", stroke: "#D5DAE1" }
};

export const EDGE = { stroke: "#8A94A6", font: "#5A626E" };
export const YES_COLOR = "#1E7F3E";
export const NO_COLOR = "#C9302C";

// Font sizes for the chat frame (shared/chat-view-xml.md, "Text" and "Grid"):
// shapes 14, edge labels 12, the title 20; diagrams of more than 12 shapes are
// shown smaller, so they get 16 and 14.
export function fontSizes(shapeCount)
{
  return shapeCount > 12 ? { shape: 16, edge: 14, title: 20 } : { shape: 14, edge: 12, title: 20 };
}

/**
 * The fill, stroke and font keys of a role.
 *
 * @param {string} role - a key of ROLES; unknown roles are steps
 * @returns {string} style fragment ending with ";"
 */
export function roleStyle(role)
{
  const r = ROLES[role] || ROLES.step;

  return "fillColor=" + r.fill + ";strokeColor=" + r.stroke + ";fontColor=" + FONT_COLOR + ";";
}
