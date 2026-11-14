#!/usr/bin/env node

/**
 * Icon table generator
 *
 * Builds shared/icon-table.js, the table behind icons by name (`icon=aws
 * lambda` in a style, shared/icon-resolver.js), from search-index.json. It
 * keeps the current icon sets of the cloud providers and leaves out the
 * older ones a search also finds:
 *
 * - AWS: the service icons (resourceIcon tiles in the category colors), the
 *   resource icons (one-color glyphs), the groups of the current palette.
 *   Not: the AWS 3 and 3D sets, the white-tile and gradient icons of the
 *   first AWS 4 release, the product cards (productIcon).
 * - Azure: the azure2 set (img/lib/azure2/…). Not: mscae, the old azure set.
 * - Google Cloud: the core product and category icons (gcp3), then the
 *   product icons of the gcp2 set. Not: the older gcpicons set or the gcp2
 *   concept glyphs. The gcp2 product icons are data URIs, kept apart in
 *   ICON_DATA so the viewer can leave them out.
 * - Kubernetes: the unlabeled resource icons.
 *
 * Usage: `npm run generate` runs it after generate-index.js (also in the
 * update-search-index workflow), or alone after the index changed:
 *   node generate-icon-table.js
 *
 * An entry it can't read (a style without the key that names its icon, a
 * value that would need escaping) is left out with a warning instead of
 * failing the run, so a palette change in a draw.io release never stops the
 * workflow from proposing the new index.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var index = JSON.parse(fs.readFileSync(path.join(__dirname, "search-index.json"), "utf8"));
var OUT = path.join(__dirname, "..", "shared", "icon-table.js");

// Common names and abbreviations of the services, keyed by provider and the
// squashed display title (lowercase, letters and digits only). Each adds a
// name the resolver matches as a whole.
var ALIASES =
{
  aws:
  {
    applicationloadbalancer: ["alb"],
    networkloadbalancer: ["nlb"],
    gatewayloadbalancer: ["gwlb"],
    classicloadbalancer: ["clb"],
    elasticloadbalancing: ["elb", "load balancer"],
    simpleemailservice: ["ses", "email service"],
    elasticcontainerservice: ["ecs"],
    elastickubernetesservice: ["eks"],
    elasticcontainerregistry: ["ecr"],
    elasticfilesystem: ["efs"],
    elasticblockstore: ["ebs"],
    identityaccessmanagement: ["iam", "identity and access management"],
    keymanagementservice: ["kms"],
    certificatemanager: ["acm"],
    managedstreamingforapachekafka: ["msk", "kafka"],
    internetgateway: ["igw"],
    natgateway: ["nat"],
    apigateway: ["apigw"],
    dynamodb: ["dynamo", "ddb"],
    cloudfront: ["cdn"],
    route53: ["dns"],
    stepfunctions: ["sfn"],
    systemsmanager: ["ssm"],
    waf: ["web application firewall"],
    client: ["browser", "web client", "desktop"],
    mobileclient: ["mobile", "mobile app", "phone"],
    users: ["customers", "people"],
    simplestorageservices3: ["s3"],
    s3glacier: ["glacier"],
    ec2autoscaling: ["asg"],
    opensearchservice: ["opensearch"],
    datafirehose: ["firehose"],
    cognito: ["user pool"],
    eventbridge: ["event bus"],
    bucket: ["s3 bucket"],
    queue: ["sqs queue"],
    topic: ["sns topic"],
    instance: ["ec2 instance"]
  },
  azure:
  {
    functionapps: ["functions", "azure functions"],
    appservices: ["web app", "web apps"],
    kubernetesservices: ["aks"],
    virtualmachine: ["vm"],
    virtualnetworks: ["vnet"],
    storageaccounts: ["storage", "blob storage", "blob"],
    frontdoors: ["afd"],
    applicationgateways: ["app gateway"],
    loadbalancers: ["lb"],
    apimanagementservices: ["apim", "api management"],
    activedirectory: ["aad", "azure ad", "entra id"],
    cacheredis: ["redis", "redis cache", "cache for redis"],
    containerregistries: ["acr"],
    containerinstances: ["aci"],
    monitor: ["azure monitor"],
    cdnprofiles: ["cdn"],
    dnszones: ["dns"],
    staticapps: ["static web apps"],
    openai: ["azure openai"],
    sqldatabase: ["azure sql"]
  },
  gcp:
  {
    computeengine: ["gce", "vm"],
    gke: ["google kubernetes engine", "kubernetes engine"],
    cloudrun: [],
    cloudsql: [],
    cloudspanner: ["spanner"],
    cloudstorage: ["gcs"],
    securitycommandcenter: ["scc"],
    secops: ["security operations"],
    pubsub: ["pub/sub"],
    cloudloadbalancing: ["load balancer", "load balancing"],
    cloudcdn: ["cdn"],
    clouddns: ["dns"],
    cloudarmor: ["armor"],
    cloudiam: ["iam"],
    cloudkeymanagement: ["kms"],
    appengine: ["gae"],
    cloudbigtable: ["bigtable"],
    virtualprivatecloud: ["vpc"],
    memorystore: ["redis"]
  },
  k8s:
  {
    deploy: ["deployment"],
    svc: ["service"],
    ing: ["ingress"],
    ns: ["namespace"],
    cm: ["configmap", "config map"],
    pv: ["persistent volume"],
    pvc: ["persistent volume claim"],
    sa: ["service account"],
    sts: ["statefulset", "stateful set"],
    ds: ["daemonset", "daemon set"],
    rs: ["replicaset", "replica set"],
    hpa: ["horizontal pod autoscaler", "autoscaler"],
    crd: ["custom resource definition"],
    netpol: ["network policy"],
    ep: ["endpoints", "endpoint"],
    sched: ["scheduler"],
    kproxy: ["kube proxy"],
    cm2: [],
    ccm: ["cloud controller manager"],
    rb: ["role binding"],
    crb: ["cluster role binding"],
    crole: ["cluster role"],
    vol: ["volume"],
    sc: ["storage class"],
    psp: ["pod security policy"],
    quota: ["resource quota"],
    limits: ["limit range"],
    api: ["api server", "kube apiserver"]
  }
};

// Display names of the Google Cloud core product icons (gcp3), whose titles
// in the index are squashed ("Cloudrun").
var GCP3_TITLES =
{
  aihypercomputer: "AI Hypercomputer", alloydb: "AlloyDB", anthos: "Anthos", apigee: "Apigee",
  bigquery: "BigQuery", cloudrun: "Cloud Run", cloudspanner: "Cloud Spanner", cloudsql: "Cloud SQL",
  cloud_storage: "Cloud Storage", computeengine: "Compute Engine", distributedcloud: "Distributed Cloud",
  gke: "GKE", hyperdisk: "Hyperdisk", looker: "Looker", mandiant: "Mandiant",
  securitycommandcenter: "Security Command Center", secops: "SecOps",
  threatintelligence: "Threat Intelligence", vertexai: "Vertex AI",
  aimachinelearning: "AI and Machine Learning", businessintelligence: "Business Intelligence",
  dataanalytics: "Data Analytics", developertools: "Developer Tools", hybridmulticloud: "Hybrid and Multicloud",
  integrationservices: "Integration Services", managementtools: "Management Tools",
  mapsgeospatial: "Maps and Geospatial", mediaservices: "Media Services", mixedreality: "Mixed Reality",
  securityidentity: "Security and Identity", serverlesscomputing: "Serverless Computing",
  webmobile: "Web and Mobile"
};

// Leading category words and spelled-out abbreviations in the titles of the
// gcp2 product icons ("Networking Cloud Dns Domain Name Server").
var GCP2_CATEGORIES = ["Api Management Application Programming Interface", "Iot Internet Of Things",
  "Developer Tools", "Integration Services", "Compute", "Serverless", "Operations", "Networking",
  "Databases", "Storage", "Security"];
var GCP2_EXPANSIONS = ["Application Programming Interfaces", "Application Programming Interface",
  "Artificial Intelligence", "Content Domain Network", "Domain Name Server", "Internet Protocol",
  "Virtual Private Network", "Graphics Processing Unit", "Operating System",
  "Integrated Development Environment", "Alloy Database", "Internet Of Things", "Advertisement"];

// Stroke colors of the first AWS 4 group palette (light and dark), replaced
// by the current groups.
var OLD_AWS_GROUP_STROKES = ["#AAB7B8", "#879196", "#545B64", "#007DBC", "#858B94", "#B6BABF",
  "#E8E8E8", "#00A1C9", "#FFFFFF"];

function squash(text)
{
  return text.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]/g, "");
}

function styleValue(style, key)
{
  var m = new RegExp("(?:^|;)" + key + "=([^;]*)").exec(style);

  return (m != null) ? m[1] : null;
}

function libraryOf(entry)
{
  return entry.tags.split(" ")[0];
}

/** "rds_postgresql_instance_alt" → "rds postgresql instance" */
function stencilName(name)
{
  return name.replace(/^.*\./, "").replace(/_(alt\d*|\d+)$/, "").replace(/_/g, " ");
}

