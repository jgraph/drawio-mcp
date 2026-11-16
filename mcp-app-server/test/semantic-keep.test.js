import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, resolveSemanticTypes } from "../src/shared.js";
import { semanticToXml } from "../../shared/semantic/index.js";
import { encodeKeep, decodeKeep, keepId } from "../../shared/semantic/keep.js";

// A change of a diagram drawn from a description keeps what it doesn't
// touch in place: the result has the layout (shared/semantic/keep.js), the
// model passes it back with the changed description, and the grid pass
// (shared/grid-layout.js, `keep`) puts every column and row the model
// numbered as before where it was. Nothing is stored on the server.

const LANES =
{
  type: "swimlane",
  title: "Refund",
  groups: [{ id: "customer", label: "Customer" }, { id: "agent", label: "Agent" }],
  nodes:
  [
    { id: "ask", label: "Ask for refund", kind: "start", group: "customer", row: 1, col: 1 },
    { id: "check", label: "Check the order", kind: "step", group: "agent", row: 2, col: 1 },
    { id: "ok", label: "Within 30 days?", kind: "decision", group: "agent", row: 2, col: 2 },
    { id: "pay", label: "Pay back", kind: "step", group: "agent", row: 2, col: 3 },
    { id: "done", label: "Refund received", kind: "end", group: "customer", row: 1, col: 3 },
    { id: "no", label: "Decline", kind: "end", group: "agent", row: 3, col: 2 }
  ],
  edges:
  [
    { from: "ask", to: "check" },
    { from: "check", to: "ok" },
    { from: "ok", to: "pay", label: "Yes" },
    { from: "ok", to: "no", label: "No" },
    { from: "pay", to: "done" }
  ]
};

// n steps over three lanes, one column per step
function lanes(n)
{
  const groups = [{ id: "a", label: "Customer" }, { id: "b", label: "Support" }, { id: "c", label: "Finance" }];
  const nodes = [];
  const edges = [];

  for (let i = 1; i <= n; i++)
  {
    nodes.push({ id: "s" + i, label: "Step " + i + " of the work", kind: (i === 1) ? "start" : (i === n ? "end" : "step"),
      group: groups[i % 3].id, row: (i % 3) + 1, col: i });

    if (i > 1)
    {
      edges.push({ from: "s" + (i - 1), to: "s" + i });
    }
  }

  return { type: "swimlane", title: "Process", groups: groups, nodes: nodes, edges: edges };
}

function changed(d, patch)
{
  return Object.assign({}, d, patch);
}

// The vertices with their absolute position and size.
function positions(xml)
{
  const cells = new Map();
  const re = /<mxCell id="([^"]+)"([^>]*)>\s*<mxGeometry([^>]*?)\/?>/g;
  let m;

  while ((m = re.exec(xml)) != null)
  {
    if (!/vertex="1"/.test(m[2]))
    {
      continue;
    }

    const attrs = m[3];
    const num = function(name)
    {
      const a = new RegExp("\\b" + name + "=\"([^\"]*)\"").exec(attrs);

      return (a != null) ? Number(a[1]) : 0;
    };

    cells.set(m[1], { parent: /parent="([^"]*)"/.exec(m[2])[1], x: num("x"), y: num("y"), w: num("width"), h: num("height") });
  }

  const abs = new Map();
  const at = function(id)
  {
    if (abs.has(id))
    {
      return abs.get(id);
    }

    const c = cells.get(id);

    if (c == null)
    {
      return { x: 0, y: 0 };
    }

    const p = at(c.parent);
    const r = { x: p.x + c.x, y: p.y + c.y, w: c.w, h: c.h };

    abs.set(id, r);

    return r;
  };

  for (const id of cells.keys())
  {
    at(id);
  }

  return abs;
}

// The ids whose shape is somewhere else or has another size.
function moved(beforeXml, afterXml, ids)
{
  const a = positions(beforeXml);
  const b = positions(afterXml);

  return ids.filter(function(id)
  {
    const p = a.get(id);
    const q = b.get(id);

    return p == null || q == null || Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1 ||
      Math.abs(p.w - q.w) > 1 || Math.abs(p.h - q.h) > 1;
  });
}

