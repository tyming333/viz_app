"use strict";

function validateData(data) {
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("JSON 根节点必须是图片名到标注内容的对象");
  }

  const imageNames = Object.keys(data);
  let objectTotal = 0;
  const meta = {};

  for (let i = 0; i < imageNames.length; i += 1) {
    const name = imageNames[i];
    const entry = data[name];
    const objects = entry && entry.det && entry.det.objects;
    if (!Array.isArray(objects)) {
      throw new Error(name + " 缺少 det.objects 数组");
    }

    const labels = new Set();
    for (let j = 0; j < objects.length; j += 1) {
      const obj = objects[j];
      if (!Array.isArray(obj.bbox) || obj.bbox.length !== 8) {
        throw new Error(name + " 的 object " + (j + 1) + " bbox 必须是 8 个数字");
      }
      for (let k = 0; k < obj.bbox.length; k += 1) {
        const value = obj.bbox[k];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(name + " 的 object " + (j + 1) + " bbox[" + k + "] 不是有效数字");
        }
      }
      if (!Array.isArray(obj.labels)) {
        obj.labels = [];
      }
      if (!obj.attrs || typeof obj.attrs !== "object" || Array.isArray(obj.attrs)) {
        obj.attrs = {};
      }
      for (let k = 0; k < obj.labels.length; k += 1) {
        const text = String(obj.labels[k] || "").trim();
        if (text) labels.add(text);
      }
    }

    objectTotal += objects.length;
    meta[name] = {
      nameLower: name.toLowerCase(),
      labelText: Array.from(labels, (item) => item.toLowerCase()).join("\n"),
      objectCount: objects.length
    };

    if (i > 0 && i % 200 === 0) {
      self.postMessage({
        type: "progress",
        phase: "validate",
        percent: Math.min(95, Math.round((i / imageNames.length) * 100))
      });
    }
  }

  return {
    imageNames,
    objectTotal,
    meta
  };
}

self.onmessage = function onmessage(event) {
  const { type, text } = event.data || {};
  if (type !== "parse-json") return;

  try {
    self.postMessage({ type: "progress", phase: "parse", percent: 5 });
    const parsed = JSON.parse(String(text || ""));
    self.postMessage({ type: "progress", phase: "validate", percent: 20 });
    const result = validateData(parsed);
    self.postMessage({
      type: "success",
      payload: {
        data: parsed,
        imageNames: result.imageNames,
        objectTotal: result.objectTotal,
        meta: result.meta
      }
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error && error.message ? error.message : "JSON 解析失败"
    });
  }
};
