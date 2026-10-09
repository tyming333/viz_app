const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../attributes-core.js");
const config = { version: 1, groups: [{ name: "外观", options: ["正常", "松动"] }, { name: "遮挡", options: ["无遮挡", "遮挡"] }] };
test("exported configurations round trip and whitespace is trimmed", () => {
  assert.deepEqual(core.normalizeConfig(JSON.parse(JSON.stringify(config))), config);
  assert.deepEqual(core.normalizeConfig({ version: 1, groups: [{ name: " 外观 ", options: [" 正常 "] }] }), { version: 1, groups: [{ name: "外观", options: ["正常"] }] });
});
test("configurations reject ambiguous names and malformed groups", () => {
  for (const value of [null, { version: 2, groups: config.groups }, { version: 1, groups: [] }, { version: 1, groups: [null] }, { version: 1, groups: [{ name: "", options: ["正常"] }] }, { version: 1, groups: [{ name: "外观", options: [] }] }, { version: 1, groups: [{ name: "外观", options: [0] }] }, { version: 1, groups: [{ name: "外观", options: ["正常", "正常"] }] }, { version: 1, groups: [{ name: "外观", options: ["正常"] }, { name: "其他", options: ["正常"] }] }, { version: 1, groups: [{ name: "外观", options: ["正常"] }, { name: "外观", options: ["松动"] }] }]) {
    assert.throws(() => core.normalizeConfig(value));
  }
});
test("choosing a status replaces only its group and preserves unknown properties", () => {
  const before = ["旧属性", "正常", "无遮挡", "正常"];
  const after = core.choose(before, config.groups[0], "松动");
  assert.deepEqual(after, ["旧属性", "松动", "无遮挡"]);
  assert.deepEqual(before, ["旧属性", "正常", "无遮挡", "正常"]);
  assert.deepEqual(core.choose(after, config.groups[0], "松动"), after);
  assert.deepEqual(core.choose(after, config.groups[0], null), ["旧属性", "无遮挡"]);
  assert.deepEqual(core.choose(undefined, config.groups[0], "正常"), ["正常"]);
});
test("malformed existing annotations and unknown options cannot be overwritten", () => {
  for (const value of [null, {}, { 正常: 1 }, "正常", [1], [""], ["正常", null]]) assert.throws(() => core.choose(value, config.groups[0], "正常"), /score_attrs/);
  assert.throws(() => core.choose([], config.groups[0], "配置外名称"), /配置/);
});
