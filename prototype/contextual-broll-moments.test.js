"use strict";

// Guards the wired contextual B-roll screen (#757): scoring stays behind the scenes,
// weak-context hand-offs carry payloads, and intake prefill is hooked up.
// Run with: `node prototype/contextual-broll-moments.test.js`

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const dir = __dirname;
const broll = fs.readFileSync(path.join(dir, "contextual-broll-moments.html"), "utf8");
const intake = fs.readFileSync(path.join(dir, "social-context-intake.html"), "utf8");
const scorer = fs.readFileSync(path.join(dir, "broll-context-scorer.js"), "utf8");
const scorerApi = require("./broll-context-scorer.js");

function createElement(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    attributes: {},
    children: [],
    className: "",
    href: "",
    hidden: false,
    textContent: "",
    value: "",
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    querySelector(selector) {
      if (selector === ".badge") {
        return createElement("span");
      }
      if (selector.includes("data-field") || selector === "[data-initial]") {
        return createElement("input");
      }
      return null;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function fakeDocument(ids) {
  const nodes = Object.fromEntries(ids.map((id) => [`#${id}`, createElement("div")]));
  return {
    createElement,
    querySelector(selector) {
      return nodes[selector] || createElement("div");
    },
  };
}

function inlineScript(html, marker) {
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((source) => source.includes(marker));
  assert.ok(script, `inline script contains ${marker}`);
  return script;
}

assert.ok(broll.includes('src="broll-context-scorer.js"'), "B-roll screen loads the scorer module");
assert.ok(broll.includes("const APPROVED_SPEAKERS"), "B-roll scoring uses approved speaker references");
assert.ok(broll.includes("transcript:"), "B-roll moments carry transcript segments");
assert.ok(broll.includes("at:"), "B-roll moments carry timestamps");
assert.ok(broll.includes("BrollContextScorer.scoreMoment"), "B-roll screen scores each moment");
assert.ok(broll.includes("BrollContextScorer.detectTitleRepeats"), "B-roll screen detects adjacent title repeats");
assert.ok(broll.includes("BrollContextScorer.buildIntakePayload"), "B-roll screen builds intake payloads");
assert.ok(broll.includes("BrollContextScorer.encodeIntakeQuery"), "B-roll fix link appends payload query");
assert.ok(broll.includes("source.needsContextCheck"), "B-roll weak-context review is gated by source type");

assert.ok(!/score\s*\$\{|score\s*\(/i.test(broll), "B-roll visible copy does not print scorer numbers");
assert.ok(!/confidence/i.test(broll), "B-roll visible copy avoids classifier language");
assert.ok(broll.includes("analysis.reasonLabel"), "B-roll issue copy uses scorer guidance");
assert.ok(scorer.includes("Needs speaker context"), "scorer exposes creator-facing guidance");

assert.ok(intake.includes('src="broll-context-scorer.js"'), "social context intake can parse B-roll payloads");
assert.ok(intake.includes("parseIncomingBrollContext"), "intake reads B-roll query payload");
assert.ok(intake.includes("seedIncomingBrollLink"), "intake pre-populates a source row from B-roll payload");
assert.ok(intake.includes("renderIncomingRequest"), "intake renders a plain request banner");
assert.ok(intake.includes("contextRequest"), "intake has a request banner target");

const brollScript = inlineScript(broll, "function evaluate");
const brollHarness = brollScript.replace(
  /\s*render\(\);\s*$/,
  `
    const weakTranscript = [{
      id: "weak-transcript",
      at: "00:28:17",
      reason: "Host introduces a new segment",
      transcript: "Now we get into the next part and talk about what happened next.",
      type: "broll",
      strength: "standard",
      source: "transcript",
      decision: "suggested",
    }];
    const approvedSocial = [{
      id: "approved-social",
      at: "00:28:17",
      reason: "Host introduces a new segment",
      transcript: "Now we get into the next part and talk about what happened next.",
      type: "broll",
      strength: "standard",
      source: "social",
      decision: "suggested",
    }];
    const weakIssue = evaluate(weakTranscript).results[0].issue;
    const socialIssue = evaluate(approvedSocial).results[0].issue;
    const rendered = renderIssue(weakIssue);
    globalThis.__brollRuntime = {
      weakIssue,
      socialIssue,
      linkHref: rendered.children.find((child) => child.tagName === "A")?.href,
    };
  `,
);
const brollContext = {
  BrollContextScorer: scorerApi,
  document: fakeDocument(["moments", "status", "issues", "addMoment", "reset"]),
  structuredClone,
};
vm.runInNewContext(brollHarness, brollContext);
assert.equal(
  brollContext.__brollRuntime.weakIssue.fixScreen,
  "social-context-intake.html",
  "weak transcript context routes to social intake",
);
assert.ok(
  brollContext.__brollRuntime.linkHref.startsWith("social-context-intake.html?from=broll"),
  "weak transcript fix link carries intake query payload",
);
assert.equal(
  brollContext.__brollRuntime.socialIssue.fixScreen,
  undefined,
  "approved social-context suggestions are not sent back to social intake",
);

const payload = scorerApi.buildIntakePayload(
  { reason: "Host introduces a new segment", at: "00:28:17" },
  scorerApi.scoreMoment({
    reason: "Host introduces a new segment",
    transcript: "Now we get into the next part and talk about what happened next.",
  }, { approvedSpeakers: ["Dana Brooks"] }),
);
const intakeScript = inlineScript(intake, "function initialLinks");
const intakeHarness = intakeScript.replace(
  /\s*render\(\);\s*$/,
  `
    const seededLinks = initialLinks();
    renderIncomingRequest(incomingBrollContext);
    globalThis.__intakeRuntime = {
      firstLink: seededLinks[0],
      requestHidden: contextRequestElement.hidden,
      requestCopy: contextRequestElement.children.map((child) => child.textContent).join(" "),
    };
  `,
);
const intakeContext = {
  document: fakeDocument(["links", "status", "issues", "contextRequest", "addLink", "reset"]),
  structuredClone,
  window: {
    BrollContextScorer: scorerApi,
    location: { search: scorerApi.encodeIntakeQuery(payload) },
  },
};
vm.runInNewContext(intakeHarness, intakeContext);
assert.ok(
  intakeContext.__intakeRuntime.firstLink.handle.includes("Source for Host introduces a new segment at 00:28:17"),
  "social intake seeds a source row from B-roll payload",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(intakeContext.__intakeRuntime.firstLink, "contextRequest"),
  false,
  "seeded intake link does not keep unused payload fields",
);
assert.equal(intakeContext.__intakeRuntime.requestHidden, false, "social intake shows the B-roll request banner");
assert.ok(
  intakeContext.__intakeRuntime.requestCopy.includes("Add a source"),
  "social intake request banner uses creator-facing copy",
);

console.log("contextual B-roll screen: scorer wiring and social-intake prefill guarded");
