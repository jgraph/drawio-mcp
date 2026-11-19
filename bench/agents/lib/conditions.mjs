// The conditions and prompts of the cross-agent measurement, shared by its
// scripts.

import fs from "node:fs";
import path from "node:path";
import { BENCH } from "../../lib/common.mjs";

export const CONDITIONS =
{
  plain: { label: "on its own" },
  mcp: { mcp: "hosted", label: "draw.io MCP server" },
  plugin: { plugin: true, label: "draw.io plugin" },
  mermaid: { suffix: " Write it in Mermaid and save it as diagram.mmd.", label: "asked for Mermaid" },
  svg: { suffix: " Draw it as an SVG image and save it as diagram.svg.", label: "asked for SVG" },
  drawio: { suffix: " Make it a draw.io diagram and save it as diagram.drawio.", label: "asked for draw.io XML" },
  fast: { mcp: "fast", types: ["flowchart", "swimlane"], label: "draw.io fast mode" }
};

/**
 * The sets of conditions the judge compares: what draw.io adds to what the
 * agent does on its own, and the formats on the same request.
 */
export const SETS =
{
  help: ["plain", "mcp", "plugin"],
  formats: ["mermaid", "svg", "drawio", "fast"]
};

/** The prompts of agents/prompts.json by key: { type, prompt }. */
export function loadAgentPrompts()
{
  return JSON.parse(fs.readFileSync(path.join(BENCH, "agents", "prompts.json"), "utf8"));
}

/** The tag of one session's files: <condition>-<key>-<agent>-<repeat>. */
export function tagOf(condition, key, agent, repeat)
{
  return [condition, key, agent, repeat].join("-");
}

/** --name a,b as a list, else the default. */
export function listArg(v, d)
{
  return String(v == null || v === true ? d : v).split(",");
}
