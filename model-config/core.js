(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModelConfigCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const fieldInfo = {
    last_output: ["上级输出", "与上级节点输出关联的值，根节点通常为 root。"],
    current_model: ["模型 / 预处理", "模型文件名或 pretreat: 表达式；空值通常表示结果节点。"],
    code: ["结果编码", "保留完整编码及前导零。"],
    num: ["数量参数", "按原配置含义填写；增删子节点不会自动修改此值。"],
    confidence: ["置信度", "通常为 0–1；原文件中的空值可以保留。"],
    non_defect: ["非缺陷标记", "保留原数据类型，例如字符串 \"false\"。"],
    label_name: ["标签名称", "节点的可读名称；与模型文件名和结果编码分别保存。"],
    lable_name: ["标签名称", "兼容配置文件中的历史拼写 lable_name。"],
    train_id: ["车型", "例如 all；按模型使用方约定填写。"],
    camera_num: ["相机编号", "保留前导零和分隔符，例如 01,02,21,22。"]
  };
  const keyOf = path => JSON.stringify(path);
  function nodeTitle(value) {
    const label = nodeLabel(value).trim();
    const target = String(value.current_model || value.code || "");
    return label && target ? `${label} · ${target}` : label || target || "未命名结果";
  }
  const nodeTarget = value => String(value.current_model || value.code || "未命名结果");
  const nodeLabelKey = value => Object.hasOwn(value, "label_name") ? "label_name" : Object.hasOwn(value, "lable_name") ? "lable_name" : null;
  const nodeLabel = value => {
    const key = nodeLabelKey(value);
    return key ? String(value[key] ?? "") : "";
  };
  const sameName = (a, b) => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
  function decode(bytes) {
    bytes = new Uint8Array(bytes);
    let encoding = "utf-8", bom = 0;
    if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
        (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
      throw new Error("暂不支持 UTF-32，已停止读取，文件未被修改。");
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = 3;
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; bom = 2; }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; bom = 2; }
    else if (bytes[0] === 0 && [9, 10, 13, 32, 123].includes(bytes[1])) encoding = "utf-16be";
    else if ([9, 10, 13, 32, 123].includes(bytes[0]) && bytes[1] === 0) encoding = "utf-16le";
    let text;
    try { text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom)); }
    catch { throw new Error("无法无损识别编码。仅支持 UTF-8 / UTF-16；不会猜测编码或转换后保存。"); }
    const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
    const indent = text.match(/(?:\r\n|\n|\r)([\t ]+)"/)?.[1] || "  ";
    return { text, encoding, bom: bytes.slice(0, bom), newline, indent, bytes: bytes.slice() };
  }
  function encode(text, format) {
    let body;
    if (format.encoding === "utf-8") body = new TextEncoder().encode(text);
    else {
      body = new Uint8Array(text.length * 2);
      const view = new DataView(body.buffer);
      for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), format.encoding === "utf-16le");
    }
    if (new TextDecoder(format.encoding, { fatal: true, ignoreBOM: true }).decode(body) !== text) {
      throw new Error("文本包含无法原样编码的字符，已阻止保存。");
    }
    const bytes = new Uint8Array(format.bom.length + body.length);
    bytes.set(format.bom); bytes.set(body, format.bom.length);
    return bytes;
  }
  // A small syntax index retains source spans. Edits replace only the selected value;
  // unrelated whitespace, escaped strings and numeric literals remain byte-identical.
  function parse(text) {
    const data = JSON.parse(text);
    const nodes = new Map();
    let pos = 0;
    const space = () => { while (/\s/.test(text[pos] || "") && pos < text.length) pos++; };
    function stringEnd() {
      pos++;
      while (pos < text.length) {
        if (text[pos] === "\\") pos += 2;
        else if (text[pos++] === '"') return;
      }
    }
    function walk(path, value) {
      space();
      const node = { path, value, start: pos, end: 0, children: [] };
      nodes.set(keyOf(path), node);
      if (text[pos] === "{" || text[pos] === "[") {
        const object = text[pos++] === "{";
        const close = object ? "}" : "]";
        const seen = new Set();
        space();
        while (text[pos] !== close) {
          let key = node.children.length;
          if (object) {
            const start = pos; stringEnd(); key = JSON.parse(text.slice(start, pos));
            if (seen.has(key)) throw new Error(`存在重复字段 ${key}，请先消除歧义。`);
            seen.add(key); space(); pos++; space();
          }
          node.children.push(walk([...path, key], value[key]));
          space();
          if (text[pos] !== ",") break;
          pos++; space();
        }
        pos++;
      } else if (text[pos] === '"') stringEnd();
      else { while (pos < text.length && !/[\s,\]}]/.test(text[pos])) pos++; }
      node.end = pos;
      return node;
    }
    const root = walk([], data);
    return { data, nodes, root };
  }
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function validate(data) {
    const errors = [], warnings = [];
    if (!isObject(data)) return { errors: ["配置根节点必须是对象。"], warnings };
    for (const key of ["camera_config", "line_name", "model_route"]) {
      if (!Array.isArray(data[key])) errors.push(`${key} 必须是数组。`);
    }
    if (Array.isArray(data.camera_config)) data.camera_config.forEach((v, i) => {
      if (!isObject(v)) errors.push(`camera_config[${i}] 必须是对象。`);
    });
    if (Array.isArray(data.line_name) && data.line_name.some(v => typeof v !== "string")) errors.push("line_name 中的每一项必须是字符串。");
    function route(list, label) {
      list.forEach((n, i) => {
        const loc = `${label}[${i}]`;
        if (!isObject(n)) { errors.push(`${loc} 必须是对象。`); return; }
        if (!Array.isArray(n.childlist)) errors.push(`${loc}.childlist 必须是数组。`);
        else route(n.childlist, `${loc}.childlist`);
        for (const key of ["last_output", "current_model", "code", "num", "confidence", "non_defect"]) {
          if (!Object.hasOwn(n, key)) warnings.push({ path: loc, message: `缺少字段 ${key}` });
        }
        if (n.confidence !== "" && n.confidence !== undefined &&
            (!Number.isFinite(Number(n.confidence)) || Number(n.confidence) < 0 || Number(n.confidence) > 1)) {
          warnings.push({ path: loc, message: "置信度不在常见的 0–1 范围，请核对。" });
        }
      });
    }
    if (Array.isArray(data.model_route)) route(data.model_route, "model_route");
    return { errors, warnings };
  }
  function checked(text) {
    const result = parse(text);
    const validation = validate(result.data);
    if (validation.errors.length) throw new Error(validation.errors.join("\n"));
    return { ...result, warnings: validation.warnings };
  }
  function createDocument(bytes, name) {
    const format = decode(bytes);
    let current = checked(format.text), text = format.text;
    let savedText = text;
    const undo = [], redo = [];
    const doc = {
      name, format,
      get text() { return text; },
      get data() { return current.data; },
      get warnings() { return current.warnings; },
      get dirty() { return text !== savedText; },
      get canUndo() { return undo.length > 0; },
      get canRedo() { return redo.length > 0; },
      node(path) {
        const node = current.nodes.get(keyOf(path));
        if (!node) throw new Error("此字段已不存在。");
        return node;
      },
      raw(path) { const n = doc.node(path); return text.slice(n.start, n.end); },
      commit(next) {
        const parsed = checked(next);
        encode(next, format);
        if (next === text) return false;
        undo.push(text); if (undo.length > 100) undo.shift(); redo.length = 0;
        text = next; current = parsed;
        return true;
      },
      replace(path, raw) {
        JSON.parse(raw);
        const n = doc.node(path);
        return doc.commit(text.slice(0, n.start) + raw + text.slice(n.end));
      },
      set(path, value) { return doc.replace(path, JSON.stringify(value)); },
      setOptional(path, value) {
        if (current.nodes.has(keyOf(path))) return doc.set(path, value);
        const parent = doc.node(path.slice(0, -1));
        if (!isObject(parent.value) || typeof path.at(-1) !== "string") throw new Error("新增字段必须属于对象。");
        const at = parent.children.length ? parent.children.at(-1).end : parent.start + 1;
        const indent = format.indent.repeat(path.filter(key => typeof key === "string").length);
        const addition = (parent.children.length ? "," : "") + format.newline + indent + JSON.stringify(path.at(-1)) + ": " + JSON.stringify(value);
        return doc.commit(text.slice(0, at) + addition + text.slice(at));
      },
      insert(path, index, raw) {
        JSON.parse(raw);
        const n = doc.node(path), children = n.children;
        if (!Array.isArray(n.value) || index < 0 || index > children.length) throw new Error("无效的插入位置。");
        const padding = format.newline + format.indent.repeat(path.filter(p => typeof p === "string").length + 1);
        let at, content;
        if (!children.length) { at = n.start + 1; content = padding + raw; }
        else if (index === children.length) { at = children[index - 1].end; content = "," + padding + raw; }
        else { at = children[index].start; content = raw + "," + padding; }
        return doc.commit(text.slice(0, at) + content + text.slice(at));
      },
      remove(path) {
        const index = path.at(-1), parent = doc.node(path.slice(0, -1));
        if (!Array.isArray(parent.value)) throw new Error("只能直接删除数组项；其他字段请使用 JSON 编辑。");
        const n = parent.children[index];
        let start = n.start, end = n.end;
        if (index > 0) start = parent.children[index - 1].end;
        else if (parent.children.length > 1) end = parent.children[1].start;
        return doc.commit(text.slice(0, start) + text.slice(end));
      },
      move(path, offset) {
        const index = path.at(-1), parent = doc.node(path.slice(0, -1));
        if (!Array.isArray(parent.value) || ![-1, 1].includes(offset)) throw new Error("无效的移动操作。");
        const target = index + offset;
        if (target < 0 || target >= parent.children.length) return false;
        const [a, b] = [parent.children[Math.min(index, target)], parent.children[Math.max(index, target)]];
        return doc.commit(text.slice(0, a.start) + text.slice(b.start, b.end) + text.slice(a.end, b.start) + text.slice(a.start, a.end) + text.slice(b.end));
      },
      transaction(action) {
        // Stage multi-step changes privately; failed operations never affect history.
        const draft = createDocument(doc.exportBytes(), name);
        const result = action(draft);
        doc.commit(draft.text);
        return result;
      },
      copyNode(path, subtree = false) {
        const n = doc.node(path), children = doc.node([...path, "childlist"]);
        if (!Array.isArray(children.value)) throw new Error("请选择路由节点。");
        return subtree ? doc.raw(path) : text.slice(n.start, children.start) + "[]" + text.slice(children.end, n.end);
      },
      deleteNode(path) {
        const children = doc.node([...path, "childlist"]);
        if (!children.children.length) doc.remove(path);
        else {
          const n = doc.node(path);
          const promoted = text.slice(children.children[0].start, children.children.at(-1).end);
          doc.commit(text.slice(0, n.start) + promoted + text.slice(n.end));
        }
        const list = path.slice(0, -1), index = path.at(-1);
        const length = doc.node(list).value.length;
        return length ? [...list, Math.min(index, length - 1)] : path.length > 2 ? path.slice(0, -2) : null;
      },
      pasteNode(raw, target, position) {
        const parsed = parse(raw);
        if (!isObject(parsed.data) || !Array.isArray(parsed.data.childlist)) throw new Error("剪贴板不是有效节点。");
        raw = raw.replace(/\r\n|\r|\n/g, format.newline);
        if (position === "root") {
          const index = doc.data.model_route.length;
          doc.insert(["model_route"], index, raw); return ["model_route", index];
        }
        doc.node([...target, "childlist"]);
        if (position === "parent") {
          if (parsed.data.childlist.length) throw new Error("插为父节点仅支持复制单节点。");
          const copy = parse(raw), children = copy.nodes.get(keyOf(["childlist"]));
          const wrapped = raw.slice(0, children.start) + "[" + doc.raw(target) + "]" + raw.slice(children.end);
          doc.replace(target, wrapped); return target.slice();
        }
        if (!["before", "after", "child"].includes(position)) throw new Error("无效的插入位置。");
        const list = position === "child" ? [...target, "childlist"] : target.slice(0, -1);
        const index = position === "child" ? doc.node(list).value.length : target.at(-1) + (position === "after" ? 1 : 0);
        doc.insert(list, index, raw); return [...list, index];
      },
      moveNode(path, target, position) {
        if (!["before", "after", "child", "root"].includes(position)) throw new Error("无效的移动位置。");
        doc.node([...path, "childlist"]);
        const prefix = (a, b) => a.length <= b.length && a.every((part, i) => b[i] === part);
        if (position !== "root" && prefix(path, target || [])) throw new Error("不能移动到自身或自己的后代中。");
        return doc.transaction(draft => {
          const raw = draft.raw(path);
          const adjusted = target?.slice();
          const parent = path.slice(0, -1), index = path.at(-1);
          if (adjusted && parent.every((part, i) => adjusted[i] === part) && adjusted[parent.length] > index) adjusted[parent.length]--;
          draft.remove(path);
          return draft.pasteNode(raw, adjusted, position);
        });
      },
      indentNode(path) {
        if (path.at(-1) === 0) throw new Error("前面没有同级节点，不能降一级。");
        return doc.moveNode(path, [...path.slice(0, -1), path.at(-1) - 1], "child");
      },
      outdentNode(path) {
        if (path.length <= 2) throw new Error("根节点不能再升一级。");
        return doc.moveNode(path, path.slice(0, -2), "after");
      },
      undo() { if (!undo.length) return; redo.push(text); text = undo.pop(); current = checked(text); },
      redo() { if (!redo.length) return; undo.push(text); text = redo.pop(); current = checked(text); },
      markSaved(snapshot) { savedText = snapshot; },
      exportBytes() { return text === format.text ? format.bytes.slice() : encode(text, format); }
    };
    return doc;
  }
  function routes(data) {
    const list = [];
    function walk(nodes, path, depth) {
      nodes.forEach((value, i) => {
        const nodePath = [...path, i];
        const kind = String(value.current_model || "").startsWith("pretreat:") ? "pretreat" : value.current_model ? "model" : "result";
        list.push({ path: nodePath, value, depth, kind, title: nodeTitle(value) });
        walk(value.childlist, [...nodePath, "childlist"], depth + 1);
      });
    }
    walk(data.model_route, ["model_route"], 0);
    return list;
  }
  function diff(before, after) {
    const a = parse(before), b = parse(after), changes = [];
    function visit(path) {
      const x = a.nodes.get(keyOf(path)), y = b.nodes.get(keyOf(path));
      const old = x ? before.slice(x.start, x.end) : undefined;
      const next = y ? after.slice(y.start, y.end) : undefined;
      if (old === next) return;
      if (x && y && x.children.length && y.children.length && Array.isArray(x.value) === Array.isArray(y.value)) {
        const keys = new Set([...x.children, ...y.children].map(n => keyOf(n.path)));
        for (const key of keys) visit(JSON.parse(key));
      } else changes.push({ path, before: old, after: next });
    }
    visit([]);
    return changes;
  }
  function defaultName(name, date = new Date()) {
    const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return name.replace(/\.json$/i, "") + "_edited_" + stamp + ".json";
  }
  function validateName(name, sourceName) {
    if (!name || name.trim() !== name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) || !/\.json$/i.test(name)) {
      throw new Error("请输入合法的新文件名，以 .json 结尾。");
    }
    if (sameName(name, sourceName)) throw new Error("不能使用源文件名，请为副本使用新的名称。");
  }
  // The only writing entry point receives a destination directory, never the source
  // file handle. Existing names are refused before a writable stream is requested.
  async function saveNewFile(directory, name, sourceName, bytes) {
    validateName(name, sourceName);
    try {
      await directory.getFileHandle(name);
      throw new Error("目标文件已存在，请换一个名称。不会覆盖已有文件。");
    } catch (error) { if (error.name !== "NotFoundError") throw error; }
    const target = await directory.getFileHandle(name, { create: true });
    const stream = await target.createWritable();
    try { await stream.write(bytes); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch {} throw error; }
    return name;
  }
  return { fieldInfo, nodeTitle, nodeTarget, nodeLabelKey, nodeLabel, decode, encode, parse, validate, createDocument, routes, diff, keyOf, defaultName, validateName, saveNewFile };
});