function draw(d)
{
  return semanticToXml(d, { hints: "ask" });
}

function shapeFont(xml, id)
{
  const m = new RegExp("<mxCell id=\"" + id + "\"[^>]*style=\"[^\"]*fontSize=(\\d+)").exec(xml);

  return (m != null) ? Number(m[1]) : null;
}

test("the layout is a short text that reads back as it was written", function()
{
  const keep = { policy: "turned", tight: true, dense: false,
    x: [{ m: 1, c: 80, s: 160 }, { m: 2, c: 300, s: 200 }, { m: 2.5, c: 420, s: 140 }],
    y: [{ m: 1, c: 30, s: 60 }, { m: 3, c: 1500, s: 1400 }],
    kinds: [{ key: "a|rect|10", w: 160, h: 60 }, { key: "b|rhombus|0", w: 200, h: 90 }] };
  const text = encodeKeep(keep, { type: "swimlane", title: "Refund", font: 14 });
  const back = decodeKeep(text, { type: "swimlane", title: "Refund" });

  assert.match(text, /^[0-9a-z.]+$/);
  assert.ok(text.length < 60, text);
  assert.equal(back.error, null);
  assert.equal(back.keep.policy, "turned");
  assert.equal(back.keep.tight, true);
  assert.equal(back.keep.dense, false);
  assert.equal(back.keep.font, 14);
  assert.deepEqual(back.keep.x, keep.x);
  // a size of 1296 px or more takes three digits on its axis
  assert.deepEqual(back.keep.y, keep.y);
  assert.deepEqual(back.keep.kinds.get("b|rhombus|0"), { w: 200, h: 90 });
  assert.equal(back.keep.kinds.get("c|ellipse|0"), null);
  // any case, and space around it
  assert.equal(decodeKeep(" " + text.toUpperCase() + "\n", { type: "swimlane", title: "Refund" }).error, null);
  // none is no error
  assert.deepEqual(decodeKeep("", { type: "swimlane", title: "Refund" }), { keep: null, error: null });
  assert.deepEqual(decodeKeep(undefined, { type: "swimlane", title: "Refund" }), { keep: null, error: null });
  // a number too large for the format: no layout rather than a wrong one
  assert.equal(encodeKeep(Object.assign({}, keep, { y: [{ m: 1, c: 30, s: 50000 }] }), { type: "swimlane", title: "", font: 14 }), null);
  assert.equal(encodeKeep(null, { type: "swimlane", title: "", font: 14 }), null);
  // tied to the type and the title
  assert.equal(keepId("swimlane", "Refund"), keepId("swimlane", " Refund "));
  assert.notEqual(keepId("swimlane", "Refund"), keepId("flowchart", "Refund"));
});

test("every number a description takes for a cell is written and read back", function()
{
  const diagram = { type: "flowchart", title: "Numbers" };
  const axis = function(numbers)
  {
    return numbers.map(function(m, i) { return { m: m, c: 80 + 200 * i, s: 160 }; });
  };

  // from 0, a first number of 18 or more, gaps of more than 17, halves, up to 1000
  for (const numbers of [[0, 1, 2], [0], [18, 19], [1, 20, 21], [0.5, 40.5, 41], [1, 999.5, 1000], [36, 1000]])
  {
    const keep = { policy: "", tight: false, dense: false, x: axis(numbers), y: axis(numbers.slice().reverse().map(function(n)
    {
      return 1000 - n;
    })), kinds: [] };
    const text = encodeKeep(keep, Object.assign({ font: 14 }, diagram));
    const back = decodeKeep(text, diagram);

    assert.equal(back.error, null, numbers.join(",") + ": " + text);
    assert.deepEqual(back.keep.x, keep.x, text);
    assert.deepEqual(back.keep.y, keep.y, text);
  }

  // a number between halves can't be written: no layout rather than a wrong one
  assert.equal(encodeKeep({ policy: "", tight: false, dense: false, x: axis([1, 1.25]), y: axis([1]), kinds: [] },
    Object.assign({ font: 14 }, diagram)), null);
});

