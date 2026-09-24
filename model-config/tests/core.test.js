const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
const node = (name = "a.onnx") => ({ last_output: "root", current_model: name, code: "00102", num: "0", confidence: "", non_defect: "false", childlist: [] });
const source = '{\r\n  "camera_config": [{"train_id":"all","camera_num":"01,02"}],\r\n  "line_name": ["all", "all"],\r\n  "model_route": [' + JSON.stringify(node()) + '],\r\n  "extra": {"large":9007199254740993123,"decimal":1.2300,"escaped":"\\u4e2d"}\r\n}\r\n';
const open = (text = source) => C.createDocument(new TextEncoder().encode(text), "配置.json");

test("label_name is optional in old configurations and editable without rewriting other values", () => {
  const doc = open(), path = ["model_route", 0, "label_name"];
  assert.equal(doc.warnings.length, 0);
  assert.equal(Object.hasOwn(doc.data.model_route[0], "label_name"), false);
  doc.setOptional(path, "双螺母正常");
  assert.equal(doc.data.model_route[0].label_name, "双螺母正常");
  assert.equal(C.routes(doc.data)[0].title, "双螺母正常 · a.onnx");
  assert.equal(doc.raw(["extra", "large"]), "9007199254740993123");
  assert.equal(doc.raw(["extra", "escaped"]), '"\\u4e2d"');
  const exported = C.createDocument(doc.exportBytes(), "copy.json");
  assert.equal(exported.data.model_route[0].label_name, "双螺母正常");
  assert.equal(exported.format.bom.length, 0);
  assert.equal(exported.format.newline, "\r\n");
  doc.setOptional(path, "新标签");
  assert.equal(doc.data.model_route[0].label_name, "新标签");
  doc.undo(); doc.undo();
  assert.equal(doc.text, source);
});

test("existing label names keep their type and survive subtree copying", () => {
  const doc = open(source.replace('"code":"00102"', '"label_name":"标签甲","code":"00102"'));
  doc.set(["model_route", 0, "label_name"], "标签乙");
  doc.insert(["model_route"], 1, doc.raw(["model_route", 0]));
  assert.equal(doc.data.model_route[1].label_name, "标签乙");
  assert.equal(typeof doc.data.model_route[1].label_name, "string");
  assert.equal(C.nodeTarget(doc.data.model_route[1]), "a.onnx");
});

test("supports the source format's historical lable_name spelling", () => {
  const doc = open(source.replace('"code":"00102"', '"lable_name":"安装底座","code":"00102"'));
  assert.equal(C.nodeLabel(doc.data.model_route[0]), "安装底座");
  assert.equal(C.nodeLabelKey(doc.data.model_route[0]), "lable_name");
  assert.equal(C.nodeTitle(doc.data.model_route[0]), "安装底座 · a.onnx");
  doc.set(["model_route", 0, "lable_name"], "新标签");
  assert.equal(doc.data.model_route[0].lable_name, "新标签");
  assert.equal(Object.hasOwn(doc.data.model_route[0], "label_name"), false);
  const copy = C.createDocument(doc.exportBytes(), "copy.json");
  assert.equal(copy.data.model_route[0].lable_name, "新标签");
});

test("no-op export is byte-for-byte identical; single edit preserves all unrelated lexemes", () => {
  const doc = open();
  assert.deepEqual(doc.exportBytes(), new TextEncoder().encode(source));
  doc.set(["model_route", 0, "confidence"], "0.75");
  const expected = source.replace('"confidence":""', '"confidence":"0.75"');
  assert.equal(doc.text, expected);
  assert.deepEqual(doc.exportBytes(), new TextEncoder().encode(expected));
  assert.equal(typeof doc.data.model_route[0].confidence, "string");
  assert.equal(doc.data.model_route[0].code, "00102");
  assert.equal(doc.format.bom.length, 0);
  assert.equal(C.diff(source, doc.text).length, 1);
});

for (const encoding of ["utf-8", "utf-16le", "utf-16be"]) {
  for (const hasBom of [false, true]) {
    test(`${encoding}, BOM=${hasBom}: retains encoding and BOM after Chinese/emoji edits`, () => {
      const bomBytes = encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff];
      const format = { encoding, bom: new Uint8Array(hasBom ? bomBytes : []) };
      const bytes = C.encode(source, format), doc = C.createDocument(bytes, "配置.json");
      assert.deepEqual(doc.exportBytes(), bytes);
      doc.set(["line_name", 0], "线路🚆");
      const result = doc.exportBytes(), roundtrip = C.createDocument(result, "副本.json");
      assert.equal(roundtrip.format.encoding, encoding);
      assert.deepEqual(Array.from(roundtrip.format.bom), hasBom ? bomBytes : []);
      assert.equal(roundtrip.data.line_name[0], "线路🚆");
      assert.equal(roundtrip.format.newline, "\r\n");
      assert.equal(roundtrip.raw(["extra", "large"]), "9007199254740993123");
    });
  }
}

test("unknown encodings, malformed JSON, duplicate fields and invalid structure fail closed", () => {
  assert.throws(() => C.createDocument(new Uint8Array([123, 34, 0xc4, 0xe3, 34, 58, 49, 125]), "gbk.json"), /编码/);
  assert.throws(() => open(source.slice(0, -5)));
  assert.throws(() => open(source.replace('"line_name":', '"line_name":[], "line_name":')), /重复/);
  assert.throws(() => open(source.replace('"childlist":[]', '"childlist":{}')), /childlist/);
  assert.throws(() => C.decode(new Uint8Array([0xff, 0xfe, 0, 0, 123, 0, 0, 0])), /UTF-32/);
});

