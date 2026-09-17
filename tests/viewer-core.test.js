const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectDataLabels,
  matchesLabelFilter,
  firstFilteredImageName
} = require("../viewer-core.js");

test("collects unique non-empty labels from the entire imported JSON", () => {
  const data = {
    "one.jpg": {
      det: {
        objects: [
          { labels: [" 双螺母正常 ", "bolt"] },
          { labels: ["单螺母正常", ""] }
        ]
      }
    },
    "two.jpg": {
      det: {
        objects: [
          { labels: ["BOLT", "异物"] },
          { labels: null }
        ]
      }
    }
  };

  assert.deepEqual(collectDataLabels(data), ["单螺母正常", "双螺母正常", "异物", "bolt"]);
});

test("uses an exact selected label instead of the fuzzy text filter", () => {
  assert.equal(matchesLabelFilter(["双螺母正常", "螺母"], "螺母", "双"), true);
  assert.equal(matchesLabelFilter(["双螺母正常"], "螺母", "双"), false);
  assert.equal(matchesLabelFilter(["BOLT"], "bolt", "unrelated"), true);
});

test("keeps fuzzy label matching when no dropdown label is selected", () => {
  assert.equal(matchesLabelFilter(["双螺母正常"], "", "螺母"), true);
  assert.equal(matchesLabelFilter(["双螺母正常"], "", "异物"), false);
  assert.equal(matchesLabelFilter([], "", ""), true);
});

test("chooses the first filtered image and clears the target for an empty result", () => {
  assert.equal(firstFilteredImageName?.(["second.jpg", "third.jpg"]), "second.jpg");
  assert.equal(firstFilteredImageName?.([]), "");
});
