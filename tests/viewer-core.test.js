const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectDataLabels,
  matchesLabelFilter,
  firstFilteredImageName,
  normalizeBatchGridSize,
  getBatchPreviewWindow,
  advanceBatchPreviewOffset
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

test("normalizes a user-entered batch grid size to the supported 2 through 10 range", () => {
  assert.equal(normalizeBatchGridSize?.(""), 3);
  assert.equal(normalizeBatchGridSize?.("4"), 4);
  assert.equal(normalizeBatchGridSize?.("4.9"), 4);
  assert.equal(normalizeBatchGridSize?.("1"), 2);
  assert.equal(normalizeBatchGridSize?.("99"), 10);
});

test("keeps the final batch window full when enough images remain", () => {
  assert.deepEqual(getBatchPreviewWindow?.(20, 3, 18), {
    start: 11,
    end: 20,
    capacity: 9,
    maxStart: 11,
    percent: 100
  });
  assert.deepEqual(getBatchPreviewWindow?.(5, 3, 4), {
    start: 0,
    end: 5,
    capacity: 9,
    maxStart: 0,
    percent: 100
  });
});

test("moves the batch preview by one grid row and clamps at both ends", () => {
  assert.equal(advanceBatchPreviewOffset?.(40, 4, 0, 1), 4);
  assert.equal(advanceBatchPreviewOffset?.(40, 4, 4, -1), 0);
  assert.equal(advanceBatchPreviewOffset?.(18, 4, 0, 1), 2);
  assert.equal(advanceBatchPreviewOffset?.(18, 4, 2, 1), 2);
});
