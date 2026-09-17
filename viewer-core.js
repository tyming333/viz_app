(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ViewerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  function firstFilteredImageName(imageNames) {
    return Array.isArray(imageNames) && imageNames.length ? String(imageNames[0] || "") : "";
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
    collectDataLabels,
    matchesLabelFilter,
    firstFilteredImageName,
    normalizeBatchGridSize,
    getBatchPreviewWindow,
    advanceBatchPreviewOffset
  };
});