test("a layout that wasn't copied exactly, or is another diagram's, is not used", function()
{
  const text = encodeKeep({ policy: "", tight: false, dense: false, x: [{ m: 1, c: 80, s: 160 }], y: [{ m: 1, c: 30, s: 60 }],
    kinds: [] }, { type: "flowchart", title: "Login", font: 14 });
  const diagram = { type: "flowchart", title: "Login" };

  // one character changed, one left out, one added
  for (const wrong of [text.slice(0, 8) + (text.charAt(8) === "1" ? "2" : "1") + text.slice(9), text.slice(0, -3) + text.slice(-2),
    text.slice(0, 7) + "0" + text.slice(7), "nonsense", "{}"])
  {
    assert.match(decodeKeep(wrong, diagram).error, /not copied exactly/, wrong);
  }

  assert.match(decodeKeep(text, { type: "flowchart", title: "Logout" }).error, /another type or title/);
  assert.match(decodeKeep(text, { type: "swimlane", title: "Login" }).error, /another type or title/);
});

test("a description drawn with its own layout is drawn as before", async function()
{
  for (const d of [LANES, lanes(4), lanes(9), lanes(14)])
  {
    const first = await draw(d);
    const again = await draw(changed(d, { layout: first.layout }));

    assert.ok(typeof first.layout === "string" && first.layout.length > 20, first.layout);
    assert.deepEqual(again.warnings, []);
    assert.equal(again.stats.kept, true);
    assert.deepEqual(moved(first.xml, again.xml, Array.from(positions(first.xml).keys())), [], d.title + " " + d.nodes.length);
    assert.equal(again.layout, first.layout);
  }
});

test("a diagram numbered from 0 or with gaps keeps its layout", async function()
{
  const d = changed(LANES, { nodes: LANES.nodes.map(function(n)
  {
    return Object.assign({}, n, { row: n.row - 1, col: (n.col === 3) ? 25 : n.col - 1 });
  }) });
  const first = await draw(d);
  const again = await draw(changed(d, { layout: first.layout }));

  assert.ok(typeof first.layout === "string", String(first.layout));
  assert.deepEqual(again.warnings, []);
  assert.equal(again.stats.kept, true);
  assert.equal(again.xml, first.xml);
});

// A flowchart without lanes: n steps down one column, with a check beside
// the second one.
function steps(n)
{
  const nodes = [{ id: "check", label: "Is the order complete?", kind: "decision", row: 2, col: 2 }];
  const edges = [{ from: "s2", to: "check" }];

  for (let i = 1; i <= n; i++)
  {
    nodes.push({ id: "s" + i, label: "Step " + i + " of the order", kind: (i === 1) ? "start" : (i === n ? "end" : "step"),
      row: i, col: 1 });

    if (i > 1)
    {
      edges.push({ from: "s" + (i - 1), to: "s" + i });
    }
  }

  return { type: "flowchart", title: "Order", nodes: nodes, edges: edges };
}

// Whether the chat would show a page of the size in stats cut off at the
// bottom (isCut in shared/grid-layout.js, frame 736 x 664).
function cutOff(stats)
{
  const whole = Math.min(736 / stats.width, 664 / stats.height, 1);

  return whole < 0.75 && Math.min(736 / stats.width, 0.75) > whole * 1.05;
}

