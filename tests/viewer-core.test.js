const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectDataLabels,
  matchesLabelFilter,
  firstFilteredImageName,
  normalizeBatchGridSize,
  getBatchPreviewWindow,
  advanceBatchPreviewOffset,
  isAxisAlignedRectangle,
  setRectangleHandlePosition,
  setRectangleEdgePosition,
  clampBboxToImage,
  translateBboxWithinImage,
  createUndoHistory,
  resolveHoverTarget,
  getImageNavigationStep,
  NEGATIVE_LABEL_FILTER,
  matchesOverlayLabelFilter,
  isCancelSelectionKey,
  getContainTransform
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

test("matches negative samples only when the image has no non-empty labels", () => {
  assert.equal(matchesLabelFilter([], NEGATIVE_LABEL_FILTER, ""), true);
  assert.equal(matchesLabelFilter(["", "   "], NEGATIVE_LABEL_FILTER, ""), true);
  assert.equal(matchesLabelFilter(["", "缺陷"], NEGATIVE_LABEL_FILTER, ""), false);
});

test("show-all overlay mode bypasses labels filtering until it is cancelled", () => {
  assert.equal(matchesOverlayLabelFilter(["类别B"], "类别A", "", false), false);
  assert.equal(matchesOverlayLabelFilter(["类别B"], "类别A", "", true), true);
  assert.equal(matchesOverlayLabelFilter(["类别B"], "类别A", "", false), false);
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

test("keeps rectangle corner editing axis-aligned", () => {
  const bbox = [10, 20, 110, 20, 110, 80, 10, 80];
  assert.equal(isAxisAlignedRectangle?.(bbox), true);
  assert.deepEqual(setRectangleHandlePosition?.(bbox, 0, 35, 5), [35, 5, 110, 5, 110, 80, 35, 80]);
  assert.deepEqual(setRectangleHandlePosition?.(bbox, 2, 140, 95), [10, 20, 140, 20, 140, 95, 10, 95]);
});

test("keeps rectangle edge editing axis-aligned", () => {
  const bbox = [10, 20, 110, 20, 110, 80, 10, 80];
  assert.deepEqual(setRectangleEdgePosition?.(bbox, 0, 0, 5), [10, 5, 110, 5, 110, 80, 10, 80]);
  assert.deepEqual(setRectangleEdgePosition?.(bbox, 1, 140, 0), [10, 20, 140, 20, 140, 80, 10, 80]);
  assert.deepEqual(setRectangleEdgePosition?.(bbox, 2, 0, 95), [10, 20, 110, 20, 110, 95, 10, 95]);
  assert.deepEqual(setRectangleEdgePosition?.(bbox, 3, 35, 0), [35, 20, 110, 20, 110, 80, 35, 80]);
});

test("clamps bbox coordinates to the image boundary", () => {
  assert.deepEqual(clampBboxToImage?.([-10, 5, 120, 5, 120, 90, -10, 90], 100, 80), [0, 5, 100, 5, 100, 80, 0, 80]);
  assert.deepEqual(clampBboxToImage?.([10, 20, 40, 15, 35, 70, 5, 75], 100, 80), [10, 20, 40, 15, 35, 70, 5, 75]);
});

test("limits whole-bbox movement so its outer bounds stay in the image", () => {
  const bbox = [10, 20, 40, 20, 40, 60, 10, 60];
  assert.deepEqual(translateBboxWithinImage?.(bbox, 100, 100, 100, 80), [70, 40, 100, 40, 100, 80, 70, 80]);
  assert.deepEqual(translateBboxWithinImage?.(bbox, -100, -100, 100, 80), [0, 0, 30, 0, 30, 40, 0, 40]);
});

test("keeps undo snapshots in last-in-first-out order within the configured limit", () => {
  const history = createUndoHistory?.(2);
  history.push({ value: 1 });
  history.push({ value: 2 });
  history.push({ value: 3 });

  assert.equal(history.size(), 2);
  assert.deepEqual(history.pop(), { value: 3 });
  assert.deepEqual(history.pop(), { value: 2 });
  assert.equal(history.pop(), null);

  history.push({ value: 4 });
  history.clear();
  assert.equal(history.size(), 0);
});

test("prioritizes hover feedback targets and limits body feedback to the selected object", () => {
  assert.deepEqual(resolveHoverTarget?.(2, 1, 0, 3, 3), { kind: "point", index: 2 });
  assert.deepEqual(resolveHoverTarget?.(-1, 1, 0, 3, 3), { kind: "point", index: 1 });
  assert.deepEqual(resolveHoverTarget?.(-1, -1, 0, 3, 3), { kind: "edge", index: 0 });
  assert.deepEqual(resolveHoverTarget?.(-1, -1, -1, 3, 3), { kind: "object", index: 3 });
  assert.deepEqual(resolveHoverTarget?.(-1, -1, -1, 2, 3), { kind: "none", index: -1 });
});

test("maps WASD and arrow keys to adjacent image navigation", () => {
  ["w", "a", "W", "A", "ArrowLeft", "ArrowUp"].forEach((key) => {
    assert.equal(getImageNavigationStep?.(key), -1);
  });
  ["s", "d", "S", "D", "ArrowRight", "ArrowDown"].forEach((key) => {
    assert.equal(getImageNavigationStep?.(key), 1);
  });
  assert.equal(getImageNavigationStep?.("Delete"), 0);
});

test("recognizes Escape as the cancel-selection shortcut", () => {
  assert.equal(isCancelSelectionKey?.("Escape"), true);
  assert.equal(isCancelSelectionKey?.("Esc"), true);
  assert.equal(isCancelSelectionKey?.("Delete"), false);
});

test("calculates object-fit contain transforms for batch preview overlays", () => {
  assert.deepEqual(getContainTransform?.(200, 100, 100, 100), {
    scale: 0.5,
    offsetX: 0,
    offsetY: 25,
    width: 100,
    height: 50
  });
  assert.deepEqual(getContainTransform?.(100, 200, 100, 100), {
    scale: 0.5,
    offsetX: 25,
    offsetY: 0,
    width: 50,
    height: 100
  });
  assert.equal(getContainTransform?.(0, 100, 100, 100), null);
});
