(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ViewerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NEGATIVE_LABEL_FILTER = "__viz_negative_sample__";

  function normalizeLabel(value) {
    return String(value === undefined || value === null ? "" : value).trim();
  }

  function labelKey(value) {
    return normalizeLabel(value).toLocaleLowerCase("zh-CN");
  }

  function collectDataLabels(data) {
    const labelsByKey = new Map();
    Object.values(data && typeof data === "object" ? data : {}).forEach(function eachEntry(entry) {
      const objects = entry && entry.det && Array.isArray(entry.det.objects) ? entry.det.objects : [];
      objects.forEach(function eachObject(obj) {
        const labels = obj && Array.isArray(obj.labels) ? obj.labels : [];
        labels.forEach(function eachLabel(label) {
          const text = normalizeLabel(label);
          const key = labelKey(text);
          if (key && !labelsByKey.has(key)) labelsByKey.set(key, text);
        });
      });
    });
    return Array.from(labelsByKey.values()).sort(function sortLabels(left, right) {
      return left.localeCompare(right, "zh-CN", { numeric: true });
    });
  }

  function matchesLabelFilter(labels, exactLabel, fuzzyText) {
    const items = Array.isArray(labels) ? labels : [];
    if (exactLabel === NEGATIVE_LABEL_FILTER) {
      return !items.some(function hasNonEmptyLabel(label) {
        return normalizeLabel(label) !== "";
      });
    }
    const exactKey = labelKey(exactLabel);
    const fuzzyKey = labelKey(fuzzyText);

    // A dropdown choice is an exact label filter; free text remains a fuzzy fallback.
    if (exactKey) {
      return items.some(function matchesExact(label) {
        return labelKey(label) === exactKey;
      });
    }
    if (fuzzyKey) {
      return items.some(function matchesFuzzy(label) {
        return labelKey(label).includes(fuzzyKey);
      });
    }
    return true;
  }

  function matchesOverlayLabelFilter(labels, exactLabel, fuzzyText, showAllObjects) {
    return !!showAllObjects || matchesLabelFilter(labels, exactLabel, fuzzyText);
  }

  function firstFilteredImageName(imageNames) {
    return Array.isArray(imageNames) && imageNames.length ? String(imageNames[0] || "") : "";
  }

  function rectangleBounds(bbox) {
    const xs = [bbox[0], bbox[2], bbox[4], bbox[6]];
    const ys = [bbox[1], bbox[3], bbox[5], bbox[7]];
    return {
      left: Math.min.apply(null, xs),
      top: Math.min.apply(null, ys),
      right: Math.max.apply(null, xs),
      bottom: Math.max.apply(null, ys)
    };
  }

  function isAxisAlignedRectangle(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 8 || bbox.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      return false;
    }
    const points = [[bbox[0], bbox[1]], [bbox[2], bbox[3]], [bbox[4], bbox[5]], [bbox[6], bbox[7]]];
    return points[0][1] === points[1][1]
      && points[1][0] === points[2][0]
      && points[2][1] === points[3][1]
      && points[3][0] === points[0][0]
      && points[0][0] !== points[2][0]
      && points[0][1] !== points[2][1];
  }

  function boundsToRectangle(bounds) {
    return [bounds.left, bounds.top, bounds.right, bounds.top, bounds.right, bounds.bottom, bounds.left, bounds.bottom];
  }

  function setRectangleHandlePosition(bbox, handleIndex, x, y) {
    const bounds = rectangleBounds(bbox);
    const opposite = [
      [bounds.right, bounds.bottom],
      [bounds.left, bounds.bottom],
      [bounds.left, bounds.top],
      [bounds.right, bounds.top]
    ][handleIndex] || [bounds.right, bounds.bottom];
    const next = {
      left: Math.min(x, opposite[0]),
      top: Math.min(y, opposite[1]),
      right: Math.max(x, opposite[0]),
      bottom: Math.max(y, opposite[1])
    };
    return boundsToRectangle(next);
  }

  function setRectangleEdgePosition(bbox, edgeIndex, x, y) {
    const bounds = rectangleBounds(bbox);
    if (edgeIndex === 0) bounds.top = y;
    if (edgeIndex === 1) bounds.right = x;
    if (edgeIndex === 2) bounds.bottom = y;
    if (edgeIndex === 3) bounds.left = x;
    return boundsToRectangle({
      left: Math.min(bounds.left, bounds.right),
      top: Math.min(bounds.top, bounds.bottom),
      right: Math.max(bounds.left, bounds.right),
      bottom: Math.max(bounds.top, bounds.bottom)
    });
  }

  function clampBboxToImage(bbox, imageWidth, imageHeight) {
    if (!Array.isArray(bbox) || bbox.length !== 8 || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
      return Array.isArray(bbox) ? bbox.slice() : bbox;
    }
    return bbox.map(function clampCoordinate(value, index) {
      const limit = index % 2 === 0 ? imageWidth : imageHeight;
      return Math.max(0, Math.min(limit, value));
    });
  }

  function translateBboxWithinImage(bbox, dx, dy, imageWidth, imageHeight) {
    if (!Array.isArray(bbox) || bbox.length !== 8 || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
      return Array.isArray(bbox) ? bbox.slice() : bbox;
    }
    const bounds = rectangleBounds(bbox);
    const limitedDx = Math.max(-bounds.left, Math.min(imageWidth - bounds.right, dx));
    const limitedDy = Math.max(-bounds.top, Math.min(imageHeight - bounds.bottom, dy));
    return bbox.map(function translateCoordinate(value, index) {
      return Math.round(value + (index % 2 === 0 ? limitedDx : limitedDy));
    });
  }

  function resolveHoverTarget(keypointIndex, handleIndex, edgeIndex, objectIndex, selectedObjectIndex) {
    if (Number.isInteger(keypointIndex) && keypointIndex >= 0) {
      return { kind: "point", index: keypointIndex };
    }
    if (Number.isInteger(handleIndex) && handleIndex >= 0) {
      return { kind: "point", index: handleIndex };
    }
    if (Number.isInteger(edgeIndex) && edgeIndex >= 0) {
      return { kind: "edge", index: edgeIndex };
    }
    if (Number.isInteger(objectIndex) && objectIndex === selectedObjectIndex) {
      return { kind: "object", index: objectIndex };
    }
    return { kind: "none", index: -1 };
  }

  function getImageNavigationStep(key) {
    const normalized = String(key || "").toLowerCase();
    if (["arrowleft", "arrowup", "a", "w"].includes(normalized)) return -1;
    if (["arrowright", "arrowdown", "d", "s"].includes(normalized)) return 1;
    return 0;
  }

  function isCancelSelectionKey(key) {
    return key === "Escape" || key === "Esc";
  }

  function getContainTransform(sourceWidth, sourceHeight, containerWidth, containerHeight) {
    if (![sourceWidth, sourceHeight, containerWidth, containerHeight].every(function isPositive(value) {
      return Number.isFinite(value) && value > 0;
    })) return null;
    const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
      scale,
      offsetX: (containerWidth - width) / 2,
      offsetY: (containerHeight - height) / 2,
      width,
      height
    };
  }

  function createUndoHistory(limit) {
    const maxEntries = Math.max(1, Math.floor(Number(limit) || 50));
    const entries = [];
    return {
      push(snapshot) {
        entries.push(snapshot);
        while (entries.length > maxEntries) entries.shift();
      },
      pop() {
        return entries.length ? entries.pop() : null;
      },
      clear() {
        entries.length = 0;
      },
      size() {
        return entries.length;
      }
    };
  }

  function normalizeBatchGridSize(value) {
    if (value === null || value === undefined || String(value).trim() === "") return 3;
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(2, Math.min(10, parsed));
  }

  function getBatchPreviewWindow(total, gridSize, requestedStart) {
    const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
    const size = normalizeBatchGridSize(gridSize);
    const capacity = size * size;
    const maxStart = Math.max(0, safeTotal - capacity);
    const start = Math.max(0, Math.min(maxStart, Math.floor(Number(requestedStart) || 0)));
    const end = Math.min(safeTotal, start + capacity);
    return {
      start,
      end,
      capacity,
      maxStart,
      percent: safeTotal ? Math.round((end / safeTotal) * 100) : 0
    };
  }

  function advanceBatchPreviewOffset(total, gridSize, currentStart, direction) {
    const size = normalizeBatchGridSize(gridSize);
    const windowState = getBatchPreviewWindow(total, size, currentStart);
    const step = Number(direction) < 0 ? -size : size;
    return Math.max(0, Math.min(windowState.maxStart, windowState.start + step));
  }

  return {
    NEGATIVE_LABEL_FILTER,
    collectDataLabels,
    matchesLabelFilter,
    matchesOverlayLabelFilter,
    firstFilteredImageName,
    isAxisAlignedRectangle,
    setRectangleHandlePosition,
    setRectangleEdgePosition,
    clampBboxToImage,
    translateBboxWithinImage,
    resolveHoverTarget,
    getImageNavigationStep,
    isCancelSelectionKey,
    getContainTransform,
    createUndoHistory,
    normalizeBatchGridSize,
    getBatchPreviewWindow,
    advanceBatchPreviewOffset
  };
});
