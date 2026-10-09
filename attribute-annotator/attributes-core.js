(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AttributesCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function normalizeConfig(config) {
    if (!config || config.version !== 1 || !Array.isArray(config.groups) || !config.groups.length) {
      throw new Error("配置必须是 version: 1 且包含非空 groups 的属性选择表");
    }
    const groupNames = new Set(), optionNames = new Set();
    const groups = config.groups.map(function (group, index) {
      const name = typeof group?.name === "string" ? group.name.trim() : "";
      if (!name) throw new Error("第 " + (index + 1) + " 组需要填写属性组名称");
      if (groupNames.has(name)) throw new Error("属性组名称重复：" + name);
      groupNames.add(name);
      if (!Array.isArray(group.options) || !group.options.length) throw new Error(name + " 至少需要一个属性名");
      const options = group.options.map(function (value) {
        if (typeof value !== "string" || !value.trim()) throw new Error(name + " 的属性名必须是非空文本");
        const option = value.trim();
        if (optionNames.has(option)) throw new Error("属性名重复：" + option + "。每个属性名只能属于一个组");
        optionNames.add(option);
        return option;
      });
      return { name: name, options: options };
    });
    return { version: 1, groups: groups };
  }
  function read(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
      throw new Error("当前框的 score_attrs 不是属性名数组，请先核对原始数据；未覆盖已有内容");
    }
    return value.slice();
  }
  function choose(value, group, option) {
    const selected = read(value);
    if (!group || !Array.isArray(group.options) || (option !== null && !group.options.includes(option))) {
      throw new Error("所选属性不在当前配置组中");
    }
    const next = [];
    let inserted = false;
    selected.forEach(item => {
      if (!group.options.includes(item)) next.push(item);
      else if (!inserted && option !== null) { next.push(option); inserted = true; }
    });
    if (!inserted && option !== null) next.push(option);
    return next;
  }
  return { normalizeConfig: normalizeConfig, read: read, choose: choose };
});
