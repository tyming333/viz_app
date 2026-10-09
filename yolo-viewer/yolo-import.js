(function () {
  "use strict";
  const core = window.YoloCore;
  const viewer = window.YoloViewer;
  const directoryInput = document.getElementById("yoloDirectoryInput");
  const mappingInput = document.getElementById("yoloMappingInput");
  const loadButton = document.getElementById("yoloLoadBtn");
  const missingAsNegative = document.getElementById("yoloMissingAsNegative");
  const exportButtons = [document.getElementById("downloadJsonBtn"), document.getElementById("exportSelectedBtn")];
  let files = [];
  let dataset = { mapping: {}, images: new Map(), urls: new Map() };
  let busy = false;

  function setBusy(value) {
    busy = value;
    [directoryInput, mappingInput, missingAsNegative].forEach(input => { input.disabled = value; });
    loadButton.disabled = value || !files.length;
    exportButtons.forEach(button => { button.disabled = value || !dataset.images.size; });
  }

  function renderIssues(issues) {
    document.getElementById("yoloIssues").hidden = !issues.length;
    document.getElementById("yoloIssuesSummary").textContent = "数据问题 (" + issues.length + ")";
    const list = document.getElementById("yoloIssuesList");
    list.replaceChildren();
    const fragment = document.createDocumentFragment();
    issues.forEach(issue => {
      const item = document.createElement("li");
      item.textContent = issue.path + ": " + issue.message;
      fragment.appendChild(item);
    });
    list.appendChild(fragment);
  }

  function imageSize(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => finish(new Error("读取图片尺寸超时")), 20000);
      function finish(error) {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (error) reject(error);
        else resolve({ width: image.naturalWidth, height: image.naturalHeight });
      }
      image.onload = () => finish(image.naturalWidth ? null : new Error("图片尺寸无效"));
      image.onerror = () => finish(new Error("无法读取图片"));
      image.src = url;
    });
  }

  async function load() {
    if (busy || !files.length) return;
    setBusy(true);
    const next = { mapping: {}, images: new Map(), urls: new Map() };
    try {
      const indexed = core.indexFiles(files);
      if (!indexed.images.length) throw new Error("文件夹中没有可配对的图片");
      const mappingFile = mappingInput.files[0] || indexed.mappings[0]?.file;
      if (!mappingFile) throw new Error("未找到标签映射，请选择 JSON、data.yaml 或 classes.txt");
      next.mapping = core.parseMapping(await mappingFile.text(), mappingFile.name, window.jsyaml);
      const mappingName = document.getElementById("yoloMappingName");
      mappingName.textContent = mappingFile.name;
      mappingName.title = mappingFile.name;
      const issues = indexed.issues.slice();
      const data = Object.create(null);
      let cursor = 0, completed = 0;
      const includeMissing = missingAsNegative.checked;
      async function worker() {
        while (cursor < indexed.images.length) {
          const item = indexed.images[cursor++];
          let url;
          try {
            if (!item.label && !includeMissing) throw new Error("缺少同名 TXT，已跳过");
            url = URL.createObjectURL(item.file);
            const size = await imageSize(url);
            const objects = core.parseAnnotations(item.label ? await item.label.text() : "", next.mapping, size.width, size.height);
            data[item.path] = { det: { objects } };
            next.images.set(item.path, { file: item.file, ...size });
            next.urls.set(item.path, url);
            if (!item.label) issues.push({ path: item.path, message: "缺少 TXT，按负样本加载" });
          } catch (error) {
            if (url) URL.revokeObjectURL(url);
            issues.push({ path: item.label ? item.txtPath : item.path, message: error.message });
          }
          completed++;
          viewer.setStatus("读取数据 " + completed + "/" + indexed.images.length, completed / indexed.images.length * 100);
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, indexed.images.length) }, worker));
      renderIssues(issues.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true })));
      if (!next.images.size) throw new Error("没有成功加载的图片，请查看数据问题清单");
      const orderedData = Object.create(null);
      indexed.images.forEach(item => { if (Object.hasOwn(data, item.path)) orderedData[item.path] = data[item.path]; });
      const previous = dataset;
      dataset = next;
      const select = document.getElementById("labelsEditor");
      select.replaceChildren();
      Object.entries(next.mapping).forEach(([id, name]) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = id + ": " + name;
        select.appendChild(option);
      });
      viewer.load(orderedData, next.images);
      previous.urls.forEach(url => URL.revokeObjectURL(url));
      viewer.setStatus("已加载 " + next.images.size + " 张图片" + (issues.length ? "，数据问题 " + issues.length + " 项" : ""), 100);
    } catch (error) {
      if (dataset !== next) next.urls.forEach(url => URL.revokeObjectURL(url));
      viewer.setStatus("加载失败: " + error.message, 0);
    } finally {
      setBusy(false);
    }
  }

  async function exportData(names) {
    if (busy) return;
    if (!names.length) { viewer.setStatus("请先勾选要导出的图片", 0); return; }
    setBusy(true);
    try {
      // Validate every annotation before constructing the archive.
      const texts = new Map(names.map(name => {
        const image = dataset.images.get(name);
        if (!image) throw new Error(name + ": 原图不可用");
        try { return [core.pathStem(name) + ".txt", core.serializeAnnotations(viewer.state.data[name].det.objects, dataset.mapping, image.width, image.height)]; }
        catch (error) { throw new Error(name + ": " + error.message); }
      }));
      const archive = Object.create(null);
      archive["labels.json"] = window.fflate.strToU8(JSON.stringify(dataset.mapping, null, 2));
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        archive[name] = [new Uint8Array(await dataset.images.get(name).file.arrayBuffer()), { level: 0 }];
        const txtPath = core.pathStem(name) + ".txt";
        archive[txtPath] = window.fflate.strToU8(texts.get(txtPath));
        viewer.setStatus("准备导出 " + (i + 1) + "/" + names.length, (i + 1) / names.length * 80);
      }
      const bytes = await new Promise((resolve, reject) => window.fflate.zip(archive, { level: 1 }, (error, result) => error ? reject(error) : resolve(result)));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "yolo_dataset_edited.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      viewer.setStatus("已导出 " + names.length + " 张图片及 YOLO 标注", 100);
    } catch (error) {
      viewer.setStatus("导出失败: " + error.message, 0);
    } finally {
      setBusy(false);
    }
  }

  window.YoloDataset = {
    imageUrl: name => dataset.urls.get(name) || "",
    defaultLabel: () => Object.values(dataset.mapping)[0] || "",
    labels: () => Object.values(dataset.mapping),
    exportData
  };
  directoryInput.addEventListener("change", () => {
    files = Array.from(directoryInput.files);
    const name = files[0]?.webkitRelativePath.split("/")[0] || "未选择文件夹";
    document.getElementById("yoloDirectoryName").textContent = name;
    document.getElementById("yoloDirectoryName").title = name;
    mappingInput.value = "";
    document.getElementById("yoloMappingName").textContent = "自动识别";
    renderIssues([]);
    setBusy(false);
  });
  mappingInput.addEventListener("change", () => {
    const name = mappingInput.files[0]?.name || "自动识别";
    document.getElementById("yoloMappingName").textContent = name;
    document.getElementById("yoloMappingName").title = name;
  });
  loadButton.addEventListener("click", load);
  setBusy(false);
})();
