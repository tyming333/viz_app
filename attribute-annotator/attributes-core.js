(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AttributesCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const defaultTable = {
    "螺母数量": ["明确可辨", "存疑", "不可辨"],
    "螺母轮廓及棱角": ["清晰", "基本可辨", "不可辨"],
    "螺杆轮廓": ["清晰", "基本可辨", "不可辨"],
    "底座及垫片": ["清晰", "基本可辨", "不可辨", "不适用"],
    "螺母间接缝": ["清晰", "模糊", "不可辨", "不适用"],
    "螺母与相邻构件接触面": ["清晰", "模糊", "不可辨"],
    "螺杆露头": ["清晰", "基本可辨", "不可辨"],
    "曝光": ["正常", "轻微过曝", "严重过曝", "轻微欠曝", "严重欠曝"],
    "模糊": ["无明显模糊", "轻微模糊", "严重模糊"],
    "遮挡及截断": ["无", "部分遮挡", "严重遮挡", "部分截断", "严重截断"]
  };
  function normalizeConfig(config) {
    if (!config || Array.isArray(config) || typeof config !== "object") {
      throw new Error("配置必须是属性词条到可选状态数组的对象");
    }
    const source = config.version === 1 && Array.isArray(config.groups)
      ? config.groups : Object.entries(config).map(([name, options]) => ({ name, options }));
    if (!source.length) throw new Error("至少需要一个属性词条");
    const groupNames = new Set();
    const groups = source.map(function (group, index) {
      const name = typeof group?.name === "string" ? group.name.trim() : "";
      if (!name) throw new Error("第 " + (index + 1) + " 行需要填写属性词条名称");
      if (groupNames.has(name)) throw new Error("属性词条重复：" + name);
      groupNames.add(name);
      if (!Array.isArray(group.options) || !group.options.length) throw new Error(name + " 至少需要一个可选状态");
      const optionNames = new Set();
      const options = group.options.map(function (value) {
        if (typeof value !== "string" || !value.trim()) throw new Error(name + " 的状态必须是非空文本");
        const option = value.trim();
        if (optionNames.has(option)) throw new Error(name + " 的可选状态重复：" + option);
        optionNames.add(option);
        return option;
      });
      return { name: name, options: options };
    });
    return { version: 1, groups: groups };
  }
  function exportConfig(config) {
    return Object.fromEntries(normalizeConfig(config).groups.map(group => [group.name, group.options]));
  }
  function read(value) {
    if (value === undefined) return {};
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("当前框的 attrs 不是对象，请先核对原始数据；未覆盖已有内容");
    }
    return { ...value };
  }
  function readObject(obj) {
    const attrs = read(obj.attrs);
    if (!Object.prototype.hasOwnProperty.call(obj, "score_attrs")) return attrs;
    const legacy = obj.score_attrs;
    if (!legacy || Array.isArray(legacy) || typeof legacy !== "object" || Object.values(legacy).some(value => typeof value !== "string" || !value.trim())) {
      throw new Error("旧 score_attrs 不是“属性词条: 状态”对象，请先核对原始数据；未覆盖已有内容");
    }
    return { ...legacy, ...attrs };
  }
  function migrateObject(obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, "score_attrs")) return;
    const attrs = readObject(obj);
    obj.attrs = attrs;
    delete obj.score_attrs;
  }
  function choose(value, group, option) {
    const selected = read(value);
    if (!group || typeof group.name !== "string" || !group.name.trim() || !Array.isArray(group.options) || (option !== null && !group.options.includes(option))) {
      throw new Error("所选状态不在当前属性词条的配置中");
    }
    const next = option === null ? selected : { ...selected, [group.name]: option };
    if (option === null) delete next[group.name];
    return next;
  }
  return { normalizeConfig: normalizeConfig, exportConfig: exportConfig, read: read, readObject: readObject, migrateObject: migrateObject, choose: choose,
    defaultConfig: function () { return normalizeConfig(defaultTable); } };
});