test("a page without lanes that a change makes too tall is made wider, and its shapes move together", async function()
{
  const first = await draw(steps(8));
  const more = steps(12);
  const fresh = await draw(more);
  const kept = await draw(changed(more, { layout: first.layout }));
  const ids = ["check"].concat(steps(8).nodes.slice(1, 8).map(function(n) { return n.id; }));
  const a = positions(first.xml);
  const b = positions(kept.xml);

  assert.equal(cutOff(first.stats), false);
  assert.equal(cutOff(fresh.stats), false);
  assert.equal(kept.stats.kept, true);
  // shown whole like the same description laid out anew, not cut off
  assert.equal(cutOff(kept.stats), false, kept.stats.width + " x " + kept.stats.height);
  assert.ok(kept.stats.width > first.stats.width * 1.5, kept.stats.width + " " + first.stats.width);

  // one shift for all of them, across and down, so none moves against another
  const dx = b.get("s1").x - a.get("s1").x;
  const dy = b.get("s1").y - a.get("s1").y;

  assert.ok(dx > 100, "shift " + dx);

  for (const id of ids)
  {
    assert.ok(Math.abs(b.get(id).x - a.get(id).x - dx) <= 1 && Math.abs(b.get(id).y - a.get(id).y - dy) <= 1, id);
    assert.equal(b.get(id).w, a.get(id).w, id);
  }

  // the layout of the result is without the shift: drawn again with it, the
  // page is the same, and the next change starts from where the steps are
  const again = await draw(changed(more, { layout: kept.layout }));

  assert.equal(again.xml, kept.xml);
});

test("a step added at the end moves nothing that was there, the lanes grow", async function()
{
  const first = await draw(LANES);
  const more = changed(LANES,
  {
    nodes: LANES.nodes.concat([{ id: "mail", label: "Send a receipt", kind: "step", group: "agent", row: 2, col: 4 }]),
    edges: LANES.edges.filter(function(e) { return e.to !== "done"; }).concat([{ from: "pay", to: "mail" }, { from: "mail", to: "done" }])
  });
  const steps = LANES.nodes.map(function(n) { return n.id; });
  const fresh = await draw(more);
  const kept = await draw(changed(more, { layout: first.layout }));

  // laid out anew, the diagram is shown smaller and every step moves
  assert.ok(moved(first.xml, fresh.xml, steps).length >= 4, moved(first.xml, fresh.xml, steps).join(" "));
  assert.deepEqual(moved(first.xml, kept.xml, steps), []);
  assert.ok(positions(kept.xml).get("agent").w > positions(first.xml).get("agent").w);
  assert.ok(positions(kept.xml).get("mail").x > positions(kept.xml).get("pay").x);
});

test("a step put in between moves what comes after it, and only that", async function()
{
  const first = await draw(LANES);
  // the model numbers the columns after the new step one further
  const between = changed(LANES,
  {
    nodes: LANES.nodes.map(function(n) { return (n.col >= 2) ? Object.assign({}, n, { col: n.col + 1 }) : n; })
      .concat([{ id: "log", label: "Log the request", kind: "step", group: "agent", row: 2, col: 2 }]),
    edges: LANES.edges.map(function(e) { return (e.from === "check") ? { from: "log", to: "ok" } : e; })
      .concat([{ from: "check", to: "log" }])
  });
  const kept = await draw(changed(between, { layout: first.layout }));
  const a = positions(first.xml);
  const b = positions(kept.xml);

  assert.deepEqual(moved(first.xml, kept.xml, ["ask", "check"]), []);

  // the rest moves right by the same step, in the same rows
  const shift = b.get("ok").x - a.get("ok").x;

  assert.ok(shift > 100, "shift " + shift);

  for (const id of ["pay", "done", "no"])
  {
    assert.ok(Math.abs(b.get(id).x - a.get(id).x - shift) <= 1, id);
    assert.ok(Math.abs(b.get(id).y - a.get(id).y) <= 1, id);
  }
});

test("a longer label or a node taken out leaves the others where they were", async function()
{
  const first = await draw(LANES);
  const others = ["ask", "check", "ok", "done", "no"];
  const renamed = changed(LANES, { layout: first.layout, nodes: LANES.nodes.map(function(n)
  {
    return (n.id === "pay") ? Object.assign({}, n, { label: "Pay back the full amount to the card" }) : n;
  }) });

  assert.deepEqual(moved(first.xml, (await draw(renamed)).xml, others), []);

  const fewer = changed(LANES, { layout: first.layout, nodes: LANES.nodes.filter(function(n) { return n.id !== "no"; }),
    edges: LANES.edges.filter(function(e) { return e.to !== "no"; }) });

  assert.deepEqual(moved(first.xml, (await draw(fewer)).xml, ["ask", "check", "ok", "pay", "done"]), []);
});

