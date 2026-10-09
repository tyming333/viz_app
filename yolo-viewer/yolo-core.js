(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YoloCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const imagePattern = /\.(jpg|jpeg|png|bmp|webp|gif)$/i;
  const pathStem = path => path.replace(/\.[^/.]+$/, "");
  const labelKey = name => String(name).trim().toLocaleLowerCase("zh-CN");

  function normalizeMapping(value) {
    if (value && Object.hasOwn(value, "names")) value = value.names;
    if (!value || typeof value !== "object") throw new Error("标签映射必须是类别 ID 到名称的对象或数组");
    let entries = Object.entries(value);
    if (!Array.isArray(value) && entries.length && entries.every(([name, id]) => !/^\d+$/.test(name) && Number.isInteger(id))) {
      entries = entries.map(([name, id]) => [String(id), name]);
    }
    const mapping = Object.create(null);
    const seen = new Set();
    for (const [id, name] of entries) {
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error("无效类别 ID: " + id);
      if (typeof name !== "string" || !name.trim()) throw new Error("类别 " + id + " 缺少有效名称");
      const key = labelKey(name);
      if (seen.has(key) || Object.hasOwn(mapping, Number(id))) throw new Error("重复的类别名称或 ID: " + id + " / " + name);
      seen.add(key);
      mapping[Number(id)] = name.trim();
    }
    if (!entries.length) throw new Error("标签映射为空");
    return mapping;
  }

  function parseMapping(text, filename, yaml) {
    text = String(text).replace(/^\uFEFF/, "");
    if (/\.json$/i.test(filename)) return normalizeMapping(JSON.parse(text));
    if (/\.ya?ml$/i.test(filename)) {
      if (!yaml) throw new Error("YAML 解析器未加载");
      return normalizeMapping(yaml.load(text, { schema: yaml.JSON_SCHEMA }));
    }
    if (/\.(txt|names)$/i.test(filename)) {
      const names = text.trimEnd().split(/\r?\n/);
      return normalizeMapping(names);
    }
    throw new Error("请选择 JSON、YAML 或 classes.txt 标签映射");
  }

  function indexFiles(files) {
    const byPath = new Map();
    const imageGroups = new Map();
    for (const file of files) {
      const raw = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      const path = file.webkitRelativePath ? raw.slice(raw.indexOf("/") + 1) : raw;
      if (path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("无效文件路径: " + path);
      if (byPath.has(path)) throw new Error("重复文件路径: " + path);
      byPath.set(path, file);
      if (imagePattern.test(path)) {
        const stem = pathStem(path);
        if (!imageGroups.has(stem)) imageGroups.set(stem, []);
        imageGroups.get(stem).push(path);
      }
    }
    const images = [];
    const issues = [];
    for (const [stem, paths] of imageGroups) {
      if (paths.length > 1) {
        issues.push({ path: stem, message: "同名图片存在多种扩展名，无法唯一匹配 TXT；已跳过" });
        continue;
      }
      const path = paths[0];
      const txtPath = stem + ".txt";
      images.push({ path, file: byPath.get(path), label: byPath.get(txtPath), txtPath });
    }
    images.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
    const automatic = ["data.yaml", "dataset.yaml", "data.yml", "classes.json", "labels.json", "label_map.json", "classes.txt", "obj.names"];
    const mappings = automatic.filter(path => byPath.has(path)).map(path => ({ path, file: byPath.get(path) }));
    for (const [path] of byPath) {
      if (/\.txt$/i.test(path) && !automatic.includes(path) && !imageGroups.has(pathStem(path))) {
        issues.push({ path, message: "没有同名图片，已跳过" });
      }
    }
    return { images, mappings, issues };
  }

  function parseAnnotations(text, mapping, width, height) {
    if (!(width > 0 && height > 0)) throw new Error("图片尺寸无效");
    const objects = [];
    const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const fail = message => { throw new Error("第 " + (index + 1) + " 行: " + message); };
      const tokens = line.trim().split(/\s+/);
      if (tokens.length !== 5) fail("检测标注必须是 5 列，不支持分割、旋转框或关键点格式");
      if (!/^\d+$/.test(tokens[0]) || !Number.isSafeInteger(Number(tokens[0]))) fail("类别 ID 无效");
      const id = Number(tokens[0]);
      if (!Object.hasOwn(mapping, id)) fail("类别 ID " + id + " 不在标签映射中");
      const [cx, cy, w, h] = tokens.slice(1).map(Number);
      if (![cx, cy, w, h].every(Number.isFinite)) fail("坐标必须是有效数字");
      if (cx < 0 || cx > 1 || cy < 0 || cy > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) fail("坐标必须归一化到 0~1，宽高必须大于 0");
      const edges = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
      if (edges.some(v => v < -0.000001 || v > 1.000001)) fail("框边界超出图片");
      const [left, top, right, bottom] = edges.map((v, i) => Math.max(0, Math.min(1, v)) * (i % 2 ? height : width));
      objects.push({ labels: [mapping[id]], bbox: [left, top, right, top, right, bottom, left, bottom], attrs: { box_type: "rectangle", yolo_class_id: id } });
    });
    return objects;
  }

  function serializeAnnotations(objects, mapping, width, height) {
    if (!(width > 0 && height > 0)) throw new Error("图片尺寸无效");
    const ids = new Map(Object.entries(mapping).map(([id, name]) => [labelKey(name), Number(id)]));
    const rows = objects.map((obj, index) => {
      const fail = message => { throw new Error("框 " + (index + 1) + ": " + message); };
      if (!Array.isArray(obj.labels) || obj.labels.length !== 1 || !ids.has(labelKey(obj.labels[0]))) fail("请选择映射中的一个标签");
      if (obj.keypoints && obj.keypoints.points && obj.keypoints.points.some(point => Array.isArray(point) && point.every(Number.isFinite))) fail("普通 YOLO 检测格式不支持关键点");
      const b = obj.bbox;
      if (!Array.isArray(b) || b.length !== 8 || !b.every(Number.isFinite)) fail("坐标无效");
      if (Math.abs(b[1] - b[3]) > 0.000001 || Math.abs(b[2] - b[4]) > 0.000001 || Math.abs(b[5] - b[7]) > 0.000001 || Math.abs(b[6] - b[0]) > 0.000001) fail("普通 YOLO 检测格式仅支持矩形框");
      const xs = [b[0], b[2], b[4], b[6]], ys = [b[1], b[3], b[5], b[7]];
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      if (left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) fail("框边界或宽高无效");
      return [ids.get(labelKey(obj.labels[0])), ...[(left + right) / (2 * width), (top + bottom) / (2 * height), (right - left) / width, (bottom - top) / height].map(value => value.toFixed(8))].join(" ");
    });
    return rows.length ? rows.join("\n") + "\n" : "";
  }

  return { normalizeMapping, parseMapping, indexFiles, parseAnnotations, serializeAnnotations, pathStem };
});
