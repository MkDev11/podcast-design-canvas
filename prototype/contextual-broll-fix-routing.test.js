"use strict";

// Guards contextual B-roll hand-off links (#583): weak-context and back-to-back
// title reviews open the screen that owns each fix.
// Run with: `node prototype/contextual-broll-fix-routing.test.js`

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "contextual-broll-moments.html"), "utf8");

assert.ok(html.includes('src="broll-context-scorer.js"'), "B-roll screen loads the context scorer");
assert.ok(html.includes('openLink = document.createElement("a")'), "B-roll issues render an open-fix-screen link");
assert.ok(html.includes("BrollContextScorer.scoreMoment"), "B-roll issues are classified from transcript context");
assert.ok(html.includes("BrollContextScorer.detectTitleRepeats"), "title repeat routing uses scorer helper");
assert.ok(html.includes("BrollContextScorer.buildIntakePayload"), "weak-context routing carries structured payload");
assert.ok(html.includes("BrollContextScorer.encodeIntakeQuery"), "open link appends social-intake payload");
assert.ok(
  html.includes("Open ${issue.fixLabel}") && html.includes("issue.fixPayload"),
  "open link routes to the owning fix screen with optional payload",
);

const fixScreens = [...html.matchAll(/fixScreen:\s*"([a-z0-9-]+\.html)"/g)].map((m) => m[1]);
assert.ok(fixScreens.length >= 2, "B-roll issues declare fix screens");
for (const file of fixScreens) {
  assert.ok(fs.existsSync(path.join(dir, file)), `fix screen exists: ${file}`);
}

assert.ok(
  fixScreens.includes("social-context-intake.html"),
  "weak-context moments route to social context intake",
);
assert.ok(
  fixScreens.includes("contextual-title-cards.html"),
  "back-to-back title cards route to title cards screen",
);
assert.ok(
  fs.existsSync(path.join(dir, "broll-context-scorer.js")),
  "context scorer exists as a real prototype module",
);

console.log(`contextual B-roll: ${fixScreens.length} issue paths open their owning fix screen`);
