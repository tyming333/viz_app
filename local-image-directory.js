(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./viewer-core.js") : root.ViewerCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LocalImageDirectory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";
  function error(code, message) { return Object.assign(new Error(message), { code }); }
  function normalize(path) { return String(path || "").replace(/\\/g, "/").replace(/\/+$/, ""); }
  function sourcePath(selected) {
    const local = core.getLocalImagePath(selected.source);
    if (local) return normalize(local);
    const name = normalize(selected.image);
    if (/^[a-z]:\//i.test(name) || name.startsWith("//")) return name;
    try {
      const url = new URL(selected.source);
      if (/^https?:$/.test(url.protocol)) return normalize(url.origin + decodeURIComponent(url.pathname));
    } catch (_) {}
    return name;
  }
  function relativePath(path, root) {
    path = normalize(path); root = normalize(root);
    const windows = /^[a-z]:\//i.test(path) || path.startsWith("//");
    const compare = value => windows ? value.toLowerCase() : value;
    if (!compare(path).startsWith(compare(root + "/"))) return null;
    const parts = path.slice(root.length + 1).split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part.includes("\0"))) return null;
    return parts;
  }
  async function readFile(handle, parts) {
    let directory = handle;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return (await directory.getFileHandle(parts[parts.length - 1])).getFile();
  }
  function candidateRoots(selected, directoryName) {
    const path = sourcePath(selected), roots = new Set();
    for (let index = path.indexOf("/"); index >= 0; index = path.indexOf("/", index + 1)) {
      const prefix = path.slice(0, index);
      if (prefix.split("/").pop().toLowerCase() === directoryName.toLowerCase()) roots.add(prefix);
    }
    const name = normalize(selected.image);
    if (name && !/^(?:[a-z]+:|\/)/i.test(name) && path.endsWith("/" + name)) roots.add(path.slice(0, -name.length - 1));
    // Selecting the image's immediate directory also works after moving/renaming that directory.
    roots.add(path.slice(0, path.lastIndexOf("/")));
    return [...roots].filter(root => relativePath(path, root));
  }
  function browserStorage() {
    const database = new Promise((resolve, reject) => {
      const request = indexedDB.open("viz-app-image-directories", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("directories");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("目录授权存储被其他页面占用"));
    });
    database.catch(() => {});
    return {
      async load() {
        const db = await database;
        return new Promise((resolve, reject) => {
          const request = db.transaction("directories").objectStore("directories").get("authorized");
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      },
      async save(mappings) {
        const db = await database;
        return new Promise((resolve, reject) => {
          const transaction = db.transaction("directories", "readwrite");
          transaction.objectStore("directories").put(mappings, "authorized");
          transaction.oncomplete = resolve;
          transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("目录授权保存失败"));
        });
      }
    };
  }
  function createManager(storage = browserStorage()) {
    let mappings = [], persistenceError = null;
    const ready = storage.load().then(saved => { mappings = saved.filter(item => item.handle && typeof item.root === "string"); }).catch(reason => { persistenceError = reason; });
    function matching(selected) {
      const path = sourcePath(selected);
      return mappings.filter(item => relativePath(path, item.root)).sort((a, b) => b.root.length - a.root.length)[0] || null;
    }
    async function read(selected) {
      await ready;
      const item = matching(selected);
      if (!item) return null;
      if (await item.handle.queryPermission({ mode: "read" }) !== "granted") throw error("directory-permission", "图片文件夹需要重新授权");
      try { return await readFile(item.handle, relativePath(sourcePath(selected), item.root)); }
      catch (reason) {
        if (reason.name === "NotAllowedError" || reason.name === "SecurityError") throw error("directory-permission", "图片文件夹需要重新授权");
        throw error("directory-file", "已授权目录中找不到当前原图，请检查目录映射或更换文件夹");
      }
    }
    async function register(handle, selected, root, validate) {
      await ready;
      const candidates = root === undefined ? candidateRoots(selected, handle.name) : [normalize(root)];
      const found = [];
      for (const candidate of candidates) {
        const parts = relativePath(sourcePath(selected), candidate);
        if (!parts) continue;
        try { found.push({ root: candidate, file: await readFile(handle, parts) }); }
        catch (reason) {
          if (reason.name !== "NotFoundError" && reason.name !== "TypeMismatchError") throw reason;
        }
      }
      if (found.length !== 1) throw error("directory-map", found.length ? "存在多种目录对应关系，请填写当前原图路径中与所选文件夹对应的根目录" : "所选文件夹中未找到原图，请检查目录映射或更换文件夹");
      if (validate) await validate(found[0].file);
      const item = { root: found[0].root, handle };
      const windows = /^[a-z]:\//i.test(item.root) || item.root.startsWith("//");
      mappings = mappings.filter(previous => windows ? previous.root.toLowerCase() !== item.root.toLowerCase() : previous.root !== item.root).concat(item);
      try { await storage.save(mappings); persistenceError = null; }
      catch (reason) { persistenceError = reason; }
      return item;
    }
    async function requestAccess(selected) {
      await ready;
      const item = matching(selected);
      return !!item && await item.handle.requestPermission({ mode: "read" }) === "granted";
    }
    return { ready, read, register, requestAccess, matching, sourcePath, persistenceError: () => persistenceError };
  }
  return { sourcePath, relativePath, candidateRoots, createManager };
});
