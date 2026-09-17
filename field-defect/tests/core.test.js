const test = require("node:test");
const assert = require("node:assert/strict");
const { deflateRawSync } = require("node:zlib");
const {
  SUPPORTED_IMAGE_EXTENSIONS,
  DEFAULT_DEFECT_NAMES,
  isSupportedImagePath,
  normalizeProject,
  chooseUniqueImages,
  uniqueImagesByHash,
  prepareScanImages,
  mergeScannedImageMetadata,
  imageSequenceNumber,
  setDefectSelection,
  comparisonGridSize,
  filterAndSortImages,
  imageStatistics,
  sortHistoryRecords,
  isVehicleCameraPath,
  isManagedProjectPath,
  uniqueFolderName,
  clipboardImagesFromItems,
  isEmbeddedMediaPath,
  mediaMimeType,
  readZipMediaEntries,
  extractZipEntry
} = require("../core.js");

test("accepts only the supported project image formats", () => {
  assert.deepEqual(SUPPORTED_IMAGE_EXTENSIONS, [".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
  assert.equal(isSupportedImagePath("nested/螺栓.JPEG"), true);
  assert.equal(isSupportedImagePath("nested/anim.gif"), false);
  assert.equal(isSupportedImagePath("field-defect-project.json"), false);
});

test("provides the deduplicated default project defects", () => {
  assert.equal(DEFAULT_DEFECT_NAMES.length, 69);
  assert.equal(new Set(DEFAULT_DEFECT_NAMES).size, 69);
  assert.equal(DEFAULT_DEFECT_NAMES[0], "垂直悬吊安装底座螺栓装反");
  assert.ok(DEFAULT_DEFECT_NAMES.includes("中心锚结线夹连接螺栓缺失"));
  assert.ok(DEFAULT_DEFECT_NAMES.includes("单支悬吊角钢上方副螺母缺失"));
  assert.ok(DEFAULT_DEFECT_NAMES.includes("单支悬吊角钢上方副螺母松动"));
});

test("normalizes a project without dropping image annotations", () => {
  const project = normalizeProject({
    name: "工程 A",
    images: [{ path: "./a/one.jpg", hash: "abc", defects: ["bolt"] }],
    defects: [{ id: "bolt", name: "螺栓" }]
  });
  assert.equal(project.name, "工程 A");
  assert.deepEqual(project.images[0], {
    path: "a/one.jpg",
    hash: "abc",
    defects: ["bolt"],
    poleNumber: "",
    remark: "",
    vehicleCameraImages: []
  });
  assert.deepEqual(project.originalDefectFolders, []);
  assert.equal(project.version, 1);
  assert.ok(project.updatedAt);
});

test("preserves image metadata and multiple original-defect folders", () => {
  const project = normalizeProject({
    images: [{ path: "one.jpg", hash: "abc", poleNumber: "12-3", remark: "复核锈蚀", defects: [] }],
    originalDefectFolders: [
      { id: "source-a", name: "一车间", path: "original-defects/一车间", importedAt: "2026-09-17T01:00:00.000Z" },
      { id: "source-b", name: "二车间", path: "original-defects/二车间", importedAt: "2026-09-17T02:00:00.000Z" }
    ]
  });

  assert.equal(project.images[0].poleNumber, "12-3");
  assert.equal(project.images[0].remark, "复核锈蚀");
  assert.deepEqual(project.originalDefectFolders.map((item) => item.path), [
    "original-defects/一车间",
    "original-defects/二车间"
  ]);
});

test("normalizes multiple vehicle-camera comparison images on their primary image", () => {
  const project = normalizeProject({
    images: [{
      path: "a/one.jpg",
      hash: "primary",
      defects: [],
      vehicleCameraImages: [{
        path: "./images/vehicle-camera/primary/camera-1.png",
        hash: "camera",
        sourceName: "现场图.png",
        addedAt: "2026-09-16T00:00:00.000Z"
      }]
    }]
  });
  assert.deepEqual(project.images[0].vehicleCameraImages, [{
    path: "images/vehicle-camera/primary/camera-1.png",
    hash: "camera",
    sourceName: "现场图.png",
    addedAt: "2026-09-16T00:00:00.000Z"
  }]);
});

test("chooses a near-square comparison grid size", () => {
  assert.equal(comparisonGridSize(1), 1);
  assert.equal(comparisonGridSize(2), 2);
  assert.equal(comparisonGridSize(4), 2);
  assert.equal(comparisonGridSize(5), 3);
  assert.equal(comparisonGridSize(9), 3);
  assert.equal(comparisonGridSize(10), 4);
});

test("filters images by any selected defect and keeps unlabelled as an explicit option", () => {
  const defects = [{ id: "bolt", name: "螺栓" }, { id: "rust", name: "锈蚀" }];
  const images = [
    { path: "1.jpg", defects: ["bolt"] },
    { path: "2.jpg", defects: ["rust"] },
    { path: "3.jpg", defects: [] }
  ];
  assert.deepEqual(
    filterAndSortImages(images, defects, { defectIds: ["bolt", "rust"] }).map((item) => item.path),
    ["1.jpg", "2.jpg"]
  );
  assert.deepEqual(
    filterAndSortImages(images, defects, { defectIds: ["__none__"] }).map((item) => item.path),
    ["3.jpg"]
  );
});

test("keeps project totals separate from the current filtered image count", () => {
  const project = {
    images: [{ path: "1.jpg" }, { path: "2.jpg" }, { path: "3.jpg" }],
    defects: [{ id: "bolt" }, { id: "rust" }]
  };

  assert.deepEqual(imageStatistics?.(project, project.images.slice(0, 1)), {
    totalImages: 3,
    totalDefects: 2,
    filteredImages: 1
  });
  assert.deepEqual(imageStatistics?.(null, []), {
    totalImages: 0,
    totalDefects: 0,
    filteredImages: 0
  });
});

test("sorts by defect name while leaving unlabelled images last", () => {
  const defects = [{ id: "bolt", name: "螺栓" }, { id: "rust", name: "锈蚀" }];
  const images = [
    { path: "unlabelled.jpg", defects: [] },
    { path: "rust.jpg", defects: ["rust"] },
    { path: "bolt.jpg", defects: ["bolt"] },
    { path: "bolt-2.jpg", defects: ["bolt"] }
  ];
  assert.deepEqual(
    filterAndSortImages(images, defects, { sort: "defect-asc" }).map((item) => item.path),
    ["bolt.jpg", "bolt-2.jpg", "rust.jpg", "unlabelled.jpg"]
  );
  assert.deepEqual(
    filterAndSortImages(images, defects, { sort: "defect-desc" }).map((item) => item.path),
    ["rust.jpg", "bolt.jpg", "bolt-2.jpg", "unlabelled.jpg"]
  );
});

test("sorts project history without using the last-opened timestamp", () => {
  const records = [
    { id: "b", name: "乙工程", createdAt: "2026-01-02T00:00:00.000Z", lastOpenedAt: "2026-09-17T03:00:00.000Z" },
    { id: "a", name: "甲工程", createdAt: "2026-01-03T00:00:00.000Z", lastOpenedAt: "2026-09-17T01:00:00.000Z" },
    { id: "c", name: "丙工程", createdAt: "2026-01-01T00:00:00.000Z", lastOpenedAt: "2026-09-17T02:00:00.000Z" }
  ];

  assert.deepEqual(sortHistoryRecords(records, "created-desc").map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(sortHistoryRecords(records, "created-asc").map((item) => item.id), ["c", "b", "a"]);
  assert.deepEqual(sortHistoryRecords(records, "name-asc").map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(sortHistoryRecords(records, "name-desc").map((item) => item.id), ["b", "a", "c"]);
});

test("keeps history order stable when the selected sort values are equal or missing", () => {
  const records = [
    { id: "first", name: "同名工程", createdAt: "" },
    { id: "second", name: "同名工程" },
    { id: "third", name: "同名工程", createdAt: "" }
  ];

  assert.deepEqual(sortHistoryRecords(records, "created-desc").map((item) => item.id), ["first", "second", "third"]);
  assert.deepEqual(sortHistoryRecords(records, "name-asc").map((item) => item.id), ["first", "second", "third"]);
});

test("recognizes the reserved vehicle-camera directory", () => {
  assert.equal(isVehicleCameraPath("images/vehicle-camera"), true);
  assert.equal(isVehicleCameraPath("images\\vehicle-camera\\primary\\one.jpg"), true);
  assert.equal(isVehicleCameraPath("images/normal.jpg"), false);
});

test("excludes application-managed image folders from project scanning", () => {
  assert.equal(isManagedProjectPath("images/vehicle-camera/abc/camera.jpg"), true);
  assert.equal(isManagedProjectPath("original-defects/现场一/缺陷.jpg"), true);
  assert.equal(isManagedProjectPath("normal/缺陷.jpg"), false);
});

test("allocates a new folder name without merging existing imports", () => {
  assert.equal(uniqueFolderName("现场缺陷", []), "现场缺陷");
  assert.equal(uniqueFolderName("现场缺陷", ["现场缺陷"]), "现场缺陷-2");
  assert.equal(uniqueFolderName("现场缺陷", ["现场缺陷", "现场缺陷-2", "现场缺陷-4"]), "现场缺陷-3");
});

test("extracts only supported image files from clipboard items", () => {
  const png = { type: "image/png" };
  const items = [
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "image/gif", getAsFile: () => ({ type: "image/gif" }) },
    { kind: "file", type: "image/png", getAsFile: () => png }
  ];
  const images = clipboardImagesFromItems(items, new Date("2026-09-16T06:30:25Z"));
  assert.equal(images.length, 1);
  assert.equal(images[0].file, png);
  assert.equal(images[0].name, "clipboard-20260916-063025.png");
});

test("gives multiple pasted clipboard images unique names", () => {
  const items = [
    { kind: "file", type: "image/jpeg", getAsFile: () => ({ type: "image/jpeg" }) },
    { kind: "file", type: "image/jpeg", getAsFile: () => ({ type: "image/jpeg" }) }
  ];
  const images = clipboardImagesFromItems(items, new Date("2026-09-16T06:30:25Z"));
  assert.deepEqual(images.map((item) => item.name), [
    "clipboard-20260916-063025.jpg",
    "clipboard-20260916-063025-2.jpg"
  ]);
});

test("chooses one new image for hashes already present in the project or earlier in the batch", () => {
  const result = chooseUniqueImages(
    [{ hash: "same", name: "a.png" }, { hash: "new", name: "b.png" }, { hash: "same", name: "c.png" }],
    new Set(["same"])
  );
  assert.deepEqual(result.accepted.map((item) => item.name), ["b.png"]);
  assert.equal(result.duplicateExisting, 1);
  assert.equal(result.duplicateInBatch, 1);
});

test("recognizes embedded OOXML media entries without inspecting worksheet text", () => {
  assert.equal(isEmbeddedMediaPath("xl/media/image1.png"), true);
  assert.equal(isEmbeddedMediaPath("xl/drawings/drawing1.xml"), false);
  assert.equal(mediaMimeType("xl/media/image1.jpeg"), "image/jpeg");
  assert.equal(mediaMimeType("xl/media/image1.webp"), "image/webp");
});

test("deduplicates recursive scan results by content hash", () => {
  const result = uniqueImagesByHash([
    { path: "a/one.jpg", hash: "same" },
    { path: "b/two.jpg", hash: "same" },
    { path: "b/three.png", hash: "other" }
  ]);
  assert.deepEqual(result.map((item) => item.path), ["a/one.jpg", "b/three.png"]);
});

test("summarizes successful, duplicate and failed recursive scan results", () => {
  const result = prepareScanImages([
    { path: "one.jpg", hash: "same" },
    { path: "copy.jpg", hash: "same" },
    { path: "two.png", hash: "other" },
    { path: "broken.webp", hash: "", error: "read failed" }
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.images.length, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.failed, 1);
});

test("keeps image metadata when a rescanned file has the same hash under a new path", () => {
  const merged = mergeScannedImageMetadata(
    [{ path: "renamed.jpg", hash: "same-hash" }],
    [{ path: "old-name.jpg", hash: "same-hash", defects: ["bolt"], poleNumber: "18", remark: "复核", vehicleCameraImages: [{ path: "images/vehicle-camera/a/one.jpg" }] }]
  );

  assert.deepEqual(merged[0], {
    path: "renamed.jpg",
    hash: "same-hash",
    defects: ["bolt"],
    poleNumber: "18",
    remark: "复核",
    vehicleCameraImages: [{ path: "images/vehicle-camera/a/one.jpg" }]
  });
});

test("keeps the original project sequence number after image filtering", () => {
  const images = [
    { path: "a/one.jpg", hash: "one" },
    { path: "b/two.jpg", hash: "two" },
    { path: "c/three.jpg", hash: "three" }
  ];
  assert.equal(imageSequenceNumber(images, images[2]), 3);
  assert.equal(imageSequenceNumber(images, { path: "missing.jpg" }), 0);
});

test("updates one defect selection without duplicates", () => {
  assert.deepEqual(setDefectSelection(["bolt"], "rust", true), ["bolt", "rust"]);
  assert.deepEqual(setDefectSelection(["bolt", "rust"], "rust", true), ["bolt", "rust"]);
  assert.deepEqual(setDefectSelection(["bolt", "rust"], "bolt", false), ["rust"]);
});

test("reads embedded media entries from a stored ZIP central directory", () => {
  const bytes = makeStoredZip([
    ["xl/media/image1.png", new Uint8Array([1, 2, 3])],
    ["xl/drawings/drawing1.xml", new Uint8Array([4])]
  ]);
  const entries = readZipMediaEntries(bytes);
  assert.deepEqual(entries.map((entry) => entry.name), ["xl/media/image1.png"]);
  assert.equal(entries[0].compression, 0);
  assert.equal(entries[0].compressedSize, 3);
});

test("extracts raw-deflate image bytes from an xlsx media entry", async () => {
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const bytes = makeDeflatedZip("xl/media/image1.png", original);
  const [entry] = readZipMediaEntries(bytes);
  const extracted = await extractZipEntry(bytes, entry);
  assert.deepEqual(Array.from(extracted), Array.from(original));
});

function makeStoredZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach(([name, data]) => {
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30 + nameBytes.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    Buffer.from(data).copy(local, 30 + nameBytes.length);
    chunks.push(local);

    const record = Buffer.alloc(46 + nameBytes.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    nameBytes.copy(record, 46);
    central.push(record);
    offset += local.length;
  });
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, directory, end]));
}

function makeDeflatedZip(name, data) {
  const nameBytes = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30 + nameBytes.length + compressed.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  compressed.copy(local, 30 + nameBytes.length);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return new Uint8Array(Buffer.concat([local, central, end]));
}
