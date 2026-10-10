const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../attributes-core.js");
const table = { "螺母轮廓及棱角": ["清晰", "基本可辨", "不可辨"], "螺杆轮廓": ["清晰", "基本可辨", "不可辨"] };
const config = core.normalizeConfig(table);
test("keyed configurations round trip with repeated states across attributes", () => {
  assert.deepEqual(core.exportConfig(config), table);
  assert.deepEqual(core.normalizeConfig(JSON.parse(JSON.stringify(core.exportConfig(config)))), config);
  assert.deepEqual(core.normalizeConfig({ " 螺母数量 ": [" 明确可辨 "] }), { version: 1, groups: [{ name: "螺母数量", options: ["明确可辨"] }] });
  assert.deepEqual(core.normalizeConfig({ version: 1, groups: config.groups }), config);
});
test("configurations reject duplicate keys, duplicate states within one attribute and malformed states", () => {
  for (const value of [null, [], {}, { version: 2, groups: config.groups }, { version: 1, groups: [] }, { version: 1, groups: [null] }, { "": ["清晰"] }, { "轮廓": [] }, { "轮廓": [0] }, { "轮廓": ["清晰", " 清晰 "] }, { "轮廓": ["清晰"], " 轮廓 ": ["不可辨"] }]) assert.throws(() => core.normalizeConfig(value));
});
test("each attribute stores one independent state while preserving unrelated fields", () => {
  const before = { "旧属性": "保留", "螺母轮廓及棱角": "基本可辨", "螺杆轮廓": "清晰" };
  const after = core.choose(before, config.groups[0], "清晰");
  assert.deepEqual(after, { "旧属性": "保留", "螺母轮廓及棱角": "清晰", "螺杆轮廓": "清晰" });
  assert.equal(before["螺母轮廓及棱角"], "基本可辨");
  assert.deepEqual(core.choose(after, config.groups[0], null), { "旧属性": "保留", "螺杆轮廓": "清晰" });
  assert.deepEqual(core.choose(undefined, config.groups[0], "清晰"), { "螺母轮廓及棱角": "清晰" });
  assert.deepEqual(core.choose({ "螺母轮廓及棱角": "旧状态" }, config.groups[0], "不可辨"), { "螺母轮廓及棱角": "不可辨" });
});
test("malformed annotations and legacy arrays cannot be silently overwritten", () => {
  for (const value of [null, "正常", ["清晰"]]) assert.throws(() => core.choose(value, config.groups[0], "清晰"), /attrs/);
  assert.throws(() => core.choose({}, config.groups[0], "配置外名称"), /配置/);
  assert.deepEqual(core.read({}), {});
});
test("attribute names that match object prototype fields remain ordinary JSON keys", () => {
  const table = JSON.parse('{"__proto__":["清晰"],"constructor":["清晰"]}');
  const config = core.normalizeConfig(table);
  assert.deepEqual(core.exportConfig(config), table);
  const chosen = core.choose({}, config.groups[0], "清晰");
  assert.equal(Object.getPrototypeOf(chosen), Object.prototype);
  assert.equal(JSON.stringify(chosen), '{"__proto__":"清晰"}');
  assert.deepEqual(core.choose(chosen, config.groups[0], null), {});
});
test("the supplied nut preset includes all ten attributes and their exact states", () => {
  const table = core.exportConfig(core.defaultConfig());
  assert.equal(Object.keys(table).length, 10);
  assert.deepEqual(table["螺母数量"], ["明确可辨", "存疑", "不可辨"]);
  assert.deepEqual(table["底座及垫片"], ["清晰", "基本可辨", "不可辨", "不适用"]);
  assert.deepEqual(table["曝光"], ["正常", "轻微过曝", "严重过曝", "轻微欠曝", "严重欠曝"]);
  assert.deepEqual(table["遮挡及截断"], ["无", "部分遮挡", "严重遮挡", "部分截断", "严重截断"]);
});

test("attrs edits preserve existing metadata of any JSON type", () => {
  const before = {box_type:"rectangle", count:2, visible:true, metadata:{source:"original"}, tags:["a"], unknown:null};
  const after = core.choose(before, config.groups[0], "清晰");
  assert.deepEqual(after, {...before, "螺母轮廓及棱角":"清晰"});
  assert.deepEqual(core.choose(after, config.groups[0], null), before);
});
test("legacy score_attrs migrates into attrs with existing attrs taking precedence", () => {
  const obj = {attrs:{box_type:"rectangle", 曝光:"正常", count:2}, score_attrs:{曝光:"轻微过曝", 螺母数量:"存疑"}};
  core.migrateObject(obj);
  assert.deepEqual(obj, {attrs:{曝光:"正常", 螺母数量:"存疑", box_type:"rectangle", count:2}});
  core.migrateObject(obj);
  assert.equal("score_attrs" in obj,false);
});
test("malformed legacy attributes remain intact and are reported", () => {
  for (const legacy of [null, ["清晰"], {轮廓:1}, {轮廓:""}]) {
    const obj={attrs:{box_type:"rectangle"},score_attrs:legacy};
    const before=structuredClone(obj);
    assert.throws(()=>core.migrateObject(obj), /score_attrs/);
    assert.throws(()=>core.readObject(obj), /score_attrs/);
    assert.deepEqual(obj,before);
  }
});
