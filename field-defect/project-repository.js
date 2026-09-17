(function (root) {
  "use strict";
  const Core = root.FieldDefectCore;

  function assertDirectoryApi() {
    if (!window.showDirectoryPicker) throw new Error("当前浏览器不支持文件夹选择，请使用 Chrome 或 Edge");
  }

  async function verifyPermission(handle, mode) {
    if (!handle) return false;
    const options = { mode: mode || "read" };
    if ((await handle.queryPermission(options)) === "granted") return true;
    return (await handle.requestPermission(options)) === "granted";
  }

  async function getDirectoryHandle(rootHandle, relativePath, options) {
    let current = rootHandle;
    const parts = Core.normalizePath(relativePath).split("/").filter(Boolean);
    for (const part of parts) current = await current.getDirectoryHandle(part, options);
    return current;
  }

  async function getFileHandle(rootHandle, relativePath, options) {
    const normalized = Core.normalizePath(relativePath);
    const parts = normalized.split("/").filter(Boolean);
    const name = parts.pop();
    const parent = parts.length ? await getDirectoryHandle(rootHandle, parts.join("/"), options) : rootHandle;
    return parent.getFileHandle(name, options);
  }

  async function readProject(rootHandle) {
    try {
      const handle = await getFileHandle(rootHandle, Core.PROJECT_FILE_NAME);
      const file = await handle.getFile();
      return Core.normalizeProject(JSON.parse(await file.text()));
    } catch (error) {
      if (error && error.name === "NotFoundError") return null;
      throw new Error("工程配置读取失败: " + (error.message || error));
    }
  }

  async function writeProject(rootHandle, project) {
    const handle = await getFileHandle(rootHandle, Core.PROJECT_FILE_NAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(Core.normalizeProject(project), null, 2));
    await writable.close();
  }

  async function hashBlob(blob) {
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function scanDirectory(rootHandle, onProgress) {
    const files = [];
    async function walk(directory, prefix) {
      for await (const entry of directory.values()) {
        const relative = prefix ? prefix + "/" + entry.name : entry.name;
        // 应用管理的对比图和原始缺陷副本不属于工程原图，扫描时必须整体排除。
        if (entry.kind === "directory" && !Core.isManagedProjectPath(relative)) await walk(entry, relative);
        else if (entry.kind === "file" && Core.isSupportedImagePath(relative)) {
          files.push({ path: relative, handle: entry });
          if (onProgress) onProgress({ phase: "discover", current: files.length, total: 0, path: relative });
        }
      }
    }
    await walk(rootHandle, "");
    const results = [];
    let completed = 0;
    for (const item of files) {
      try {
        const file = await item.handle.getFile();
        results.push({ path: Core.normalizePath(item.path), hash: await hashBlob(file), size: file.size, type: file.type || Core.mediaMimeType(item.path) });
      } catch (error) {
        results.push({ path: Core.normalizePath(item.path), hash: "", error: error.message || String(error) });
      }
      completed += 1;
      if (onProgress) onProgress({ phase: "scan", current: completed, total: files.length, path: item.path });
    }
    return results;
  }

  async function readBlob(rootHandle, relativePath) {
    const handle = await getFileHandle(rootHandle, relativePath);
    return handle.getFile();
  }

  async function writeBlob(rootHandle, relativePath, blob) {
    const handle = await getFileHandle(rootHandle, relativePath, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function removeFile(rootHandle, relativePath) {
    const normalized = Core.normalizePath(relativePath);
    const parts = normalized.split("/").filter(Boolean);
    const name = parts.pop();
    const parent = parts.length ? await getDirectoryHandle(rootHandle, parts.join("/")) : rootHandle;
    await parent.removeEntry(name);
  }

  async function removeDirectory(rootHandle, relativePath) {
    const normalized = Core.normalizePath(relativePath);
    const parts = normalized.split("/").filter(Boolean);
    const name = parts.pop();
    const parent = parts.length ? await getDirectoryHandle(rootHandle, parts.join("/")) : rootHandle;
    await parent.removeEntry(name, { recursive: true });
  }

  async function copyDirectory(sourceHandle, rootHandle, destinationPath, onProgress) {
    const files = [];
    const directories = [""];
    async function discover(directory, prefix) {
      for await (const entry of directory.values()) {
        const relative = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.kind === "directory") {
          directories.push(relative);
          await discover(entry, relative);
        }
        else if (entry.kind === "file") {
          files.push({ relative, handle: entry });
          if (onProgress) onProgress({ phase: "discover", current: files.length, total: 0, path: relative });
        }
      }
    }
    try {
      await discover(sourceHandle, "");
      // 先创建目录树，确保源文件夹中的空目录也能原样保留。
      for (const relative of directories) {
        const target = relative ? destinationPath + "/" + relative : destinationPath;
        await getDirectoryHandle(rootHandle, target, { create: true });
      }
      let completed = 0;
      for (const item of files) {
        const file = await item.handle.getFile();
        await writeBlob(rootHandle, Core.normalizePath(destinationPath + "/" + item.relative), file);
        completed += 1;
        if (onProgress) onProgress({ phase: "copy", current: completed, total: files.length, path: item.relative });
      }
      return { total: files.length };
    } catch (error) {
      try { await removeDirectory(rootHandle, destinationPath); } catch (cleanupError) { /* 目标可能尚未创建。 */ }
      throw error;
    }
  }

  async function createProject(rootHandle, name, onProgress) {
    const scanned = await scanDirectory(rootHandle, onProgress);
    const summary = Core.prepareScanImages(scanned);
    const project = Core.normalizeProject({
      name,
      rootDisplayName: rootHandle.name,
      images: summary.images,
      defects: Core.DEFAULT_DEFECT_NAMES.map((defectName, index) => ({
        id: "default-defect-" + String(index + 1).padStart(3, "0"),
        name: defectName,
        disabled: false
      }))
    });
    return { project, summary };
  }

  root.FieldDefectRepository = {
    assertDirectoryApi,
    verifyPermission,
    getDirectoryHandle,
    getFileHandle,
    readProject,
    writeProject,
    hashBlob,
    scanDirectory,
    readBlob,
    writeBlob,
    removeFile,
    removeDirectory,
    copyDirectory,
    createProject
  };
})(globalThis);
