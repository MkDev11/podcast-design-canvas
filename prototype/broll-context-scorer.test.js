"use strict";

// Guards the contextual B-roll scorer (#757): transcript context is scored behind
// the scenes, title repeats are detected, and social-intake hand-offs round-trip.
// Run with: `node prototype/broll-context-scorer.test.js`

const assert = require("assert");
const scorer = require("./broll-context-scorer.js");

const speakers = ["Dana Brooks", "Marcus Lee", "Priya Shah"];

const strong = scorer.scoreMoment(
  {
    reason: "Guest mentions the product launch",
    transcript: "Marcus Lee explains how Acme Studio launched Pulse Kit for 12 customer teams in April.",
  },
  { approvedSpeakers: speakers },
);
assert.equal(strong.needsReview, false, "specific transcript context does not need review");
assert.ok(strong.signals.speakerReference > 0, "approved speaker references contribute to context strength");
assert.ok(strong.signals.namedEntity > 0, "named entities contribute to context strength");

const weak = scorer.scoreMoment(
  {
    reason: "Host introduces a new segment",
    transcript: "Now we get into the next part of the episode and talk about what happened next.",
  },
  { approvedSpeakers: speakers },
);
assert.equal(weak.needsReview, true, "thin transcript context needs review");
assert.equal(weak.reasonLabel, "Needs speaker context", "weak context gets creator-facing guidance");
assert.ok(!/score|confidence/i.test(`${weak.reasonLabel} ${weak.guidance}`), "creator guidance hides scoring internals");

const repeats = scorer.detectTitleRepeats([
  { type: "title", decision: "approved" },
  { type: "title", decision: "suggested" },
  { type: "quote", decision: "approved" },
]);
assert.deepStrictEqual(repeats, [false, true, false], "adjacent title cards are flagged");

const payload = scorer.buildIntakePayload({ reason: "Host introduces a new segment", at: "00:28:17" }, weak);
const encoded = scorer.encodeIntakeQuery(payload);
assert.ok(encoded.includes("from=broll"), "handoff query identifies B-roll source");
const parsed = scorer.parseIntakeQuery(encoded);
assert.deepStrictEqual(parsed, payload, "handoff payload round-trips through the URL query");

console.log("B-roll context scorer: classifications, title repeats, and payload handoff verified");
