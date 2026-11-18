import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// server.json is the MCP Registry manifest of io.draw/mcp (README, "Publishing
// to the MCP Registry"). The registry refuses the whole publish when its npm
// entry names a release of @drawio/mcp without mcpName, so the entry has to
// name a release from the first one with it up to the tool server's version.

const FIRST_WITH_MCP_NAME = "1.13.1";

function readJson(relative)
{
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const serverJson = readJson("../server.json");
const appPackage = readJson("../package.json");
const toolPackage = readJson("../../mcp-tool-server/package.json");

function compareVersions(a, b)
{
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);

  for (let i = 0; i < 3; i++)
  {
    if (left[i] !== right[i])
    {
      return left[i] - right[i];
    }
  }

  return 0;
}

test("server.json keeps its version in lockstep with the app server", function()
{
  assert.equal(serverJson.version, appPackage.version);
});

test("server.json lists the tool server's npm package under the name it declares", function()
{
  const npm = serverJson.packages.filter(function(entry)
  {
    return entry.registryType === "npm";
  });

  assert.equal(npm.length, 1);
  assert.equal(npm[0].identifier, toolPackage.name);
  assert.equal(npm[0].transport.type, "stdio");
  assert.equal(toolPackage.mcpName, serverJson.name);
});

test("server.json names a tool server release that carries mcpName", function()
{
  const version = serverJson.packages[0].version;

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(compareVersions(version, FIRST_WITH_MCP_NAME) >= 0,
    version + " was published without mcpName, which the registry refuses");
  assert.ok(compareVersions(version, toolPackage.version) <= 0,
    version + " is newer than the tool server's " + toolPackage.version);
});
