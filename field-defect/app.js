(function () {
  "use strict";

  const Core = window.FieldDefectCore;
  const Repo = window.FieldDefectRepository;
  const Store = window.FieldDefectStore;
  const els = {
    projectList: document.getElementById("projectList"),
    historyEmpty: document.getElementById("historyEmpty"),
    projectCount: document.getElementById("projectCount"),
    historySort: document.getElementById("historySort"),
    projectName: document.getElementById("projectName"),
    projectPath: document.getElementById("projectPath"),
    imageCount: document.getElementById("imageCount"),
    defectCount: document.getElementById("defectCount"),
    filteredImageCount: document.getElementById("filteredImageCount"),
    imageTableBody: document.getElementById("imageTableBody"),
    imageEmpty: document.getElementById("imageEmpty"),
    imageSearch: document.getElementById("imageSearch"),
    defectFilterMenu: document.getElementById("defectFilterMenu"),
    defectFilterText: document.getElementById("defectFilterText"),
    defectFilterOptions: document.getElementById("defectFilterOptions"),
    imageSort: document.getElementById("imageSort"),
    defectList: document.getElementById("defectList"),
    defectEmpty: document.getElementById("defectEmpty"),
    newProjectBtn: document.getElementById("newProjectBtn"),
    rescanBtn: document.getElementById("rescanBtn"),
    importExcelBtn: document.getElementById("importExcelBtn"),
    importOriginalDefectsBtn: document.getElementById("importOriginalDefectsBtn"),
    originalDefectsMenu: document.getElementById("originalDefectsMenu"),
    originalDefectsSummary: document.getElementById("originalDefectsSummary"),
    originalDefectsList: document.getElementById("originalDefectsList"),
    reconnectBtn: document.getElementById("reconnectBtn"),
    configureDefectsBtn: document.getElementById("configureDefectsBtn"),
    addDefectBtn: document.getElementById("addDefectBtn"),
    projectDialog: document.getElementById("projectDialog"),
    projectForm: document.getElementById("projectForm"),
    projectNameInput: document.getElementById("projectNameInput"),
    chooseFolderBtn: document.getElementById("chooseFolderBtn"),
    chosenFolderText: document.getElementById("chosenFolderText"),
    defectDialog: document.getElementById("defectDialog"),
    defectForm: document.getElementById("defectForm"),
    defectNameInput: document.getElementById("defectNameInput"),
    imageModal: document.getElementById("imageModal"),
    closeImageModal: document.getElementById("closeImageModal"),
    comparisonGrid: document.getElementById("comparisonGrid"),
    addVehicleCameraBtn: document.getElementById("addVehicleCameraBtn"),
    modalSequence: document.getElementById("modalSequence"),
    modalPoleNumber: document.getElementById("modalPoleNumber"),
    modalSource: document.getElementById("modalSource"),
    modalSaveStatus: document.getElementById("modalSaveStatus"),
    modalDefectOptions: document.getElementById("modalDefectOptions"),
    prevImageBtn: document.getElementById("prevImageBtn"),
    nextImageBtn: document.getElementById("nextImageBtn"),
    progressToast: document.getElementById("progressToast"),
    progressMessage: document.getElementById("progressMessage"),
    progressBar: document.getElementById("progressBar")
  };

  const state = {
    history: [],
    current: null,
    selectedFolder: null,
    imageUrls: new Map(),
    defectFilters: new Set(),
    modalImages: [],
    modalIndex: -1,
    modalViews: new Map(),
    modalSaving: false,
    modalChanged: false
  };

  const HISTORY_SORT_KEY = "field-defect-history-sort";
  const savedHistorySort = localStorage.getItem(HISTORY_SORT_KEY);
  state.historySort = ["created-desc", "created-asc", "name-asc", "name-desc"].includes(savedHistorySort) ? savedHistorySort : "created-desc";

  function setStatus(message, percent) {
    els.progressToast.hidden = false;
    els.progressMessage.textContent = message;
    els.progressBar.value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (percent >= 100) window.setTimeout(() => { els.progressToast.hidden = true; }, 900);
  }

  function closeDialog(id) { const element = document.getElementById(id); if (element) element.hidden = true; }
  function openDialog(id) { const element = document.getElementById(id); if (element) element.hidden = false; }

  function currentProject() { return state.current && state.current.project; }

  function setProjectButtons(enabled) {
    [els.rescanBtn, els.importExcelBtn, els.importOriginalDefectsBtn, els.reconnectBtn, els.configureDefectsBtn, els.addDefectBtn].forEach((button) => { button.disabled = !enabled; });
    els.originalDefectsMenu.classList.toggle("disabled", !enabled);
    if (!enabled) els.originalDefectsMenu.open = false;
  }

  function projectRecord(project, handle) {
    const existing = state.history.find((record) => record.id === project.id);
    return {
      id: project.id,
      name: project.name,
      rootDisplayName: project.rootDisplayName,
      // 旧历史记录没有创建时间时继续保持为空，避免仅因打开工程改变列表位置。
      createdAt: existing ? String(existing.createdAt || "") : project.createdAt,
      lastOpenedAt: new Date().toISOString(),
      handle
    };
  }

  async function saveCurrent() {
    if (!state.current) return;
    await Repo.writeProject(state.current.handle, state.current.project);
    await Store.save(projectRecord(state.current.project, state.current.handle));
  }

  function clearImageUrls() {
    state.imageUrls.forEach((url) => URL.revokeObjectURL(url));
    state.imageUrls.clear();
  }

  async function imageUrl(image) {
    const key = image.path + "\n" + image.hash;
    if (state.imageUrls.has(key)) return state.imageUrls.get(key);
    const blob = await Repo.readBlob(state.current.handle, image.path);
    const url = URL.createObjectURL(blob);
    state.imageUrls.set(key, url);
    return url;
  }

  function filteredImages() {
    const project = currentProject();
    if (!project) return [];
    return Core.filterAndSortImages(project.images, project.defects, {
      query: els.imageSearch.value,
      defectIds: Array.from(state.defectFilters),
      sort: els.imageSort.value
    });
  }

  function renderFilterControls() {
    const project = currentProject();
    const defects = project ? project.defects : [];
    const validIds = new Set(["__none__", ...defects.map((defect) => defect.id)]);
    state.defectFilters.forEach((id) => { if (!validIds.has(id)) state.defectFilters.delete(id); });
    els.defectFilterOptions.replaceChildren();
    els.defectFilterMenu.classList.toggle("disabled", !project);
    els.defectFilterMenu.setAttribute("aria-disabled", String(!project));
    if (!project) els.defectFilterMenu.open = false;

    const choices = [{ id: "__none__", name: "未添加缺陷" }, ...defects.map((defect) => ({ id: defect.id, name: defect.name }))];
    choices.forEach((choice) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = choice.id;
      checkbox.checked = state.defectFilters.has(choice.id);
      checkbox.disabled = !project;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.defectFilters.add(choice.id);
        else state.defectFilters.delete(choice.id);
        clear.disabled = state.defectFilters.size === 0;
        updateFilterSummary();
        renderImages();
      });
      label.append(checkbox, document.createTextNode(choice.name));
      els.defectFilterOptions.appendChild(label);
    });
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "清空筛选";
    clear.disabled = !project || state.defectFilters.size === 0;
    clear.addEventListener("click", () => {
      state.defectFilters.clear();
      renderFilterControls();
      renderImages();
    });
    els.defectFilterOptions.appendChild(clear);
    updateFilterSummary();
  }

  function updateFilterSummary() {
    const project = currentProject();
    if (!project || state.defectFilters.size === 0) {
      els.defectFilterText.textContent = "全部缺陷";
      return;
    }
    const names = new Map(project.defects.map((defect) => [defect.id, defect.name]));
    const selectedNames = Array.from(state.defectFilters, (id) => id === "__none__" ? "未添加缺陷" : names.get(id)).filter(Boolean);
    els.defectFilterText.textContent = selectedNames.length === 1 ? selectedNames[0] : "已选 " + selectedNames.length + " 项";
  }

  function defectNameMap() {
    return new Map((currentProject()?.defects || []).map((defect) => [defect.id, defect.name]));
  }

  function persistedTextInput(image, field, label, options) {
    const settings = options || {};
    const input = document.createElement(settings.multiline ? "textarea" : "input");
    if (!settings.multiline) input.type = "text";
    input.className = settings.className || "table-text-input";
    input.value = image[field] || "";
    input.maxLength = settings.maxLength || 500;
    input.placeholder = settings.placeholder || "填写" + label;
    input.setAttribute("aria-label", label);
    input.addEventListener("keydown", (event) => {
      if (!settings.multiline && event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
    input.addEventListener("change", async () => {
      const previous = image[field] || "";
      const next = input.value.trim();
      if (next === previous) return;
      image[field] = next;
      input.disabled = true;
      try {
        await saveCurrent();
        input.value = next;
        if (settings.onSaved) settings.onSaved();
      } catch (error) {
        image[field] = previous;
        input.value = previous;
        setStatus("保存" + label + "失败: " + (error.message || error), 0);
      } finally {
        input.disabled = false;
      }
    });
    return input;
  }

  async function renderImages() {
    const project = currentProject();
    clearImageUrls();
    els.imageTableBody.replaceChildren();
    const images = filteredImages();
    els.filteredImageCount.textContent = String(Core.imageStatistics(project, images).filteredImages);
    els.imageEmpty.hidden = Boolean(images.length);
    if (!project) els.imageEmpty.textContent = "选择一个工程后显示图片。";
    if (!images.length && project) els.imageEmpty.textContent = "当前工程没有图片。可以扫描目录或导入 Excel 图片。";
    const nameMap = defectNameMap();
    images.forEach((image) => {
      const row = document.createElement("tr");
      const thumbCell = document.createElement("td");
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "thumb-wrap";
      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.alt = image.path;
      thumb.loading = "lazy";
      thumb.addEventListener("click", () => openImageModal(image.path));
      imageUrl(image).then((url) => { thumb.src = url; }).catch(() => { thumb.alt = "图片读取失败: " + image.path; });
      const sequence = document.createElement("span");
      sequence.className = "thumb-index";
      sequence.textContent = String(Core.imageSequenceNumber(project.images, image));
      sequence.setAttribute("aria-label", "图片序号 " + sequence.textContent);
      thumbWrap.append(thumb, sequence);
      thumbCell.appendChild(thumbWrap);
      row.appendChild(thumbCell);

      const poleCell = document.createElement("td");
      poleCell.appendChild(persistedTextInput(image, "poleNumber", "杆号", { maxLength: 100 }));
      row.appendChild(poleCell);

      const defectCell = document.createElement("td");
      const picker = document.createElement("details");
      picker.className = "defect-picker";
      const summary = document.createElement("summary");
      const updateSummary = () => {
        const names = image.defects.map((id) => nameMap.get(id)).filter(Boolean);
        summary.textContent = names.length ? names.join("、") : "未添加";
        summary.title = summary.textContent;
      };
      updateSummary();
      picker.appendChild(summary);
      const options = document.createElement("div");
      options.className = "defect-options";
      (project.defects || []).filter((defect) => !defect.disabled || image.defects.includes(defect.id)).forEach((defect) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = defect.id;
        checkbox.checked = image.defects.includes(defect.id);
        checkbox.disabled = defect.disabled;
        label.append(checkbox, document.createTextNode(defect.name + (defect.disabled ? "（已停用）" : "")));
        options.appendChild(label);
      });
      if (!options.children.length) options.textContent = "请先配置缺陷";
      picker.addEventListener("change", async () => {
        const previous = image.defects.slice();
        image.defects = Array.from(options.querySelectorAll('input[type="checkbox"]:checked'), (checkbox) => checkbox.value);
        updateSummary();
        try {
          await saveCurrent();
          if (state.defectFilters.size || els.imageSort.value !== "original") renderImages();
        } catch (error) {
          image.defects = previous;
          Array.from(options.querySelectorAll('input[type="checkbox"]')).forEach((checkbox) => { checkbox.checked = previous.includes(checkbox.value); });
          updateSummary();
          setStatus("保存缺陷失败: " + error.message, 0);
        }
      });
      picker.appendChild(options);
      defectCell.appendChild(picker);
      row.appendChild(defectCell);

      const remarkCell = document.createElement("td");
      remarkCell.appendChild(persistedTextInput(image, "remark", "备注", { maxLength: 500, multiline: true, className: "table-text-input remark-input" }));
      row.appendChild(remarkCell);

      const actionCell = document.createElement("td");
      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.textContent = "查看";
      viewButton.addEventListener("click", () => openImageModal(image.path));
      actionCell.appendChild(viewButton);
      row.appendChild(actionCell);
      els.imageTableBody.appendChild(row);
    });
    // 缩略图已在创建时逐张异步加载，不再重复预读同一图片。
  }

  function renderOriginalDefects() {
    const project = currentProject();
    const folders = project ? project.originalDefectFolders || [] : [];
    els.originalDefectsSummary.textContent = "原始缺陷（" + folders.length + "）";
    els.originalDefectsList.replaceChildren();
    if (!folders.length) {
      const empty = document.createElement("span");
      empty.className = "toolbar-menu-empty";
      empty.textContent = "尚未上传原始缺陷文件夹";
      els.originalDefectsList.appendChild(empty);
      return;
    }
    folders.forEach((folder) => {
      const row = document.createElement("div");
      row.className = "original-folder-row";
      const name = document.createElement("span");
      name.textContent = folder.name;
      name.title = folder.path;
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "打开";
      open.disabled = true;
      Repo.getDirectoryHandle(state.current.handle, folder.path).then((target) => {
        open.disabled = false;
        open.addEventListener("click", () => openOriginalDefectFolder(folder, target));
      }).catch(() => {
        open.title = "工程内找不到该文件夹";
      });
      row.append(name, open);
      els.originalDefectsList.appendChild(row);
    });
  }

  function renderDefects() {
    const project = currentProject();
    els.defectList.replaceChildren();
    const defects = project ? project.defects : [];
    els.defectEmpty.hidden = Boolean(defects.length);
    defects.forEach((defect) => {
      const row = document.createElement("div");
      row.className = "defect-row";
      const label = document.createElement("span");
      label.textContent = defect.name;
      if (defect.disabled) {
        const disabled = document.createElement("small");
        disabled.textContent = "已停用";
        label.appendChild(disabled);
      }
      row.appendChild(label);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = defect.disabled ? "启用" : "停用";
      remove.addEventListener("click", async () => {
        defect.disabled = !defect.disabled;
        await saveCurrent();
        renderAll();
      });
      row.appendChild(remove);
      els.defectList.appendChild(row);
    });
  }

  function renderProjectHeader() {
    const project = currentProject();
    const stats = Core.imageStatistics(project, project ? filteredImages() : []);
    els.projectName.textContent = project ? project.name : "未选择工程";
    els.projectPath.textContent = project ? (project.rootDisplayName || "已授权工程文件夹") : "选择一个工程文件夹开始。";
    els.imageCount.textContent = String(stats.totalImages);
    els.defectCount.textContent = String(stats.totalDefects);
    els.filteredImageCount.textContent = String(stats.filteredImages);
  }

  function renderHistory() {
    els.projectList.replaceChildren();
    els.projectCount.textContent = state.history.length;
    els.historyEmpty.hidden = Boolean(state.history.length);
    Core.sortHistoryRecords(state.history, state.historySort).forEach((record) => {
      const button = document.createElement("button");
      button.className = "project-item" + (state.current && state.current.project.id === record.id ? " active" : "");
      button.type = "button";
      const title = document.createElement("strong");
      title.textContent = record.name;
      const path = document.createElement("small");
      path.textContent = record.rootDisplayName || "工程文件夹";
      button.append(title, path);
      button.addEventListener("click", () => openHistoryProject(record));
      els.projectList.appendChild(button);
    });
  }

  function renderAll() {
    renderProjectHeader();
    renderHistory();
    renderDefects();
    renderFilterControls();
    renderOriginalDefects();
    renderImages();
    setProjectButtons(Boolean(state.current));
  }

  async function openHistoryProject(record) {
    try {
      setStatus("正在打开工程...", 15);
      if (!(await Repo.verifyPermission(record.handle, "readwrite"))) throw new Error("未获得工程文件夹权限");
      const project = await Repo.readProject(record.handle);
      if (!project) throw new Error("工程配置不存在，请重新新建工程");
      state.current = { project, handle: record.handle };
      await Store.save(projectRecord(project, record.handle));
      state.history = await Store.list();
      renderAll();
      setStatus("工程已打开", 100);
    } catch (error) { setStatus("打开工程失败: " + (error.message || error), 0); }
  }

  async function chooseFolder() {
    try {
      Repo.assertDirectoryApi();
      state.selectedFolder = await window.showDirectoryPicker({ mode: "readwrite" });
      els.chosenFolderText.textContent = state.selectedFolder.name;
    } catch (error) {
      if (error && error.name !== "AbortError") setStatus("选择文件夹失败: " + (error.message || error), 0);
    }
  }

  async function createProject(event) {
    event.preventDefault();
    if (!state.selectedFolder) { setStatus("请先选择工程文件夹", 0); return; }
    const name = els.projectNameInput.value.trim();
    if (!name) return;
    try {
      setStatus("正在递归扫描图片...", 0);
      const existing = await Repo.readProject(state.selectedFolder);
      if (existing) {
        state.current = { project: existing, handle: state.selectedFolder };
        await Store.save(projectRecord(existing, state.selectedFolder));
        state.history = await Store.list();
        closeDialog("projectDialog");
        renderAll();
        setStatus("该文件夹已有工程，已打开现有工程", 100);
        return;
      }
      const created = await Repo.createProject(state.selectedFolder, name, (progress) => {
        if (progress.phase === "discover") {
          setStatus("正在发现图片，已找到 " + progress.current + " 张", 5);
          return;
        }
        const percent = progress.total ? 10 + Math.round(progress.current / progress.total * 90) : 100;
        setStatus("正在扫描图片 " + progress.current + "/" + progress.total, percent);
      });
      const project = created.project;
      await Repo.writeProject(state.selectedFolder, project);
      await Store.save(projectRecord(project, state.selectedFolder));
      state.current = { project, handle: state.selectedFolder };
      state.history = await Store.list();
      state.selectedFolder = null;
      els.projectForm.reset();
      els.chosenFolderText.textContent = "尚未选择";
      closeDialog("projectDialog");
      renderAll();
      setStatus("工程创建完成：图片 " + project.images.length + "，重复 " + created.summary.duplicates + "，失败 " + created.summary.failed, 100);
    } catch (error) { setStatus("创建工程失败: " + (error.message || error), 0); }
  }

  async function rescan() {
    if (!state.current) return;
    try {
      if (!(await Repo.verifyPermission(state.current.handle, "readwrite"))) throw new Error("未获得工程文件夹权限");
      const previousImages = state.current.project.images;
      const scanned = await Repo.scanDirectory(state.current.handle, (progress) => {
        if (progress.phase === "discover") { setStatus("正在发现图片，已找到 " + progress.current + " 张", 5); return; }
        const percent = progress.total ? 10 + Math.round(progress.current / progress.total * 90) : 100;
        setStatus("正在重新扫描 " + progress.current + "/" + progress.total, percent);
      });
      const prepared = Core.prepareScanImages(scanned);
      state.current.project.images = Core.mergeScannedImageMetadata(prepared.images, previousImages);
      await saveCurrent();
      renderAll();
      setStatus("重新扫描完成：图片 " + state.current.project.images.length + "，重复 " + prepared.duplicates + "，失败 " + prepared.failed, 100);
    } catch (error) { setStatus("重新扫描失败: " + (error.message || error), 0); }
  }

  async function reconnect() {
    if (!state.current) return;
    try {
      if (!(await Repo.verifyPermission(state.current.handle, "readwrite"))) throw new Error("未获得工程文件夹权限");
      setStatus("工程权限已恢复", 100);
    } catch (error) { setStatus("授权失败: " + (error.message || error), 0); }
  }

  function addDefect(event) {
    event.preventDefault();
    const project = currentProject();
    const name = els.defectNameInput.value.trim();
    if (!project || !name) return;
    if (project.defects.some((defect) => defect.name === name)) { setStatus("缺陷名已存在", 0); return; }
    project.defects.push({ id: "defect-" + Date.now().toString(36), name, disabled: false });
    saveCurrent().then(() => { closeDialog("defectDialog"); els.defectForm.reset(); renderAll(); }).catch((error) => setStatus("保存缺陷失败: " + error.message, 0));
  }

  function basenameWithoutExtension(name) { return String(name || "").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "") || "excel"; }

  async function importExcelFile(file) {
    if (!state.current || !file) return;
    setStatus("正在读取 Excel...", 2);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = Core.readZipMediaEntries(bytes);
    if (!entries.length) { setStatus("Excel 内没有可提取的内嵌图片", 0); return; }
    const existingHashes = new Set(state.current.project.images.map((image) => image.hash).filter(Boolean));
    const candidates = [];
    let failed = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      try {
        const extension = Core.normalizePath(entry.name).split(".").pop().toLowerCase();
        const path = "images/imports/" + basenameWithoutExtension(file.name) + "/" + entry.name.split("/").pop();
        if (!Core.isSupportedImagePath(path)) throw new Error("暂不支持该图片格式");
        const data = await Core.extractZipEntry(bytes, entry);
        const blob = new Blob([data], { type: Core.mediaMimeType(path) });
        candidates.push({ name: path, path, hash: await Repo.hashBlob(blob), blob, type: blob.type, extension });
      } catch (error) { failed += 1; }
      setStatus("正在提取 Excel 图片 " + (index + 1) + "/" + entries.length, Math.round((index + 1) / entries.length * 60));
    }
    const chosen = Core.chooseUniqueImages(candidates, existingHashes);
    const usedPaths = new Set(state.current.project.images.map((image) => image.path));
    let written = 0;
    for (const candidate of chosen.accepted) {
      let path = candidate.path;
      let suffix = 2;
      while (usedPaths.has(path)) {
        const dot = candidate.path.lastIndexOf(".");
        path = candidate.path.slice(0, dot) + "-" + suffix + candidate.path.slice(dot);
        suffix += 1;
      }
      await Repo.writeBlob(state.current.handle, path, candidate.blob);
      state.current.project.images.push({
        path,
        hash: candidate.hash,
        size: candidate.blob.size,
        type: candidate.type,
        defects: [],
        poleNumber: "",
        remark: "",
        vehicleCameraImages: [],
        source: { kind: "excel", name: file.name }
      });
      usedPaths.add(path);
      written += 1;
      setStatus("正在写入 Excel 图片 " + written + "/" + chosen.accepted.length, 60 + Math.round(written / Math.max(1, chosen.accepted.length) * 35));
    }
    await saveCurrent();
    renderAll();
    setStatus("Excel 导入完成：新增 " + written + "，工程内重复 " + chosen.duplicateExisting + "，本次重复 " + chosen.duplicateInBatch + "，失败 " + failed, 100);
  }

  function importExcel() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.addEventListener("change", () => { if (input.files[0]) importExcelFile(input.files[0]).catch((error) => setStatus("Excel 导入失败: " + (error.message || error), 0)); });
    input.click();
  }

  async function importOriginalDefects() {
    if (!state.current) return;
    let addedRecord = null;
    let copiedDestinationPath = "";
    try {
      Repo.assertDirectoryApi();
      const source = await window.showDirectoryPicker({ mode: "read", id: "import-original-defects" });
      if (!(await Repo.verifyPermission(state.current.handle, "readwrite"))) throw new Error("未获得工程文件夹权限");
      const managedRoot = await Repo.getDirectoryHandle(state.current.handle, "original-defects", { create: true });
      const existingNames = [];
      for await (const entry of managedRoot.values()) {
        if (entry.kind === "directory") existingNames.push(entry.name);
      }
      const destinationName = Core.uniqueFolderName(source.name, existingNames);
      const destinationPath = "original-defects/" + destinationName;
      copiedDestinationPath = destinationPath;
      setStatus("正在发现原始缺陷文件...", 0);
      const result = await Repo.copyDirectory(source, state.current.handle, destinationPath, (progress) => {
        if (progress.phase === "discover") {
          setStatus("正在发现原始缺陷文件，已找到 " + progress.current + " 个", 5);
          return;
        }
        const percent = progress.total ? 10 + Math.round(progress.current / progress.total * 85) : 95;
        setStatus("正在复制原始缺陷 " + progress.current + "/" + progress.total, percent);
      });
      addedRecord = {
        id: "original-defect-" + Date.now().toString(36),
        name: destinationName,
        path: destinationPath,
        importedAt: new Date().toISOString()
      };
      state.current.project.originalDefectFolders.push(addedRecord);
      await saveCurrent();
      renderOriginalDefects();
      setStatus("原始缺陷上传完成，共复制 " + result.total + " 个文件", 100);
    } catch (error) {
      if (addedRecord) {
        state.current.project.originalDefectFolders = state.current.project.originalDefectFolders.filter((item) => item !== addedRecord);
      }
      if (copiedDestinationPath) {
        try { await Repo.removeDirectory(state.current.handle, copiedDestinationPath); } catch (cleanupError) { /* 复制阶段可能已完成清理。 */ }
      }
      if (error && error.name !== "AbortError") setStatus("上传原始缺陷失败: " + (error.message || error), 0);
    }
  }

  async function openOriginalDefectFolder(folder, target) {
    if (!state.current || !folder || !target) return;
    try {
      await window.showDirectoryPicker({ mode: "read", id: "open-original-defects", startIn: target });
    } catch (error) {
      if (error && error.name !== "AbortError") setStatus("打开原始缺陷失败: " + (error.message || error), 0);
    }
  }

  async function openImageModal(path) {
    const project = currentProject();
    if (!project) return;
    state.modalImages = filteredImages();
    state.modalIndex = state.modalImages.findIndex((image) => image.path === path);
    state.modalViews.clear();
    state.modalSaving = false;
    state.modalChanged = false;
    els.imageModal.hidden = false;
    await renderModalImage();
  }

  function setModalSaveStatus(text, stateName) {
    els.modalSaveStatus.textContent = text;
    els.modalSaveStatus.className = "modal-save-status" + (stateName ? " " + stateName : "");
  }

  function setModalEditingDisabled(disabled) {
    state.modalSaving = disabled;
    els.prevImageBtn.disabled = disabled;
    els.nextImageBtn.disabled = disabled;
    els.addVehicleCameraBtn.disabled = disabled;
    els.modalPoleNumber.disabled = disabled;
    els.modalDefectOptions.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.disabled = disabled || checkbox.dataset.catalogDisabled === "true";
    });
  }

  function modalSourceText(image) {
    if (image.source && image.source.kind === "excel") return "Excel 导入：" + (image.source.name || "未知文件");
    return "工程目录";
  }

  function renderModalInfo(image) {
    const project = currentProject();
    els.modalSequence.textContent = String(Core.imageSequenceNumber(project.images, image));
    els.modalPoleNumber.value = image.poleNumber || "";
    els.modalSource.textContent = modalSourceText(image);
    els.modalSource.title = els.modalSource.textContent;
    setModalSaveStatus("勾选后自动保存", "");
    els.modalDefectOptions.replaceChildren();

    const visibleDefects = project.defects.filter((defect) => !defect.disabled || image.defects.includes(defect.id));
    if (!visibleDefects.length) {
      const empty = document.createElement("span");
      empty.className = "modal-defect-empty";
      empty.textContent = "当前工程还没有配置缺陷";
      els.modalDefectOptions.appendChild(empty);
      return;
    }

    visibleDefects.forEach((defect) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = defect.id;
      checkbox.checked = image.defects.includes(defect.id);
      checkbox.disabled = defect.disabled;
      checkbox.dataset.catalogDisabled = String(defect.disabled);
      checkbox.addEventListener("change", async () => {
        const previous = image.defects.slice();
        image.defects = Core.setDefectSelection(image.defects, defect.id, checkbox.checked);
        setModalSaveStatus("正在保存...", "saving");
        setModalEditingDisabled(true);
        try {
          await saveCurrent();
          state.modalChanged = true;
          setModalSaveStatus("已自动保存", "saved");
          if (els.imageModal.hidden) renderImages();
        } catch (error) {
          image.defects = previous;
          checkbox.checked = previous.includes(defect.id);
          setModalSaveStatus("保存失败：" + (error.message || error), "error");
        } finally {
          setModalEditingDisabled(false);
        }
      });
      label.append(checkbox, document.createTextNode(defect.name + (defect.disabled ? "（已停用）" : "")));
      els.modalDefectOptions.appendChild(label);
    });
  }

  function modalViewKey(item) { return item.path + "\n" + item.hash; }

  function comparisonItems(image) {
    return [
      { ...image, comparisonLabel: "原图", primary: true },
      ...(image.vehicleCameraImages || []).map((item, index) => ({ ...item, comparisonLabel: "车载相机成像 " + (index + 1), comparisonIndex: index }))
    ];
  }

  function viewStateFor(item) {
    const key = modalViewKey(item);
    if (!state.modalViews.has(key)) state.modalViews.set(key, { zoom: 1, panX: 0, panY: 0, drag: null });
    return state.modalViews.get(key);
  }

  function applyTileTransform(img, view) {
    img.style.transform = "translate(" + view.panX + "px, " + view.panY + "px) scale(" + view.zoom + ")";
  }

  function bindComparisonStage(stage, img, item) {
    const view = viewStateFor(item);
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      view.zoom = Math.max(.2, Math.min(8, view.zoom * (event.deltaY < 0 ? 1.12 : .89)));
      applyTileTransform(img, view);
    }, { passive: false });
    stage.addEventListener("pointerdown", (event) => {
      view.drag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      stage.classList.add("dragging");
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      if (!view.drag) return;
      view.panX = view.drag.panX + event.clientX - view.drag.x;
      view.panY = view.drag.panY + event.clientY - view.drag.y;
      applyTileTransform(img, view);
    });
    ["pointerup", "pointercancel"].forEach((type) => stage.addEventListener(type, () => {
      view.drag = null;
      stage.classList.remove("dragging");
    }));
    stage.addEventListener("dblclick", () => {
      view.zoom = 1;
      view.panX = 0;
      view.panY = 0;
      applyTileTransform(img, view);
    });
  }

  async function removeVehicleCameraImage(image, comparisonIndex) {
    const items = image.vehicleCameraImages || [];
    const target = items[comparisonIndex];
    if (!target || !window.confirm("确定移除这张车载相机成像吗？")) return;
    items.splice(comparisonIndex, 1);
    setModalEditingDisabled(true);
    setModalSaveStatus("正在保存...", "saving");
    try {
      await saveCurrent();
      state.modalChanged = true;
      const key = modalViewKey(target);
      const url = state.imageUrls.get(key);
      if (url) URL.revokeObjectURL(url);
      state.imageUrls.delete(key);
      try {
        await Repo.removeFile(state.current.handle, target.path);
        await renderModalImage(false);
        setModalSaveStatus("已移除车载相机成像", "saved");
      } catch (error) {
        await renderModalImage(false);
        setModalSaveStatus("记录已移除，文件删除失败：" + (error.message || error), "error");
      }
    } catch (error) {
      items.splice(comparisonIndex, 0, target);
      setModalSaveStatus("移除失败：" + (error.message || error), "error");
    } finally {
      setModalEditingDisabled(false);
    }
  }

  async function renderComparisonGrid(image) {
    const items = comparisonItems(image);
    const columns = Core.comparisonGridSize(items.length);
    const rows = Math.ceil(items.length / columns);
    const mobileColumns = Math.min(2, items.length);
    els.comparisonGrid.style.setProperty("--grid-columns", String(columns));
    els.comparisonGrid.style.setProperty("--grid-rows", String(rows));
    els.comparisonGrid.style.setProperty("--mobile-grid-columns", String(mobileColumns));
    els.comparisonGrid.style.setProperty("--mobile-grid-rows", String(Math.ceil(items.length / mobileColumns)));
    els.comparisonGrid.replaceChildren();

    items.forEach((item) => {
      const tile = document.createElement("article");
      tile.className = "comparison-tile";
      const header = document.createElement("div");
      header.className = "comparison-tile-header";
      const label = document.createElement("span");
      label.textContent = item.comparisonLabel;
      header.appendChild(label);
      if (!item.primary) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "comparison-remove";
        remove.textContent = "×";
        remove.title = "移除这张车载相机成像";
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("click", () => removeVehicleCameraImage(image, item.comparisonIndex));
        header.appendChild(remove);
      }
      const stage = document.createElement("div");
      stage.className = "comparison-stage";
      const img = document.createElement("img");
      img.alt = item.comparisonLabel + "：" + item.path;
      stage.appendChild(img);
      tile.append(header, stage);
      els.comparisonGrid.appendChild(tile);
      bindComparisonStage(stage, img, item);
      imageUrl(item).then((url) => {
        img.src = url;
        applyTileTransform(img, viewStateFor(item));
      }).catch((error) => {
        tile.classList.add("load-error");
        stage.textContent = "图片读取失败：" + (error.message || error);
      });
    });
  }

  async function renderModalImage(resetStatus) {
    const image = state.modalImages[state.modalIndex];
    if (!image) return;
    renderModalInfo(image);
    await renderComparisonGrid(image);
    if (resetStatus === false) return;
  }

  function sanitizeFileName(name) {
    return String(name || "camera.jpg").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+|\.+$/g, "") || "camera.jpg";
  }

  function uniqueComparisonPath(image, fileName) {
    const project = currentProject();
    const owner = String(image.hash || "image-" + Core.imageSequenceNumber(project.images, image)).slice(0, 16).replace(/[^a-z0-9_-]/gi, "_");
    const safeName = sanitizeFileName(fileName);
    const basePath = "images/vehicle-camera/" + owner + "/" + safeName;
    const usedPaths = new Set(project.images.flatMap((entry) => [entry.path, ...(entry.vehicleCameraImages || []).map((item) => item.path)]));
    if (!usedPaths.has(basePath)) return basePath;
    const dot = basePath.lastIndexOf(".");
    const stem = dot >= 0 ? basePath.slice(0, dot) : basePath;
    const extension = dot >= 0 ? basePath.slice(dot) : "";
    let suffix = 2;
    while (usedPaths.has(stem + "-" + suffix + extension)) suffix += 1;
    return stem + "-" + suffix + extension;
  }

  async function addVehicleCameraFiles(files) {
    const image = state.modalImages[state.modalIndex];
    const selected = Array.from(files || []).filter((file) => Core.isSupportedImagePath(file.name));
    if (!image || !selected.length) {
      if (files && files.length) setModalSaveStatus("未选择受支持的图片格式", "error");
      return;
    }
    image.vehicleCameraImages = image.vehicleCameraImages || [];
    const projectHashes = new Set(currentProject().images.flatMap((entry) => [entry.hash, ...(entry.vehicleCameraImages || []).map((item) => item.hash)]).filter(Boolean));
    const added = [];
    let duplicates = 0;
    setModalEditingDisabled(true);
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        setStatus("正在导入车载相机成像 " + (index + 1) + "/" + selected.length, Math.round(index / selected.length * 90));
        const hash = await Repo.hashBlob(file);
        if (projectHashes.has(hash)) {
          duplicates += 1;
          continue;
        }
        const path = uniqueComparisonPath(image, file.name);
        await Repo.writeBlob(state.current.handle, path, file);
        const record = { path, hash, sourceName: file.name, addedAt: new Date().toISOString() };
        image.vehicleCameraImages.push(record);
        added.push(record);
        projectHashes.add(hash);
      }
      await saveCurrent();
      state.modalChanged = state.modalChanged || added.length > 0;
      state.modalViews.clear();
      await renderModalImage(false);
      setModalSaveStatus("新增 " + added.length + " 张，重复 " + duplicates + " 张", "saved");
      setStatus("车载相机成像导入完成：新增 " + added.length + "，重复 " + duplicates, 100);
    } catch (error) {
      image.vehicleCameraImages = image.vehicleCameraImages.filter((item) => !added.includes(item));
      await Promise.all(added.map((item) => Repo.removeFile(state.current.handle, item.path).catch(() => null)));
      setModalSaveStatus("导入失败：" + (error.message || error), "error");
      setStatus("车载相机成像导入失败：" + (error.message || error), 0);
    } finally {
      setModalEditingDisabled(false);
    }
  }

  function addVehicleCameraImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".jpg,.jpeg,.png,.bmp,.webp,image/jpeg,image/png,image/bmp,image/webp";
    input.addEventListener("change", () => addVehicleCameraFiles(input.files));
    input.click();
  }

  function isTextEditingTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"])'));
  }

  function pasteVehicleCameraImages(event) {
    if (els.imageModal.hidden || state.modalSaving || isTextEditingTarget(event.target)) return;
    const clipboardImages = Core.clipboardImagesFromItems(event.clipboardData && event.clipboardData.items, new Date());
    if (!clipboardImages.length) {
      setModalSaveStatus("剪贴板中没有可用图片", "error");
      return;
    }
    event.preventDefault();
    // 剪贴板文件通常没有稳定文件名，统一重命名后复用已有导入、去重和保存流程。
    const files = clipboardImages.map((item) => new File([item.file], item.name, {
      type: item.file.type,
      lastModified: Date.now()
    }));
    setModalSaveStatus("正在粘贴车载相机成像...", "saving");
    addVehicleCameraFiles(files);
  }

  function closeImageModal() {
    if (els.imageModal.hidden) return;
    els.imageModal.hidden = true;
    state.modalViews.clear();
    if (state.modalChanged) renderImages();
  }
  function moveModal(step) {
    if (!state.modalImages.length || state.modalSaving) return;
    state.modalIndex = (state.modalIndex + step + state.modalImages.length) % state.modalImages.length;
    state.modalViews.clear();
    renderModalImage();
  }

  function bindEvents() {
    els.historySort.value = state.historySort;
    els.historySort.addEventListener("change", () => {
      state.historySort = els.historySort.value;
      localStorage.setItem(HISTORY_SORT_KEY, state.historySort);
      renderHistory();
    });
    els.newProjectBtn.addEventListener("click", () => { state.selectedFolder = null; els.projectForm.reset(); els.chosenFolderText.textContent = "尚未选择"; openDialog("projectDialog"); });
    els.chooseFolderBtn.addEventListener("click", chooseFolder);
    els.projectForm.addEventListener("submit", createProject);
    els.rescanBtn.addEventListener("click", rescan);
    els.reconnectBtn.addEventListener("click", reconnect);
    els.importExcelBtn.addEventListener("click", importExcel);
    els.importOriginalDefectsBtn.addEventListener("click", importOriginalDefects);
    els.originalDefectsMenu.addEventListener("toggle", () => {
      if (!currentProject()) els.originalDefectsMenu.open = false;
    });
    els.configureDefectsBtn.addEventListener("click", () => { els.defectForm.reset(); els.defectDialog.hidden = false; });
    els.addDefectBtn.addEventListener("click", () => { els.defectForm.reset(); openDialog("defectDialog"); });
    els.defectForm.addEventListener("submit", addDefect);
    els.imageSearch.addEventListener("input", renderImages);
    els.imageSort.addEventListener("change", renderImages);
    els.defectFilterMenu.addEventListener("toggle", () => {
      if (!currentProject()) els.defectFilterMenu.open = false;
    });
    els.closeImageModal.addEventListener("click", closeImageModal);
    els.prevImageBtn.addEventListener("click", () => moveModal(-1));
    els.nextImageBtn.addEventListener("click", () => moveModal(1));
    els.addVehicleCameraBtn.addEventListener("click", addVehicleCameraImage);
    els.modalPoleNumber.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); els.modalPoleNumber.blur(); }
    });
    els.modalPoleNumber.addEventListener("change", async () => {
      const image = state.modalImages[state.modalIndex];
      if (!image || state.modalSaving) return;
      const previous = image.poleNumber || "";
      const next = els.modalPoleNumber.value.trim();
      if (next === previous) return;
      image.poleNumber = next;
      setModalSaveStatus("正在保存...", "saving");
      setModalEditingDisabled(true);
      try {
        await saveCurrent();
        state.modalChanged = true;
        els.modalPoleNumber.value = next;
        setModalSaveStatus("已自动保存", "saved");
      } catch (error) {
        image.poleNumber = previous;
        els.modalPoleNumber.value = previous;
        setModalSaveStatus("保存失败：" + (error.message || error), "error");
      } finally {
        setModalEditingDisabled(false);
      }
    });
    document.addEventListener("paste", pasteVehicleCameraImages);
    document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeImageModal(); closeDialog("projectDialog"); closeDialog("defectDialog"); } });
  }

  async function init() {
    bindEvents();
    try { state.history = await Store.list(); } catch (error) { setStatus("历史工程暂不可用: " + error.message, 0); state.history = []; }
    renderAll();
  }

  init();
})();
