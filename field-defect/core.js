(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FieldDefectCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".webp"];
  const PROJECT_FILE_NAME = "field-defect-project.json";
  // 新建工程使用的缺陷目录；重复名称已去除，顺序按业务清单保留。
  const DEFAULT_DEFECT_NAMES = Object.freeze([
    "垂直悬吊安装底座螺栓装反",
    "垂直悬吊安装底座副螺母缺失",
    "垂直悬吊安装底座螺栓露头不足",
    "垂直悬吊安装底座副螺母松动",
    "垂直悬吊安装底座螺母缺失",
    "单支悬吊角钢下方副螺母缺失",
    "单支悬吊角钢下方螺栓露头不足",
    "单支悬吊角钢下方副螺母松动",
    "单支悬吊角钢下方螺母缺失",
    "刚性悬挂吊柱顶板底面副螺母缺失",
    "刚性悬挂吊柱顶板底面螺栓露头不足",
    "刚性悬挂吊柱顶板底面副螺母松动",
    "刚性悬挂吊柱顶板底面螺母缺失",
    "地线线夹托板安装底座副螺母缺失",
    "地线线夹托板安装底座螺栓露头不足",
    "地线线夹托板安装底座副螺母松动",
    "地线线夹托板安装底座螺母缺失",
    "地线线夹托板安装底座螺母松动",
    "地线线夹螺栓装反",
    "地线线夹螺栓副螺母缺失",
    "地线线夹螺栓露头不足",
    "地线线夹螺栓副螺母松动",
    "地线线夹螺栓螺母缺失",
    "地线线夹螺栓螺母松动",
    "槽道底座螺栓副螺母缺失",
    "槽道底座螺栓露头不足",
    "槽道底座螺栓副螺母松动",
    "槽道底座螺栓螺母缺失",
    "中心锚结底座副螺母缺失",
    "中心锚结底座螺栓露头不足",
    "中心锚结底座副螺母松动",
    "中心锚结底座螺母缺失",
    "绝缘横撑与螺栓连接处副螺母缺失",
    "绝缘横撑与螺栓连接处螺栓露头不足",
    "绝缘横撑与螺栓连接处副螺母松动",
    "绝缘横撑与螺栓连接处螺母缺失",
    "电连接线夹螺母缺失",
    "电连接线夹螺母松动",
    "电连接线夹螺栓松动",
    "异型并沟线夹螺母缺失",
    "异型并沟线夹螺母松动",
    "异型并沟线夹螺栓松动",
    "汇流排接地线夹U型螺栓螺母缺失",
    "汇流排接地线夹U型螺栓螺母松动",
    "汇流排接地线夹U型螺栓缺失",
    "接线端子安装底座螺栓和架空地线跳线连接处螺母缺失",
    "接线端子安装底座螺栓和架空地线跳线连接处螺母松动",
    "绞线固定卡螺栓松动",
    "架空地线固定卡螺栓副螺母缺失",
    "绞线固定卡副帽松动",
    "绞线固定卡螺帽缺失",
    "绞线固定卡螺帽松动",
    "电缆固定卡螺帽缺失",
    "电缆固定卡螺帽松动",
    "汇流排中间接头螺栓缺失",
    "汇流排中间接头螺栓松动",
    "刚性悬挂用针式绝缘子破损",
    "刚性悬挂用针式绝缘子有异物",
    "硅橡胶绝缘子破损",
    "硅橡胶绝缘子有杂物",
    "绝缘横撑绝缘子破损",
    "绝缘横撑绝缘子有异物",
    "中心锚结绝缘子破损",
    "中心锚结绝缘子有异物",
    "中心锚结线夹连接螺栓开口销缺失",
    "中心锚结线夹连接螺栓螺母松动",
    "中心锚结线夹连接螺栓缺失",
    "单支悬吊角钢上方副螺母缺失",
    "单支悬吊角钢上方副螺母松动"
  ]);

  function normalizePath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");
  }

  function extensionOf(value) {
    const path = String(value || "").toLowerCase();
    const dot = path.lastIndexOf(".");
    return dot >= 0 ? path.slice(dot) : "";
  }

  function isSupportedImagePath(path) {
    return SUPPORTED_IMAGE_EXTENSIONS.includes(extensionOf(path));
  }

  function isVehicleCameraPath(path) {
    return /^images\/vehicle-camera(?:\/|$)/i.test(normalizePath(path));
  }

  function isManagedProjectPath(path) {
    const normalized = normalizePath(path);
    return isVehicleCameraPath(normalized) || /^original-defects(?:\/|$)/i.test(normalized);
  }

  function uniqueFolderName(preferredName, existingNames) {
    const base = String(preferredName || "原始缺陷").trim() || "原始缺陷";
    const used = new Set(Array.from(existingNames || [], (name) => String(name).toLocaleLowerCase("zh-CN")));
    if (!used.has(base.toLocaleLowerCase("zh-CN"))) return base;
    let suffix = 2;
    while (used.has((base + "-" + suffix).toLocaleLowerCase("zh-CN"))) suffix += 1;
    return base + "-" + suffix;
  }

  function clipboardImageExtension(mimeType) {
    switch (String(mimeType || "").toLowerCase()) {
      case "image/jpeg": return ".jpg";
      case "image/png": return ".png";
      case "image/bmp": return ".bmp";
      case "image/webp": return ".webp";
      default: return "";
    }
  }

  function clipboardImagesFromItems(items, timestamp) {
    const date = timestamp instanceof Date && !Number.isNaN(timestamp.getTime()) ? timestamp : new Date();
    const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const images = [];
    Array.from(items || []).forEach((item) => {
      if (!item || item.kind !== "file" || typeof item.getAsFile !== "function") return;
      const file = item.getAsFile();
      const extension = clipboardImageExtension(item.type || (file && file.type));
      if (!file || !extension) return;
      const suffix = images.length ? "-" + (images.length + 1) : "";
      images.push({ file, name: "clipboard-" + stamp + suffix + extension });
    });
    return images;
  }

  function createId(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return prefix + "-" + crypto.randomUUID();
    }
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function normalizeProject(input) {
    const source = input && typeof input === "object" ? input : {};
    const now = new Date().toISOString();
    const images = Array.isArray(source.images) ? source.images : [];
    const defects = Array.isArray(source.defects) ? source.defects : [];
    const originalDefectFolders = Array.isArray(source.originalDefectFolders) ? source.originalDefectFolders : [];
    return {
      version: 1,
      id: String(source.id || createId("project")),
      name: String(source.name || "未命名工程"),
      rootDisplayName: String(source.rootDisplayName || ""),
      createdAt: String(source.createdAt || now),
      updatedAt: now,
      defects: defects
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || createId("defect")),
          name: String(item.name || "").trim(),
          disabled: Boolean(item.disabled)
        }))
        .filter((item) => item.name),
      originalDefectFolders: originalDefectFolders
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || createId("original-defect")),
          name: String(item.name || "原始缺陷").trim() || "原始缺陷",
          path: normalizePath(item.path),
          importedAt: String(item.importedAt || "")
        }))
        .filter((item) => /^original-defects\//i.test(item.path)),
      images: images
        .filter((item) => item && typeof item === "object" && isSupportedImagePath(item.path))
        .map((item) => {
          const comparisonImages = Array.isArray(item.vehicleCameraImages) ? item.vehicleCameraImages : [];
          return {
            path: normalizePath(item.path),
            hash: String(item.hash || ""),
            defects: Array.isArray(item.defects) ? item.defects.map(String).filter(Boolean) : [],
            poleNumber: String(item.poleNumber || ""),
            remark: String(item.remark || ""),
            vehicleCameraImages: comparisonImages
              .filter((entry) => entry && typeof entry === "object" && isSupportedImagePath(entry.path))
              .map((entry) => ({
                path: normalizePath(entry.path),
                hash: String(entry.hash || ""),
                sourceName: String(entry.sourceName || ""),
                addedAt: String(entry.addedAt || "")
              }))
              .filter((entry) => entry.path),
            ...(item.source && typeof item.source === "object" ? { source: item.source } : {})
          };
        })
        .filter((item) => item.path)
    };
  }

  function comparisonGridSize(total) {
    return Math.ceil(Math.sqrt(Math.max(1, Number(total) || 1)));
  }

  function filterAndSortImages(images, defects, options) {
    const source = Array.isArray(images) ? images : [];
    const settings = options && typeof options === "object" ? options : {};
    const query = String(settings.query || "").trim().toLocaleLowerCase("zh-CN");
    const selected = new Set((Array.isArray(settings.defectIds) ? settings.defectIds : []).map(String));
    const names = new Map((Array.isArray(defects) ? defects : []).map((item) => [String(item.id), String(item.name || "")]));

    const rows = source.map((image, index) => {
      const defectIds = Array.isArray(image && image.defects) ? image.defects.map(String) : [];
      const defectNames = defectIds
        .map((id) => names.get(id) || "")
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "zh-CN"));
      return { image, index, defectIds, defectNames, sortKey: defectNames.join(" / ") };
    }).filter((row) => {
      const matchesQuery = !query || String(row.image && row.image.path || "").toLocaleLowerCase("zh-CN").includes(query);
      if (!matchesQuery || selected.size === 0) return matchesQuery;
      const matchesUnlabelled = selected.has("__none__") && row.defectIds.length === 0;
      const matchesDefect = row.defectIds.some((id) => selected.has(id));
      return matchesUnlabelled || matchesDefect;
    });

    if (settings.sort === "defect-asc" || settings.sort === "defect-desc") {
      const direction = settings.sort === "defect-desc" ? -1 : 1;
      rows.sort((left, right) => {
        if (!left.sortKey && right.sortKey) return 1;
        if (left.sortKey && !right.sortKey) return -1;
        const compared = left.sortKey.localeCompare(right.sortKey, "zh-CN") * direction;
        return compared || left.index - right.index;
      });
    }
    return rows.map((row) => row.image);
  }

  function imageStatistics(project, filteredImages) {
    const source = project && typeof project === "object" ? project : {};
    return {
      totalImages: Array.isArray(source.images) ? source.images.length : 0,
      totalDefects: Array.isArray(source.defects) ? source.defects.length : 0,
      filteredImages: Array.isArray(filteredImages) ? filteredImages.length : 0
    };
  }

  function sortHistoryRecords(records, mode) {
    const rows = (Array.isArray(records) ? records : []).map((record, index) => ({ record, index }));
    const selectedMode = ["created-desc", "created-asc", "name-asc", "name-desc"].includes(mode) ? mode : "created-desc";
    rows.sort((left, right) => {
      let compared = 0;
      if (selectedMode.startsWith("name-")) {
        compared = String(left.record && left.record.name || "").localeCompare(String(right.record && right.record.name || ""), "zh-CN");
        if (selectedMode === "name-desc") compared *= -1;
      } else {
        compared = String(left.record && left.record.createdAt || "").localeCompare(String(right.record && right.record.createdAt || ""));
        if (selectedMode === "created-desc") compared *= -1;
      }
      return compared || left.index - right.index;
    });
    return rows.map((row) => row.record);
  }

  function chooseUniqueImages(candidates, existingHashes) {
    const initial = new Set(existingHashes || []);
    const seen = new Set(initial);
    const reportedExisting = new Set();
    const accepted = [];
    let duplicateExisting = 0;
    let duplicateInBatch = 0;
    (candidates || []).forEach((candidate) => {
      const hash = String(candidate && candidate.hash || "");
      if (!hash || seen.has(hash)) {
        if (hash && initial.has(hash) && !reportedExisting.has(hash)) {
          duplicateExisting += 1;
          reportedExisting.add(hash);
        }
        else duplicateInBatch += 1;
        return;
      }
      seen.add(hash);
      accepted.push(candidate);
    });
    return { accepted, duplicateExisting, duplicateInBatch };
  }

  function uniqueImagesByHash(images) {
    return chooseUniqueImages(images || [], new Set()).accepted;
  }

  function prepareScanImages(scanned) {
    const all = Array.isArray(scanned) ? scanned : [];
    const successful = all.filter((item) => item && item.hash);
    const images = uniqueImagesByHash(successful);
    return {
      images,
      total: all.length,
      duplicates: successful.length - images.length,
      failed: all.length - successful.length
    };
  }

  function mergeScannedImageMetadata(scannedImages, previousImages) {
    const previous = Array.isArray(previousImages) ? previousImages : [];
    const byPath = new Map(previous.map((image) => [normalizePath(image && image.path), image]));
    const byHash = new Map(previous.filter((image) => image && image.hash).map((image) => [String(image.hash), image]));
    return (Array.isArray(scannedImages) ? scannedImages : []).map((image) => {
      const matched = byPath.get(normalizePath(image && image.path)) || byHash.get(String(image && image.hash || ""));
      const unchanged = matched && matched.hash === image.hash;
      return {
        ...image,
        defects: unchanged ? (matched.defects || []) : [],
        poleNumber: unchanged ? (matched.poleNumber || "") : "",
        remark: unchanged ? (matched.remark || "") : "",
        vehicleCameraImages: unchanged ? (matched.vehicleCameraImages || []) : []
      };
    });
  }

  function imageSequenceNumber(projectImages, image) {
    const images = Array.isArray(projectImages) ? projectImages : [];
    const targetPath = normalizePath(image && image.path);
    const index = images.findIndex((item) => normalizePath(item && item.path) === targetPath);
    return index >= 0 ? index + 1 : 0;
  }

  function setDefectSelection(selectedIds, defectId, checked) {
    const ids = Array.from(new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String).filter(Boolean)));
    const id = String(defectId || "");
    if (!id) return ids;
    if (checked) {
      if (!ids.includes(id)) ids.push(id);
      return ids;
    }
    return ids.filter((item) => item !== id);
  }

  function isEmbeddedMediaPath(path) {
    return /^xl\/media\/[^/]+\.(?:jpe?g|png|bmp|webp|gif|tiff?)$/i.test(String(path || ""));
  }

  function mediaMimeType(path) {
    switch (extensionOf(path)) {
      case ".jpg":
      case ".jpeg": return "image/jpeg";
      case ".png": return "image/png";
      case ".bmp": return "image/bmp";
      case ".webp": return "image/webp";
      case ".gif": return "image/gif";
      case ".tif":
      case ".tiff": return "image/tiff";
      default: return "application/octet-stream";
    }
  }

  function readUInt16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUInt32(view, offset) {
    return view.getUint32(offset, true);
  }

  function findEndOfCentralDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65557); offset -= 1) {
      if (readUInt32(view, offset) === 0x06054b50) return offset;
    }
    throw new Error("不是有效的 ZIP 文件，找不到中央目录");
  }

  function readZipMediaEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = findEndOfCentralDirectory(bytes);
    const count = readUInt16(view, endOffset + 10);
    const directoryOffset = readUInt32(view, endOffset + 16);
    let offset = directoryOffset;
    const entries = [];
    const decoder = new TextDecoder("utf-8");
    for (let index = 0; index < count; index += 1) {
      if (readUInt32(view, offset) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
      const compression = readUInt16(view, offset + 10);
      const compressedSize = readUInt32(view, offset + 20);
      const nameLength = readUInt16(view, offset + 28);
      const extraLength = readUInt16(view, offset + 30);
      const commentLength = readUInt16(view, offset + 32);
      const localOffset = readUInt32(view, offset + 42);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (isEmbeddedMediaPath(name)) entries.push({ name, compression, compressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function extractZipEntry(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (readUInt32(view, entry.localOffset) !== 0x04034b50) throw new Error("ZIP 本地文件头损坏");
    const nameLength = readUInt16(view, entry.localOffset + 26);
    const extraLength = readUInt16(view, entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = bytes.slice(start, start + entry.compressedSize);
    if (entry.compression === 0) return compressed;
    if (entry.compression !== 8 || typeof DecompressionStream === "undefined") {
      throw new Error("浏览器不支持此 Excel 压缩格式");
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return {
    SUPPORTED_IMAGE_EXTENSIONS,
    PROJECT_FILE_NAME,
    DEFAULT_DEFECT_NAMES,
    normalizePath,
    isSupportedImagePath,
    isVehicleCameraPath,
    isManagedProjectPath,
    uniqueFolderName,
    clipboardImagesFromItems,
    normalizeProject,
    comparisonGridSize,
    filterAndSortImages,
    imageStatistics,
    sortHistoryRecords,
    chooseUniqueImages,
    uniqueImagesByHash,
    prepareScanImages,
    mergeScannedImageMetadata,
    imageSequenceNumber,
    setDefectSelection,
    isEmbeddedMediaPath,
    mediaMimeType,
    readZipMediaEntries,
    extractZipEntry
  };
});