test("the orientation, the font size and the box sizes stay those of the first diagram", async function()
{
  // four steps show best with the lanes as rows, five with the lanes turned to columns
  const four = await draw(lanes(4));
  const five = lanes(5);

  assert.equal(four.stats.turned, false);
  assert.equal((await draw(five)).stats.turned, true);

  const kept = await draw(changed(five, { layout: four.layout }));

  assert.equal(kept.stats.turned, false);
  assert.deepEqual(moved(four.xml, kept.xml, ["s1", "s2", "s3", "s4"]), []);

  // 12 shapes have 14 px text, 13 have 16 px: a step more keeps the 14 px
  const nine = await draw(lanes(9));
  const ten = lanes(10);

  assert.equal(shapeFont(nine.xml, "s1"), 14);
  assert.equal(shapeFont((await draw(ten)).xml, "s1"), 16);
  assert.equal(shapeFont((await draw(changed(ten, { layout: nine.layout }))).xml, "s1"), 14);
});

test("a layout that isn't used is said so, and the diagram is drawn anew", async function()
{
  const first = await draw(LANES);
  const plain = await draw(LANES);

  for (const wrong of [first.layout.slice(0, -1) + (first.layout.slice(-1) === "0" ? "1" : "0"), "keep it"])
  {
    const r = await draw(changed(LANES, { layout: wrong }));

    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /^The layout ".*" was not used \(not a layout from a result of this tool, or not copied exactly\); the diagram was laid out anew\./);
    assert.equal(r.xml, plain.xml);
  }

  const other = await draw(changed(LANES, { title: "Returns", layout: first.layout }));

  assert.match(other.warnings[0], /another type or title/);
  // an empty one is none
  assert.deepEqual((await draw(changed(LANES, { layout: "" }))).warnings, []);
  // types without one grid for the page have no layout
  assert.equal((await semanticToXml(LANES, { hints: true })).layout, null);
  assert.equal((await draw({ type: "er", nodes: [{ id: "a", fields: ["PK id"] }] })).layout, null);
});

async function connect()
{
  const server = createServer("", { iconServiceUrl: null, semanticTypes: resolveSemanticTypes("on") });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "semantic-keep-test", version: "0.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

test("the tool returns the layout, and a change that passes it back keeps the shapes in place", async function()
{
  const client = await connect();
  const call = function(args)
  {
    return client.callTool({ name: "create_semantic_diagram", arguments: args });
  };
  const first = await call(LANES);
  const payload = JSON.parse(first.content[0].text);

  assert.equal(first.isError, undefined, JSON.stringify(first.content));
  assert.equal(payload.layout, (await draw(LANES)).layout);
  assert.ok(first.content[1].text.indexOf("again with layout \"" + payload.layout + "\" and the whole changed description") > 0,
    first.content[1].text);

  const more = changed(LANES,
  {
    layout: payload.layout,
    nodes: LANES.nodes.concat([{ id: "mail", label: "Send a receipt", kind: "step", group: "agent", row: 2, col: 4 }]),
    edges: LANES.edges.concat([{ from: "pay", to: "mail" }])
  });
  const second = await call(more);
  const xml = JSON.parse(second.content[0].text).xml;

  assert.equal(second.isError, undefined, JSON.stringify(second.content));
  assert.deepEqual(moved(payload.xml, xml, LANES.nodes.map(function(n) { return n.id; })), []);
  // no warning: the second block is the note for the next change
  assert.doesNotMatch(second.content.map(function(c) { return c.text; }).join("\n"), /WARNINGS/);

  // one the model didn't copy exactly is drawn anew, with a warning
  const third = await call(changed(more, { layout: payload.layout.slice(1) }));

  assert.match(third.content.map(function(c) { return c.text; }).join("\n"), /WARNINGS[\s\S]*was not used/);
  await client.close();
});
