const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../yolo-core.js");
const yaml = require("../vendor/js-yaml.min.js");
const mapping = core.normalizeMapping({ 3: "正常", 7: "缺失" });

test("mapping preserves numeric IDs across JSON, YAML and line-based files", () => {
  assert.deepEqual({ ...core.parseMapping('{"names":{"3":"正常","7":"缺失"}}', "labels.json") }, { 3: "正常", 7: "缺失" });
  assert.deepEqual({ ...core.parseMapping('path: .\nnames:\n  3: 正常\n  7: 缺失', "data.yaml", yaml) }, { 3: "正常", 7: "缺失" });
  assert.deepEqual({ ...core.parseMapping('\uFEFF正常\r\n缺失\r\n', "classes.txt") }, { 0: "正常", 1: "缺失" });
  assert.deepEqual({ ...core.normalizeMapping({ 正常: 3, 缺失: 7 }) }, { 3: "正常", 7: "缺失" });
  assert.throws(() => core.normalizeMapping({ 0: "Bolt", 1: "bolt" }), /重复/);
  assert.throws(() => core.normalizeMapping({ 0: "", 1: "bolt" }), /名称/);
  assert.throws(() => core.normalizeMapping({ "-1": "bolt" }), /ID/);
});

test("matches images and TXT within their relative directory", () => {
  const files = ["a/001.jpg", "a/001.txt", "b/001.png", "b/001.txt", "missing.jpg", "orphan.txt", "data.yaml"].map(path => ({ name: path.split("/").pop(), webkitRelativePath: "dataset/" + path }));
  const index = core.indexFiles(files);
  assert.equal(index.images.length, 3);
  assert.equal(index.images[0].txtPath, "a/001.txt");
  assert.equal(index.images[1].txtPath, "b/001.txt");
  assert.equal(index.images[2].label, undefined);
  assert.equal(index.issues[0].path, "orphan.txt");
  assert.equal(index.mappings[0].path, "data.yaml");
  const duplicate = core.indexFiles(["one.jpg", "one.png", "one.txt"].map(name => ({ name })));
  assert.equal(duplicate.images.length, 0);
  assert.match(duplicate.issues[0].message, /唯一/);
});

test("converts normalized detections to pixel rectangles and back without changing IDs", () => {
  const objects = core.parseAnnotations("3 0.5 0.5 0.2 0.4\n7 0.25 0.25 0.1 0.1\n", mapping, 1000, 500);
  assert.deepEqual(objects[0].bbox, [400, 150, 600, 150, 600, 350, 400, 350]);
  assert.equal(objects[0].attrs.yolo_class_id, 3);
  assert.equal(core.serializeAnnotations(objects, mapping, 1000, 500), "3 0.50000000 0.50000000 0.20000000 0.40000000\n7 0.25000000 0.25000000 0.10000000 0.10000000\n");
  objects[0].labels = ["缺失"];
  assert.equal(core.serializeAnnotations(objects, mapping, 1000, 500).split(" ")[0], "7");
  assert.deepEqual(core.parseAnnotations(" \n", mapping, 1000, 500), []);
  assert.equal(core.serializeAnnotations([], mapping, 1000, 500), "");
});

test("invalid annotations identify the line and cannot be partially accepted", () => {
  const valid = "3 0.5 0.5 0.2 0.4\n";
  for (const row of ["8 0.5 0.5 0.2 0.4", "3 NaN 0.5 0.2 0.4", "3 0.5 0.5 0 0.4", "3 0.95 0.5 0.2 0.4", "3 0.5 0.5 0.2 0.4 0.8"]) {
    assert.throws(() => core.parseAnnotations(valid + row, mapping, 1000, 500), /第 2 行/);
  }
  const objects = core.parseAnnotations(valid, mapping, 1000, 500);
  objects[0].bbox[2] += 10;
  assert.throws(() => core.serializeAnnotations(objects, mapping, 1000, 500), /矩形框/);
  objects[0].labels = ["未知"];
  assert.throws(() => core.serializeAnnotations(objects, mapping, 1000, 500), /映射/);
});