var templates = [];
var templateIds = {};
var icons = [];
var data = [];
var dataIds = {};
var seen = {};
var skipped = [];

/** Runs fn for an index entry; an entry it can't read is skipped. */
function safely(entry, fn)
{
  try
  {
    fn();
  }
  catch (e)
  {
    skipped.push((entry != null && entry.title) + ": " + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * Adds an icon. The style is split into a template (shared by the icons of
 * a set) and the parts that differ: the stencil or image name (`{n}`) and
 * the fill color (`{c}`).
 */
function add(provider, kind, title, extraNames, style, w, h, identity)
{
  var key = provider + ":" + kind + ":" + squash(title);

  // A few entries of the index carry their style twice, the second time
  // with the image data cut off (Cloud Test Lab): left out.
  if (seen[key] || (identity != null &&
    (style.match(new RegExp("(^|;)" + identity + "=", "g")) || []).length > 1))
  {
    return;
  }

  seen[key] = true;

  // Connection points of the azure2 images are left out: edges end on the
  // outline either way, and they would make up half of the table.
  style = style.replace(/(^|;)points=\[[^;]*\];?/, "$1");

  if (!/;$/.test(style))
  {
    style += ";";
  }

  var n = "";
  var tpl = style;

  if (identity != null)
  {
    var value = styleValue(style, identity);

    if (value == null || value === "")
    {
      throw new Error("No " + identity + " in the style");
    }

    var prefix = "";
    var suffix = "";

    if (/^data:/.test(value))
    {
      if (dataIds[value] == null)
      {
        dataIds[value] = data.length;
        data.push(value);
      }

      n = dataIds[value];
    }
    else
    {
      var azure = /^(img\/lib\/azure2\/)(.*)(\.svg)$/.exec(value);

      if (azure != null)
      {
        prefix = azure[1];
        n = azure[2];
        suffix = azure[3];
      }
      else
      {
        prefix = value.substring(0, value.lastIndexOf(".") + 1);
        n = value.substring(prefix.length);
      }
    }

    tpl = tpl.replace(new RegExp("(^|;)" + identity + "=[^;]*"), "$1" + identity + "=" + prefix + "{n}" + suffix);
  }

  var c = styleValue(style, "fillColor") || "";

  if (c !== "" && identity != null)
  {
    tpl = tpl.replace(/(^|;)fillColor=[^;]*/, "$1fillColor={c}");
  }
  else
  {
    c = "";
  }

  if (/["<>&]/.test(tpl))
  {
    throw new Error("Style needs escaping: " + tpl);
  }

  if (templateIds[tpl] == null)
  {
    templateIds[tpl] = templates.length;
    templates.push(tpl);
  }

  var names = [title];
  var aliases = (ALIASES[provider] || {})[squash(title)] || [];

  extraNames.concat(aliases).forEach(function(name)
  {
    var known = names.some(function(other) { return squash(other) === squash(name); });

    if (!known && squash(name) !== "")
    {
      names.push(name);
    }
  });

  icons.push([provider, kind, names.join("|"), templateIds[tpl], n, c, Math.round(w), Math.round(h)]);
}

/** "Simple Storage Service (S3)" → ["Simple Storage Service", ["S3"]] */
function splitTitle(title)
{
  var extra = [];
  var main = title.replace(/\s*\(([^)]*)\)/g, function(_m, inner)
  {
    if (!/retired/i.test(inner))
    {
      extra.push(inner);
    }

    return "";
  }).trim();

  return { main: main, extra: extra, retired: /\(retired|, retired\)/i.test(title) };
}

// ── AWS ─────────────────────────────────────────────────────────────────────

var aws = index.filter(function(s) { return libraryOf(s) === "aws4"; });

// Groups first: the later entries in the index are the current palette.
var awsGroups = {};

aws.forEach(function(s)
{
  safely(s, function()
  {
    var shape = styleValue(s.style, "shape") || "";
    var isGroup = /^mxgraph\.aws4\.group/.test(shape) ||
      (shape === "" && /^(Availability Zone|Security group)$/i.test(s.title));

    if (isGroup)
    {
      var stroke = (styleValue(s.style, "strokeColor") || "").toUpperCase();
      var old = OLD_AWS_GROUP_STROKES.indexOf(stroke) >= 0;
      var k = squash(s.title);

      // The current palette comes later in the index: it replaces the old
      // one; of the old ones, the first (light) one is kept.
      if (awsGroups[k] == null || (!old && awsGroups[k].old) || (!old && !awsGroups[k].old))
      {
        awsGroups[k] = { entry: s, old: old };
      }
    }
  });
});

Object.keys(awsGroups).forEach(function(k)
{
  var g = awsGroups[k];

  // Keep an old group only where no current one replaces it (Subnet).
  if (g.old && k !== "subnet")
  {
    return;
  }

  safely(g.entry, function()
  {
    var title = g.entry.title.replace(/^AWS Iot/, "AWS IoT");
    var names = /^AWS /.test(title) ? [title.substring(4)] : [];

    add("aws", "g", title, names, g.entry.style, g.entry.w, g.entry.h,
      styleValue(g.entry.style, "grIcon") != null ? "grIcon" : null);
  });
});

aws.forEach(function(s)
{
  safely(s, function()
  {
    var shape = styleValue(s.style, "shape") || "";
    var fill = (styleValue(s.style, "fillColor") || "").toUpperCase();
    var gradient = styleValue(s.style, "gradientColor");
    var t = splitTitle(s.title);

    if (shape === "mxgraph.aws4.resourceIcon")
    {
      // The white tiles and the gradients are the first AWS 4 release.
      if (fill === "#FFFFFF" || (gradient != null && gradient !== "none"))
      {
        return;
      }

      // Retired services keep their icon in draw.io's palette, not here.
      if (t.retired)
      {
        return;
      }

      var resIcon = styleValue(s.style, "resIcon");

      if (resIcon == null)
      {
        throw new Error("No resIcon in the style");
      }

      add("aws", "s", t.main, t.extra.concat([stencilName(resIcon)]),
        s.style, s.w, s.h, "resIcon");
    }
    else if (/^mxgraph\.aws4\./.test(shape) && !/^mxgraph\.aws4\.(productIcon|group)/.test(shape) &&
      !t.retired)
    {
      add("aws", "r", t.main, t.extra.concat([stencilName(shape)]),
        s.style, s.w, s.h, "shape");
    }
  });
});

// ── Azure ───────────────────────────────────────────────────────────────────

var seenAzureImages = {};

index.filter(function(s) { return libraryOf(s) === "azure2"; }).forEach(function(s)
{
  safely(s, function()
  {
    var image = styleValue(s.style, "image") || "";
    var file = image.replace(/^.*\//, "");

    if (seenAzureImages[file])
    {
      return;
    }

    seenAzureImages[file] = true;
    var t = splitTitle(s.title);
    var fileName = file.replace(/\.svg$/, "").replace(/^Azure_/, "").replace(/_/g, " ");

    add("azure", "s", t.main, t.extra.concat([fileName]), s.style, s.w, s.h, "image");
  });
});

// ── Google Cloud ────────────────────────────────────────────────────────────

index.filter(function(s) { return libraryOf(s) === "gcp3"; }).forEach(function(s)
{
  safely(s, function()
  {
    var shape = styleValue(s.style, "shape");

    if (shape == null)
    {
      throw new Error("No shape in the style");
    }

    var name = shape.replace(/^mxgraph\.gcp3\./, "");
    var title = GCP3_TITLES[name] || s.title;
    var category = (styleValue(s.style, "fillColor") || "").toLowerCase() === "#9aa0a6";

    add("gcp", category ? "c" : "s", title, [], s.style, s.w, s.h, "shape");
  });
});

index.filter(function(s) { return libraryOf(s) === "gcp2" && /image=data:/.test(s.style); }).forEach(function(s)
{
  safely(s, function() { addGcp2(s); });
});

function addGcp2(s)
{
  var title = s.title;

  for (var i = 0; i < GCP2_CATEGORIES.length; i++)
  {
    if (title.indexOf(GCP2_CATEGORIES[i] + " ") === 0)
    {
      title = title.substring(GCP2_CATEGORIES[i].length + 1);
      break;
    }
  }

  GCP2_EXPANSIONS.forEach(function(expansion)
  {
    title = title.replace(" " + expansion, "");
  });

  // The core product icons above replace their gcp2 versions.
  var core = Object.keys(GCP3_TITLES).some(function(k)
  {
    return squash(GCP3_TITLES[k]) === squash(title) ||
      (squash(title) === "googlekubernetesengine" && k === "gke") ||
      (squash(title) === "cloudspanner" && k === "cloudspanner");
  });

  if (!core)
  {
    add("gcp", "s", title, [], s.style, s.w, s.h, "image");
  }
}

// ── Kubernetes ──────────────────────────────────────────────────────────────

index.filter(function(s)
{
  return libraryOf(s) === "kubernetes" && styleValue(s.style, "shape") === "mxgraph.kubernetes.icon2";
}).forEach(function(s)
{
  safely(s, function()
  {
    add("k8s", "r", s.title, [], s.style, s.w, s.h, "prIcon");
  });
});

// ── Output ──────────────────────────────────────────────────────────────────

var table = { templates: templates, icons: icons };
var source =
  "// Generated by shape-search/generate-icon-table.js from shape-search/search-index.json.\n" +
  "// Do not edit: change the generator and run it again.\n" +
  "//\n" +
  "// The icons that `icon=<name>` in a style can name (shared/icon-resolver.js):\n" +
  "// templates are styles with {n} for the stencil or image and {c} for the\n" +
  "// fill color; each icon is [provider, kind, names, template, n, c, w, h],\n" +
  "// kind s(ervice), r(esource), g(roup) or c(ategory), names\n" +
  "// separated by |. A numeric n is an index into ICON_DATA.\n\n" +
  "export const ICON_TABLE =\n{\n\"templates\": [\n" +
  templates.map(function(t) { return JSON.stringify(t); }).join(",\n") + "\n],\n\"icons\": [\n" +
  icons.map(function(i) { return JSON.stringify(i); }).join(",\n") + "\n]\n};\n\n" +
  "export const ICON_DATA = [\n" + data.map(function(d) { return JSON.stringify(d); }).join(",\n") + "\n];\n";

fs.writeFileSync(OUT, source);

var tableBytes = JSON.stringify(table).length;
var dataBytes = JSON.stringify(data).length;
var counts = {};

icons.forEach(function(icon)
{
  counts[icon[0]] = (counts[icon[0]] || 0) + 1;
});

console.log("Wrote " + OUT + ": " + icons.length + " icons " + JSON.stringify(counts) + ", " +
  templates.length + " templates, table " + Math.round(tableBytes / 1024) + " KB, data " +
  Math.round(dataBytes / 1024) + " KB");

if (skipped.length > 0)
{
  console.warn("Skipped " + skipped.length + " entries the generator can't read:\n  " + skipped.join("\n  "));
}