test("unknown fields, special property names and primitive types survive edits", () => {
  const doc = open(source.replace('"extra": {', '"__proto__":{"untouched":true},"extra": {'));
  doc.set(["__proto__", "untouched"], false);
  assert.equal(doc.data.__proto__.untouched, false);
  assert.equal({}.untouched, undefined);
  assert.equal(doc.raw(["extra", "decimal"]), "1.2300");
  assert.equal(doc.raw(["extra", "escaped"]), '"\\u4e2d"');
  assert.throws(() => doc.set(["line_name"], 3));
  assert.equal(doc.data.line_name.length, 2);
});

test("insert, copy, reorder, delete and undo preserve exact subtree strings", () => {
  const doc = open(), original = doc.raw(["model_route", 0]);
  doc.insert(["model_route"], 1, original);
  doc.set(["model_route", 1, "current_model"], "b.onnx");
  doc.move(["model_route", 1], -1);
  assert.deepEqual(doc.data.model_route.map(n => n.current_model), ["b.onnx", "a.onnx"]);
  doc.remove(["model_route", 0]);
  assert.equal(doc.raw(["model_route", 0]), original);
  doc.remove(["model_route", 0]);
  assert.deepEqual(doc.data.model_route, []);
  doc.insert(["model_route"], 0, original);
  assert.equal(doc.raw(["model_route", 0]), original);
  for (let i = 0; i < 6; i++) doc.undo();
  assert.equal(doc.text, source);
  doc.redo(); assert.equal(doc.data.model_route.length, 2);
  doc.set(["line_name", 0], "new"); assert.equal(doc.canRedo, false);
});

test("save state tracks exported snapshot while source comparison remains available", () => {
  const doc = open();
  doc.set(["line_name", 0], "A"); const saved = doc.text;
  doc.markSaved(saved); assert.equal(doc.dirty, false);
  assert.equal(C.diff(source, doc.text).length, 1);
  doc.set(["line_name", 0], "B"); doc.markSaved(saved); assert.equal(doc.dirty, true);
  doc.undo(); assert.equal(doc.dirty, false);
});

test("validation gives warnings without rewriting domain-specific parameters", () => {
  const doc = open(); doc.set(["model_route", 0, "confidence"], "1.5");
  assert.equal(doc.warnings.length, 1);
  doc.insert(["model_route", 0, "childlist"], 0, JSON.stringify(node("pretreat:check_gray(30,0)")));
  assert.equal(doc.data.model_route[0].num, "0");
  assert.deepEqual(C.routes(doc.data).map(n => [n.depth, n.kind]), [[0, "model"], [1, "pretreat"]]);
});

test("the format supports empty lists, multiple roots and varying camera/line counts", () => {
  const doc = open('{"camera_config":[],"line_name":[],"model_route":[],"custom":{"name":"another config"}}');
  doc.insert(["camera_config"], 0, '{"train_id":"客车","camera_num":"09","extra":false}');
  doc.insert(["camera_config"], 1, '{"train_id":"货车","camera_num":"11,12"}');
  doc.insert(["line_name"], 0, '"线路A"');
  doc.insert(["model_route"], 0, JSON.stringify({ ...node("different.onnx"), confidence: 0.8, non_defect: false, extension: { custom: true } }));
  doc.insert(["model_route"], 1, JSON.stringify(node("second.onnx")));
  assert.equal(C.routes(doc.data).length, 2);
  assert.equal(doc.data.model_route[0].confidence, 0.8);
  assert.equal(doc.data.model_route[0].non_defect, false);
  assert.equal(doc.data.camera_config.length, 2);
  assert.equal(doc.data.custom.name, "another config");
  assert.deepEqual(C.createDocument(doc.exportBytes(), "copy.json").data, doc.data);
});

test("safe output names reject source names, traversal and Windows reserved names", () => {
  for (const name of ["配置.json", "CONFIG.JSON", "../test.json", "sub/a.json", "a.json ", "con.json", "a.txt", "a:stream.json"]) {
    assert.throws(() => C.validateName(name, name === "CONFIG.JSON" ? "config.json" : "配置.json"));
  }
  const name = C.defaultName("配置.json", new Date("2026-09-23T12:34:56Z"));
  C.validateName(name, "配置.json"); assert.match(name, /配置_edited_20260923T123456Z.json/);
});

test("save refuses existing names or access errors before ever opening a writable stream", async () => {
  let written = false;
  const existing = { getFileHandle: async () => ({ createWritable: async () => { written = true; } }) };
  await assert.rejects(C.saveNewFile(existing, "new.json", "配置.json", new Uint8Array()), /已存在/);
  assert.equal(written, false);
  const denied = { getFileHandle: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } };
  await assert.rejects(C.saveNewFile(denied, "new.json", "配置.json", new Uint8Array()), /denied/);
  await assert.rejects(C.saveNewFile(existing, "配置.json", "配置.json", new Uint8Array()), /源文件名/);
});

test("save creates a new target and writes exact bytes, aborting on write failure", async () => {
  const calls = [], bytes = open().exportBytes();
  const stream = { write: async b => calls.push(b), close: async () => calls.push("close"), abort: async () => calls.push("abort") };
  const dir = { getFileHandle: async (name, options) => {
    calls.push([name, options]);
    if (!options) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    return { createWritable: async () => stream };
  } };
  await C.saveNewFile(dir, "new.json", "配置.json", bytes);
  assert.deepEqual(calls, [["new.json", undefined], ["new.json", { create: true }], bytes, "close"]);
  calls.length = 0; stream.write = async () => { throw new Error("disk full"); };
  await assert.rejects(C.saveNewFile(dir, "new.json", "配置.json", bytes), /disk full/);
  assert.equal(calls.at(-1), "abort");
});
