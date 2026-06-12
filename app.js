(function () {
  "use strict";

  const els = {
    prefixInput: document.getElementById("prefixInput"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    jsonInput: document.getElementById("jsonInput"),
    loadBtn: document.getElementById("loadBtn"),
    formatBtn: document.getElementById("formatBtn"),
    copyJsonBtn: document.getElementById("copyJsonBtn"),
    downloadJsonBtn: document.getElementById("downloadJsonBtn"),
    progressBar: document.getElementById("progressBar"),
    statusText: document.getElementById("statusText"),
    imageCount: document.getElementById("imageCount"),
    imageFilter: document.getElementById("imageFilter"),
    labelFilter: document.getElementById("labelFilter"),
    widthMinFilter: document.getElementById("widthMinFilter"),
    widthMaxFilter: document.getElementById("widthMaxFilter"),
    heightMinFilter: document.getElementById("heightMinFilter"),
    heightMaxFilter: document.getElementById("heightMaxFilter"),
    knownSizeText: document.getElementById("knownSizeText"),
    applyFiltersBtn: document.getElementById("applyFiltersBtn"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn"),
    imageList: document.getElementById("imageList"),
    currentImageText: document.getElementById("currentImageText"),
    imageIndexText: document.getElementById("imageIndexText"),
    canvasShell: document.getElementById("canvasShell"),
    stage: document.getElementById("stage"),
    mainImage: document.getElementById("mainImage"),
    overlayCanvas: document.getElementById("overlayCanvas"),
    emptyState: document.getElementById("emptyState"),
    prevImageBtn: document.getElementById("prevImageBtn"),
    nextImageBtn: document.getElementById("nextImageBtn"),
    resetViewBtn: document.getElementById("resetViewBtn"),
    boxVisibilityBtn: document.getElementById("boxVisibilityBtn"),
    fillToggleBtn: document.getElementById("fillToggleBtn"),
    strokeWidthRange: document.getElementById("strokeWidthRange"),
    strokeWidthText: document.getElementById("strokeWidthText"),
    labelSizeRange: document.getElementById("labelSizeRange"),
    labelSizeText: document.getElementById("labelSizeText"),
    brightnessRange: document.getElementById("brightnessRange"),
    brightnessText: document.getElementById("brightnessText"),
    imageInfoIndex: document.getElementById("imageInfoIndex"),
    imageInfoSize: document.getElementById("imageInfoSize"),
    imageInfoObjects: document.getElementById("imageInfoObjects"),
    imageInfoZoom: document.getElementById("imageInfoZoom"),
    imageInfoCreated: document.getElementById("imageInfoCreated"),
    zoomOutBtn: document.getElementById("zoomOutBtn"),
    zoomInBtn: document.getElementById("zoomInBtn"),
    zoomText: document.getElementById("zoomText"),
    objectCount: document.getElementById("objectCount"),
    addObjectBtn: document.getElementById("addObjectBtn"),
    deleteObjectBtn: document.getElementById("deleteObjectBtn"),
    objectList: document.getElementById("objectList"),
    selectedBadge: document.getElementById("selectedBadge"),
    bboxSizeText: document.getElementById("bboxSizeText"),
    labelsEditor: document.getElementById("labelsEditor"),
    bboxGrid: document.getElementById("bboxGrid"),
    applyObjectBtn: document.getElementById("applyObjectBtn")
  };

  const colors = ["#4ade80", "#38bdf8", "#facc15", "#fb7185", "#a78bfa", "#2dd4bf"];
  const pointNames = ["x1", "y1", "x2", "y2", "x3", "y3", "x4", "y4"];
  const overlayContext = els.overlayCanvas.getContext("2d");

  const state = {
    data: null,
    imageNames: [],
    filteredImageNames: [],
    imageMeta: new Map(),
    knownImageSizes: new Map(),
    currentImage: "",
    currentImageIndex: -1,
    selectedObjectIndex: -1,
    zoom: 1,
    panX: 0,
    panY: 0,
    drag: null,
    pan: null,
    showBoxes: true,
    showBoxFill: true,
    boxStrokeWidth: 3,
    labelFontSize: 13,
    imageBrightness: 100,
    viewFrame: 0,
    overlayFrame: 0,
    imageListScrollFrame: 0,
    suppressNextClick: false,
    workerJobId: 0,
    sizeScanJobId: 0,
    sizeScanActive: false,
    sizeScanCompleted: 0,
    sizeScanTotal: 0
  };

  const preloadImages = new Map();
  let imageWorker = null;

  function validateData(data) {
    if (!data || Array.isArray(data) || typeof data !== "object") {
      throw new Error("JSON 根节点必须是图片名到标注内容的对象");
    }

    const imageNames = Object.keys(data);
    let objectTotal = 0;
    const meta = {};

    imageNames.forEach(function eachImage(name) {
      const entry = data[name];
      const objects = entry && entry.det && entry.det.objects;
      if (!Array.isArray(objects)) {
        throw new Error(name + " 缺少 det.objects 数组");
      }
      objects.forEach(function eachObject(obj, index) {
        if (!Array.isArray(obj.bbox) || obj.bbox.length !== 8) {
          throw new Error(name + " 的 object " + (index + 1) + " bbox 必须是 8 个数字");
        }
        obj.bbox.forEach(function eachCoord(value, coordIndex) {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(name + " 的 object " + (index + 1) + " bbox[" + coordIndex + "] 不是有效数字");
          }
        });
        if (!Array.isArray(obj.labels)) {
          obj.labels = [];
        }
        if (!obj.attrs || typeof obj.attrs !== "object" || Array.isArray(obj.attrs)) {
          obj.attrs = {};
        }
      });
      objectTotal += objects.length;
      meta[name] = buildImageMetaFromObjects(name, objects);
    });

    return {
      imageNames,
      objectTotal,
      meta
    };
  }

  function buildImageMetaFromObjects(name, objects) {
    const labels = collectImageLabels(objects);
    return {
      nameLower: name.toLowerCase(),
      labelText: Array.from(labels, function lower(label) {
        return label.toLowerCase();
      }).join("\n"),
      objectCount: objects.length
    };
  }

  function createVirtualList(container, itemHeight, buttonDatasetKey, getLabel) {
    const spacer = document.createElement("div");
    spacer.className = "virtual-spacer";
    const viewport = document.createElement("div");
    viewport.className = "virtual-viewport";
    spacer.appendChild(viewport);
    container.replaceChildren(spacer);

    const view = {
      container,
      spacer,
      viewport,
      itemHeight,
      buttonDatasetKey,
      getLabel,
      items: [],
      selectedIndex: -1,
      renderToken: 0
    };

    function render() {
      const token = ++view.renderToken;
      const height = view.items.length * view.itemHeight;
      view.spacer.style.height = height + "px";

      const scrollTop = container.scrollTop;
      const viewportHeight = container.clientHeight || 0;
      const start = Math.max(0, Math.floor(scrollTop / view.itemHeight) - 8);
      const visibleCount = Math.ceil(viewportHeight / view.itemHeight) + 16;
      const end = Math.min(view.items.length, start + visibleCount);

      const fragment = document.createDocumentFragment();
      for (let i = start; i < end; i += 1) {
        const row = document.createElement("div");
        row.className = "virtual-row";
        row.style.top = i * view.itemHeight + "px";
        const button = document.createElement("button");
        button.type = "button";
        button.dataset[view.buttonDatasetKey] = String(i);
        button.textContent = view.getLabel(view.items[i], i);
        button.title = button.textContent;
        if (i === view.selectedIndex) {
          button.classList.add("active");
        }
        row.appendChild(button);
        fragment.appendChild(row);
      }

      if (token === view.renderToken) {
        view.viewport.replaceChildren(fragment);
      }
    }

    container.addEventListener("scroll", render);

    return {
      setItems(items, selectedIndex) {
        view.items = items || [];
        view.selectedIndex = typeof selectedIndex === "number" ? selectedIndex : -1;
        render();
      },
      rerender(selectedIndex) {
        view.selectedIndex = typeof selectedIndex === "number" ? selectedIndex : view.selectedIndex;
        render();
      },
      scrollIntoView(index) {
        if (index < 0 || index >= view.items.length) return;
        const top = index * view.itemHeight;
        const bottom = top + view.itemHeight;
        if (top < container.scrollTop) {
          container.scrollTop = top;
        } else if (bottom > container.scrollTop + container.clientHeight) {
          container.scrollTop = bottom - container.clientHeight;
        }
      },
      getItems() {
        return view.items;
      }
    };
  }

  const imageListView = createVirtualList(els.imageList, 38, "imageIndex", function getImageLabel(item) {
    return item;
  });

  const objectListView = createVirtualList(els.objectList, 38, "objectIndex", function getObjectLabel(item, index) {
    return (index + 1) + ". " + item;
  });

  function setProgress(percent) {
    els.progressBar.style.width = Math.max(0, Math.min(100, percent)) + "%";
  }

  function setStatus(text, percent) {
    els.statusText.textContent = text;
    if (typeof percent === "number") {
      setProgress(percent);
    }
  }

  function normalizePrefix(prefix) {
    const value = prefix.trim();
    if (!value) return "";
    const hasProtocol = /^[a-z]+:\/\//i.test(value) || value.startsWith("file://");
    let normalized = value.replace(/\\/g, "/");
    if (/^[a-z]:\//i.test(normalized)) {
      normalized = "file:///" + normalized;
    }
    if (!normalized.endsWith("/")) {
      normalized += "/";
    }
    if (!hasProtocol && !/^file:\/\//i.test(normalized) && /^[a-z]:\//i.test(value.replace(/\\/g, "/"))) {
      return normalized;
    }
    return normalized;
  }

  function normalizeImagePath(name) {
    return String(name || "").trim().replace(/\\/g, "/");
  }

  function isAbsoluteImagePath(name) {
    const normalized = normalizeImagePath(name);
    return /^[a-z]+:\/\//i.test(normalized)
      || /^file:\/\//i.test(normalized)
      || /^[a-z]:\//i.test(normalized)
      || normalized.startsWith("//");
  }

  function imagePathToUrl(name) {
    const normalized = normalizeImagePath(name);
    if (/^[a-z]+:\/\//i.test(normalized) || /^file:\/\//i.test(normalized)) {
      return encodeURI(normalized).replace(/#/g, "%23");
    }
    if (/^[a-z]:\//i.test(normalized)) {
      return encodeURI("file:///" + normalized).replace(/#/g, "%23");
    }
    if (normalized.startsWith("//")) {
      return encodeURI("file:" + normalized).replace(/#/g, "%23");
    }
    return encodeURI(normalized).replace(/#/g, "%23");
  }

  function buildImageUrl(prefix, name) {
    if (isAbsoluteImagePath(name)) {
      return imagePathToUrl(name);
    }
    return normalizePrefix(prefix) + imagePathToUrl(name);
  }

  function imageUrl(name) {
    return buildImageUrl(els.prefixInput.value, name);
  }

  function imageUrlForPrefix(prefix, name) {
    return buildImageUrl(prefix, name);
  }

  function getObjects(name) {
    if (!state.data || !state.data[name] || !state.data[name].det) return [];
    return state.data[name].det.objects || [];
  }

  function currentObjects() {
    return getObjects(state.currentImage);
  }

  function currentObject() {
    return currentObjects()[state.selectedObjectIndex] || null;
  }

  function parseFilterNumber(input) {
    if (!input) return null;
    const text = String(input.value || "").trim();
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function hasSizeFilters() {
    return (
      parseFilterNumber(els.widthMinFilter) !== null
      || parseFilterNumber(els.widthMaxFilter) !== null
      || parseFilterNumber(els.heightMinFilter) !== null
      || parseFilterNumber(els.heightMaxFilter) !== null
    );
  }

  function collectImageLabels(objects) {
    const labels = new Set();
    objects.forEach(function eachObject(obj) {
      const items = Array.isArray(obj.labels) ? obj.labels : [];
      items.forEach(function eachLabel(label) {
        const text = String(label || "").trim();
        if (text) labels.add(text);
      });
    });
    return labels;
  }

  function buildImageMeta(name) {
    const objects = getObjects(name);
    return buildImageMetaFromObjects(name, objects);
  }

  function refreshImageMeta(name) {
    if (!name) return;
    state.imageMeta.set(name, buildImageMeta(name));
  }

  function setKnownImageSize(name, width, height) {
    if (!name || !width || !height) return false;
    const prev = state.knownImageSizes.get(name);
    if (prev && prev.width === width && prev.height === height) return false;
    state.knownImageSizes.set(name, { width, height });
    return true;
  }

  function formatSliderValue(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function formatBboxSize(bbox) {
    const xs = [bbox[0], bbox[2], bbox[4], bbox[6]];
    const ys = [bbox[1], bbox[3], bbox[5], bbox[7]];
    const width = Math.round(Math.max.apply(null, xs) - Math.min.apply(null, xs));
    const height = Math.round(Math.max.apply(null, ys) - Math.min.apply(null, ys));
    return width + " x " + height;
  }

  function bboxToPoints(bbox) {
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
      [bbox[4], bbox[5]],
      [bbox[6], bbox[7]]
    ];
  }

  function clampZoom(value) {
    return Math.max(0.1, Math.min(4, value));
  }

  function clampBrightness(value) {
    return Math.max(60, Math.min(220, value));
  }

  function getVisibleImageNames() {
    const nameFilter = els.imageFilter.value.trim().toLowerCase();
    const labelFilter = els.labelFilter.value.trim().toLowerCase();
    const widthMin = parseFilterNumber(els.widthMinFilter);
    const widthMax = parseFilterNumber(els.widthMaxFilter);
    const heightMin = parseFilterNumber(els.heightMinFilter);
    const heightMax = parseFilterNumber(els.heightMaxFilter);

    return state.imageNames.filter(function filterImage(name) {
      const meta = state.imageMeta.get(name);
      if (nameFilter && (!meta || !meta.nameLower.includes(nameFilter))) return false;
      if (labelFilter && (!meta || !meta.labelText.includes(labelFilter))) return false;
      if (widthMin !== null || widthMax !== null || heightMin !== null || heightMax !== null) {
        const size = state.knownImageSizes.get(name);
        if (!size) return false;
        if (widthMin !== null && size.width < widthMin) return false;
        if (widthMax !== null && size.width > widthMax) return false;
        if (heightMin !== null && size.height < heightMin) return false;
        if (heightMax !== null && size.height > heightMax) return false;
      }
      return true;
    });
  }

  function updateKnownSizeText() {
    els.knownSizeText.textContent = "瀹介珮绛涢€夊熀浜庡凡鐭ュ浘鍍忓昂瀵?" + state.knownImageSizes.size + "/" + state.imageNames.length;
  }

  function cancelImageSizeScan() {
    state.sizeScanJobId += 1;
    state.sizeScanActive = false;
    state.sizeScanCompleted = 0;
    state.sizeScanTotal = 0;
  }

  function updateImageSizeScanStatus() {
    if (!state.sizeScanActive) return;
    const total = Math.max(1, state.sizeScanTotal);
    const percent = 70 + Math.round((state.sizeScanCompleted / total) * 29);
    setStatus("姝ｅ湪璇诲彇鍥剧墖灏哄... " + state.sizeScanCompleted + "/" + state.sizeScanTotal, percent);
  }

  function loadImageSize(url) {
    return new Promise(function resolveImageSize(resolve) {
      const image = new Image();
      let settled = false;

      function finish(width, height, failed) {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        resolve({
          width: width || 0,
          height: height || 0,
          failed: !!failed
        });
      }

      image.onload = function onload() {
        finish(image.naturalWidth || 0, image.naturalHeight || 0, false);
      };
      image.onerror = function onerror() {
        finish(0, 0, true);
      };
      image.src = url;
    });
  }

  async function startImageSizeScan() {
    const names = state.imageNames.slice();
    const jobId = state.sizeScanJobId + 1;
    const prefix = normalizePrefix(els.prefixInput.value);
    const concurrency = Math.min(6, names.length);
    let nextIndex = 0;

    state.sizeScanJobId = jobId;
    state.sizeScanActive = names.length > 0;
    state.sizeScanCompleted = 0;
    state.sizeScanTotal = names.length;
    updateKnownSizeText();

    if (!names.length) {
      setStatus("娌℃湁鍙鍙栧昂瀵哥殑鍥剧墖", 100);
      return;
    }

    updateImageSizeScanStatus();

    async function worker() {
      while (true) {
        const currentIndex = nextIndex;
        if (jobId !== state.sizeScanJobId || currentIndex >= names.length) return;
        nextIndex += 1;

        const name = names[currentIndex];
        const result = await loadImageSize(imageUrlForPrefix(prefix, name));
        if (jobId !== state.sizeScanJobId) return;

        if (!result.failed) {
          setKnownImageSize(name, result.width, result.height);
        }

        state.sizeScanCompleted += 1;
        updateKnownSizeText();
        if (hasSizeFilters() && (state.sizeScanCompleted % 20 === 0 || state.sizeScanCompleted === state.sizeScanTotal)) {
          renderImageControls();
        }
        updateImageSizeScanStatus();
      }
    }

    await Promise.all(Array.from({ length: concurrency }, function createWorker() {
      return worker();
    }));

    if (jobId !== state.sizeScanJobId) return;

    state.sizeScanActive = false;
    renderImageControls();
    setStatus("宸插畬鎴愬浘鐗囧昂瀵歌鍙? " + state.knownImageSizes.size + "/" + state.imageNames.length, 100);
  }

  function clearFilters() {
    els.imageFilter.value = "";
    els.labelFilter.value = "";
    els.widthMinFilter.value = "";
    els.widthMaxFilter.value = "";
    els.heightMinFilter.value = "";
    els.heightMaxFilter.value = "";
    renderImageControls();
  }

  function applyFilters() {
    renderImageControls();
    setStatus("宸插埛鏂扮瓫閫夌粨鏋? " + state.filteredImageNames.length + "/" + state.imageNames.length, 100);
  }

  function exportText() {
    if (!state.data) return "";
    return JSON.stringify(state.data, null, 2);
  }

  function readJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onprogress = function onprogress(event) {
      if (event.lengthComputable) {
        setStatus("璇诲彇 JSON 鏂囦欢...", Math.round((event.loaded / event.total) * 45));
      }
    };
    reader.onload = function onload() {
      els.jsonInput.value = String(reader.result || "");
      setStatus("JSON 鏂囦欢璇诲彇瀹屾垚", 50);
      loadJson();
    };
    reader.onerror = function onerror() {
      setStatus("JSON 鏂囦欢璇诲彇澶辫触", 0);
    };
    reader.readAsText(file, "utf-8");
  }

  function ensureWorker() {
    if (imageWorker) return imageWorker;
    try {
      imageWorker = new Worker("./json-worker.js");
    } catch (error) {
      imageWorker = null;
      return null;
    }
    imageWorker.addEventListener("message", function onmessage(event) {
      const message = event.data || {};
      if (message.type === "progress") {
        const phaseText = message.phase === "parse" ? "瑙ｆ瀽 JSON..." : "鏍￠獙鏁版嵁...";
        setStatus(phaseText, message.percent);
        return;
      }
      if (message.type === "error") {
        state.data = null;
        state.imageNames = [];
        state.filteredImageNames = [];
        state.imageMeta.clear();
        state.knownImageSizes.clear();
        preloadImages.clear();
        state.currentImage = "";
        state.currentImageIndex = -1;
        state.selectedObjectIndex = -1;
        setStatus("鍔犺浇澶辫触: " + message.message, 0);
        renderFull();
        return;
      }
      if (message.type === "success") {
        applyLoadedPayload(message.payload);
      }
    });
    imageWorker.addEventListener("error", function onerror() {
      imageWorker = null;
      setStatus("Worker 涓嶅彲鐢紝鍒囨崲涓轰富绾跨▼瑙ｆ瀽...", 8);
      window.setTimeout(function fallback() {
        loadJsonOnMainThread(els.jsonInput.value);
      }, 0);
    });
    return imageWorker;
  }

  function applyLoadedPayload(payload) {
    cancelImageSizeScan();
    state.data = payload.data;
    state.imageNames = payload.imageNames;
    state.filteredImageNames = payload.imageNames.slice();
    state.imageMeta = new Map(Object.entries(payload.meta));
    state.knownImageSizes.clear();
    preloadImages.clear();
    state.currentImage = "";
    state.currentImageIndex = -1;
    state.selectedObjectIndex = -1;
    const firstImage = state.imageNames[0] || "";
    setStatus("宸插姞杞?" + state.imageNames.length + " 寮犲浘鐗? " + payload.objectTotal + " 涓?objects", 70);
    renderImageControls();
    selectImage(firstImage);
    state.sizeScanActive = state.imageNames.length > 0;
    state.sizeScanCompleted = 0;
    state.sizeScanTotal = state.imageNames.length;
    window.setTimeout(startImageSizeScan, 0);
    if (state.imageNames.length) {
      setStatus("姝ｅ湪璇诲彇鍥剧墖灏哄... 0/" + state.imageNames.length, 70);
      return;
    }
    if (state.imageNames.length) {
      setStatus("姝ｅ湪璇诲彇鍥剧墖灏哄... 0/" + state.imageNames.length, 70);
    }
    setStatus("宸插姞杞?" + state.imageNames.length + " 寮犲浘鐗? " + payload.objectTotal + " 涓?objects", 100);
  }

  function loadJsonOnMainThread(text) {
    try {
      setStatus("瑙ｆ瀽 JSON...", 10);
      cancelImageSizeScan();
      const parsed = JSON.parse(text);
      setStatus("鏍￠獙鏁版嵁...", 40);
      const result = validateData(parsed);
      applyLoadedPayload({
        data: parsed,
        imageNames: result.imageNames,
        objectTotal: result.objectTotal,
        meta: result.meta
      });
    } catch (error) {
      cancelImageSizeScan();
      state.data = null;
      state.imageNames = [];
      state.filteredImageNames = [];
      state.imageMeta.clear();
      state.knownImageSizes.clear();
      preloadImages.clear();
      state.currentImage = "";
      state.currentImageIndex = -1;
      state.selectedObjectIndex = -1;
      setStatus("鍔犺浇澶辫触: " + error.message, 0);
      renderFull();
    }
  }

  function loadJson() {
    const text = els.jsonInput.value;
    if (!text.trim()) {
      setStatus("璇疯緭鍏ユ垨瀵煎叆 JSON", 0);
      return;
    }
    cancelImageSizeScan();
    state.workerJobId += 1;
    const worker = ensureWorker();
    if (!worker) {
      loadJsonOnMainThread(text);
      return;
    }
    worker.postMessage({
      type: "parse-json",
      jobId: state.workerJobId,
      text: text
    });
    setStatus("鍑嗗瑙ｆ瀽 JSON...", 2);
  }

  function renderImageControls() {
    const visibleNames = getVisibleImageNames();
    state.filteredImageNames = visibleNames;
    els.imageCount.textContent = visibleNames.length + "/" + state.imageNames.length;
    updateKnownSizeText();
    imageListView.setItems(visibleNames, visibleNames.indexOf(state.currentImage));
    updateImageSelection();
  }

  function renderObjects() {
    const objects = currentObjects();
    const labels = objects.map(function formatObjectLabel(obj, index) {
      const text = Array.isArray(obj.labels) && obj.labels.length ? obj.labels.join(" / ") : "未命名";
      return text || "object " + (index + 1);
    });
    els.objectCount.textContent = String(objects.length);
    els.imageInfoObjects.textContent = String(objects.length);
    objectListView.setItems(labels, state.selectedObjectIndex);
  }

  function renderEditor() {
    const obj = currentObject();
    els.selectedBadge.textContent = obj ? "#" + (state.selectedObjectIndex + 1) : "未选中";
    els.bboxSizeText.textContent = obj ? formatBboxSize(obj.bbox) : "未选中";
    els.labelsEditor.disabled = !obj;
    els.applyObjectBtn.disabled = !obj;
    els.deleteObjectBtn.disabled = !obj;
    els.labelsEditor.value = obj ? (obj.labels || []).join("\n") : "";

    const fragment = document.createDocumentFragment();
    pointNames.forEach(function eachPoint(name, index) {
      const label = document.createElement("label");
      const span = document.createElement("span");
      const input = document.createElement("input");
      span.textContent = name;
      input.type = "number";
      input.step = "1";
      input.value = obj ? String(obj.bbox[index]) : "";
      input.disabled = !obj;
      input.dataset.coordIndex = String(index);
      input.addEventListener("change", applyEditor);
      label.appendChild(span);
      label.appendChild(input);
      fragment.appendChild(label);
    });
    els.bboxGrid.replaceChildren(fragment);
  }

  function renderImageInfo() {
    const hasImage = state.currentImageIndex >= 0 && !!state.currentImage;
    const width = els.mainImage.naturalWidth || 0;
    const height = els.mainImage.naturalHeight || 0;
    els.imageInfoIndex.textContent = hasImage ? state.currentImageIndex + 1 + "/" + state.imageNames.length : "-";
    els.imageInfoSize.textContent = width && height ? width + " x " + height : "-";
    els.imageInfoObjects.textContent = String(currentObjects().length);
    els.imageInfoZoom.textContent = Math.round(state.zoom * 100) + "%";
    els.imageInfoCreated.textContent = hasImage ? "鏃犳硶璇诲彇" : "-";
  }

  function renderImageNavButtons() {
    const names = state.filteredImageNames.length ? state.filteredImageNames : state.imageNames;
    const index = names.indexOf(state.currentImage);
    const hasImage = index >= 0;
    els.prevImageBtn.hidden = !hasImage;
    els.nextImageBtn.hidden = !hasImage;
    els.prevImageBtn.disabled = !hasImage || index <= 0;
    els.nextImageBtn.disabled = !hasImage || index >= names.length - 1;
  }

  function renderSliderValues() {
    els.strokeWidthRange.value = String(state.boxStrokeWidth);
    els.strokeWidthText.textContent = formatSliderValue(state.boxStrokeWidth);
    els.labelSizeRange.value = String(state.labelFontSize);
    els.labelSizeText.textContent = String(state.labelFontSize);
    els.brightnessRange.value = String(state.imageBrightness);
    els.brightnessText.textContent = Math.round(state.imageBrightness) + "%";
  }

  function renderBoxVisibilityToggle() {
    els.boxVisibilityBtn.classList.toggle("active", state.showBoxes);
    els.boxVisibilityBtn.setAttribute("aria-pressed", String(state.showBoxes));
    els.boxVisibilityBtn.title = state.showBoxes ? "闅愯棌鎵€鏈夋" : "鏄剧ず鎵€鏈夋";
  }

  function renderFillToggle() {
    els.fillToggleBtn.classList.toggle("active", state.showBoxFill);
    els.fillToggleBtn.setAttribute("aria-pressed", String(state.showBoxFill));
  }

  function updateImageSelection() {
    els.currentImageText.value = state.currentImage;
    els.currentImageText.title = state.currentImage || "可选中复制当前图片名";
    els.imageIndexText.textContent = state.currentImageIndex >= 0 ? state.currentImageIndex + 1 + "/" + state.imageNames.length : "-";
    imageListView.rerender(state.filteredImageNames.indexOf(state.currentImage));
    renderImageNavButtons();
    renderImageInfo();
  }

  function clearOverlayCanvas() {
    overlayContext.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  }

  function syncCanvasSize() {
    const width = els.mainImage.naturalWidth || els.mainImage.width || 0;
    const height = els.mainImage.naturalHeight || els.mainImage.height || 0;
    const dpr = window.devicePixelRatio || 1;
    els.overlayCanvas.width = Math.max(1, Math.round(width * dpr));
    els.overlayCanvas.height = Math.max(1, Math.round(height * dpr));
    els.overlayCanvas.style.width = (width || 1) + "px";
    els.overlayCanvas.style.height = (height || 1) + "px";
    overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    els.stage.style.width = width ? width + "px" : "100%";
    els.stage.style.height = height ? height + "px" : "100%";
  }

  function getRenderedLabelFontSize() {
    return Math.max(8, Math.min(28, state.labelFontSize));
  }

  function getRenderedLabelStrokeWidth() {
    return Math.max(1.5, Math.min(5, getRenderedLabelFontSize() * 0.22));
  }

  function getOverlayScale() {
    return Math.max(0.1, state.zoom || 1);
  }

  function pickObjectAtPoint(imageX, imageY) {
    const objects = currentObjects();
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      if (pointInPolygon(imageX, imageY, bboxToPoints(objects[i].bbox))) {
        return i;
      }
    }
    return -1;
  }

  function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const xi = points[i][0];
      const yi = points[i][1];
      const xj = points[j][0];
      const yj = points[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-6) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function findHandleHit(imageX, imageY) {
    const obj = currentObject();
    if (!obj) return -1;
    const threshold = 8 / getOverlayScale();
    const points = bboxToPoints(obj.bbox);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const dx = point[0] - imageX;
      const dy = point[1] - imageY;
      if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
        return i;
      }
    }
    return -1;
  }

  function drawPolygon(points, color, fillStyle, active) {
    overlayContext.beginPath();
    overlayContext.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      overlayContext.lineTo(points[i][0], points[i][1]);
    }
    overlayContext.closePath();
    overlayContext.lineWidth = state.boxStrokeWidth / getOverlayScale();
    overlayContext.strokeStyle = active ? "#facc15" : color;
    if (state.showBoxFill) {
      overlayContext.fillStyle = active ? "rgba(15,118,110,0.25)" : fillStyle;
      overlayContext.fill();
    }
    overlayContext.stroke();
  }

  function drawLabel(points, label) {
    if (!label) return;
    const minX = Math.min(points[0][0], points[1][0], points[2][0], points[3][0]);
    const minY = Math.min(points[0][1], points[1][1], points[2][1], points[3][1]);
    overlayContext.save();
    overlayContext.font = "700 " + getRenderedLabelFontSize() / getOverlayScale() + "px Microsoft YaHei";
    overlayContext.textBaseline = "alphabetic";
    overlayContext.lineJoin = "round";
    overlayContext.lineWidth = getRenderedLabelStrokeWidth() / getOverlayScale();
    overlayContext.strokeStyle = "rgba(0,0,0,0.8)";
    overlayContext.fillStyle = "#ffffff";
    const x = minX;
    const y = Math.max(16 / getOverlayScale(), minY - 8 / getOverlayScale());
    overlayContext.strokeText(label, x, y);
    overlayContext.fillText(label, x, y);
    overlayContext.restore();
  }

  function drawHandles() {
    const obj = currentObject();
    if (!obj) return;
    const radius = 6 / getOverlayScale();
    overlayContext.save();
    overlayContext.lineWidth = 2 / getOverlayScale();
    overlayContext.strokeStyle = "#ef4444";
    overlayContext.fillStyle = "#ffffff";
    bboxToPoints(obj.bbox).forEach(function eachPoint(point) {
      overlayContext.beginPath();
      overlayContext.arc(point[0], point[1], radius, 0, Math.PI * 2);
      overlayContext.fill();
      overlayContext.stroke();
    });
    overlayContext.restore();
  }

  function renderOverlayNow() {
    clearOverlayCanvas();
    if (!state.showBoxes || !state.currentImage || !els.mainImage.naturalWidth) return;
    const objects = currentObjects();
    objects.forEach(function eachObject(obj, index) {
      const points = bboxToPoints(obj.bbox);
      const color = colors[index % colors.length];
      drawPolygon(points, color, "rgba(37,99,235,0.14)", index === state.selectedObjectIndex);
      drawLabel(points, obj.labels && obj.labels.length ? obj.labels[0] : "object " + (index + 1));
    });
    drawHandles();
  }

  function renderOverlay() {
    if (state.overlayFrame) return;
    state.overlayFrame = window.requestAnimationFrame(function onframe() {
      state.overlayFrame = 0;
      renderOverlayNow();
    });
  }

  function cancelDeferredRender() {
    if (state.overlayFrame) {
      window.cancelAnimationFrame(state.overlayFrame);
      state.overlayFrame = 0;
    }
  }

  function renderImageChrome() {
    renderObjects();
    renderEditor();
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    renderImageInfo();
    applyZoom();
  }

  function renderSwitchChrome() {
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    renderImageInfo();
    applyZoom();
  }

  function renderAll() {
    renderObjects();
    renderEditor();
    renderOverlay();
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    renderImageInfo();
    applyZoom();
  }

  function renderFull() {
    renderImageControls();
    renderAll();
  }

  function scrollCurrentImageIntoView() {
    const index = state.filteredImageNames.indexOf(state.currentImage);
    if (index < 0) return;
    if (state.imageListScrollFrame) {
      window.cancelAnimationFrame(state.imageListScrollFrame);
    }
    state.imageListScrollFrame = window.requestAnimationFrame(function onframe() {
      state.imageListScrollFrame = 0;
      imageListView.scrollIntoView(index);
    });
  }

  function scrollSelectedObjectIntoView() {
    objectListView.scrollIntoView(state.selectedObjectIndex);
  }

  function preloadAdjacentImages() {
    const index = state.currentImageIndex;
    if (index < 0) return;
    [index - 3, index - 2, index - 1, index + 1, index + 2, index + 3].forEach(function eachIndex(nextIndex) {
      const name = state.imageNames[nextIndex];
      if (!name || preloadImages.has(name)) return;
      const image = new Image();
      preloadImages.set(name, image);
      image.src = imageUrl(name);
    });
    if (preloadImages.size > 12) {
      const keep = new Set();
      for (let offset = -4; offset <= 4; offset += 1) {
        const name = state.imageNames[index + offset];
        if (name) keep.add(name);
      }
      Array.from(preloadImages.keys()).forEach(function cleanup(name) {
        if (!keep.has(name)) preloadImages.delete(name);
      });
    }
  }

  function selectImage(name, options) {
    const nextName = name || "";
    if (nextName && nextName === state.currentImage) {
      updateImageSelection();
      if (options && options.scrollList) {
        scrollCurrentImageIntoView();
      }
      return;
    }

    cancelDeferredRender();
    state.currentImage = nextName;
    state.currentImageIndex = nextName ? state.imageNames.indexOf(nextName) : -1;
    state.selectedObjectIndex = -1;
    updateImageSelection();
    if (options && options.scrollList) {
      scrollCurrentImageIntoView();
    }

    if (state.currentImage) {
      clearOverlayCanvas();
      els.mainImage.src = imageUrl(state.currentImage);
      els.mainImage.alt = state.currentImage;
      els.emptyState.style.display = "none";
      setStatus("鍔犺浇鍥剧墖: " + state.currentImage, 72);
    } else {
      els.mainImage.removeAttribute("src");
      els.emptyState.style.display = "grid";
      clearOverlayCanvas();
      renderImageChrome();
      return;
    }

    renderSwitchChrome();
  }

  function selectAdjacentImage(step) {
    const names = state.filteredImageNames.length ? state.filteredImageNames : state.imageNames;
    const index = names.indexOf(state.currentImage);
    if (index < 0) return;
    const nextIndex = Math.max(0, Math.min(names.length - 1, index + step));
    if (nextIndex === index) return;
    selectImage(names[nextIndex], { scrollList: true });
  }

  function selectObject(index) {
    state.selectedObjectIndex = index;
    objectListView.rerender(state.selectedObjectIndex);
    renderEditor();
    renderOverlay();
    scrollSelectedObjectIntoView();
  }

  function updateEditorBboxInputs() {
    const obj = currentObject();
    if (!obj) return;
    const inputs = els.bboxGrid.querySelectorAll("input");
    inputs.forEach(function eachInput(input, index) {
      input.value = String(obj.bbox[index]);
    });
  }

  function applyEditor() {
    const obj = currentObject();
    if (!obj) return;
    obj.labels = els.labelsEditor.value
      .split(/\r?\n/)
      .map(function trim(item) {
        return item.trim();
      })
      .filter(Boolean);

    const inputs = Array.from(els.bboxGrid.querySelectorAll("input"));
    const next = inputs.map(function toNumber(input) {
      return Number(input.value);
    });
    if (next.length !== 8 || next.some(function invalid(value) { return !Number.isFinite(value); })) {
      setStatus("bbox 必须保持 8 个有效数字", 0);
      return;
    }
    obj.bbox = next;
    refreshImageMeta(state.currentImage);
    renderImageControls();
    setStatus("已应用修改", 100);
    renderAll();
  }

  function addObject() {
    if (!state.currentImage || !state.data) return;
    const width = els.mainImage.naturalWidth || 200;
    const height = els.mainImage.naturalHeight || 160;
    const left = Math.round(width * 0.35);
    const top = Math.round(height * 0.35);
    const right = Math.round(width * 0.65);
    const bottom = Math.round(height * 0.65);
    const objects = currentObjects();
    objects.push({
      labels: ["new_object"],
      bbox: [left, top, right, top, right, bottom, left, bottom],
      attrs: {}
    });
    state.selectedObjectIndex = objects.length - 1;
    refreshImageMeta(state.currentImage);
    renderImageControls();
    setStatus("宸叉柊澧?object", 100);
    renderAll();
  }

  function deleteObject() {
    const objects = currentObjects();
    if (state.selectedObjectIndex < 0 || state.selectedObjectIndex >= objects.length) return;
    objects.splice(state.selectedObjectIndex, 1);
    state.selectedObjectIndex = Math.min(state.selectedObjectIndex, objects.length - 1);
    refreshImageMeta(state.currentImage);
    renderImageControls();
    setStatus("宸插垹闄ら€変腑 object", 100);
    renderAll();
  }

  function applyViewTransform() {
    els.stage.style.transform = "translate(" + state.panX + "px, " + state.panY + "px) scale(" + state.zoom + ")";
    els.zoomText.textContent = Math.round(state.zoom * 100) + "%";
    els.imageInfoZoom.textContent = els.zoomText.textContent;
    renderOverlay();
  }

  function applyImageBrightness() {
    els.mainImage.style.filter = "brightness(" + (state.imageBrightness / 100).toFixed(2) + ")";
  }

  function applyZoom() {
    state.zoom = clampZoom(state.zoom);
    if (state.viewFrame) return;
    state.viewFrame = window.requestAnimationFrame(function onframe() {
      state.viewFrame = 0;
      applyViewTransform();
    });
  }

  function zoomAt(clientX, clientY, nextZoom) {
    const oldZoom = state.zoom;
    const newZoom = clampZoom(nextZoom);
    if (newZoom === oldZoom) return;

    const rect = els.canvasShell.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const imageX = (offsetX - state.panX) / oldZoom;
    const imageY = (offsetY - state.panY) / oldZoom;

    state.zoom = newZoom;
    state.panX = offsetX - imageX * newZoom;
    state.panY = offsetY - imageY * newZoom;
    applyZoom();
  }

  function wheelZoom(event) {
    if (!state.currentImage || !els.mainImage.naturalWidth) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, state.zoom * factor);
  }

  function getImageCoordsFromClient(clientX, clientY) {
    const rect = els.canvasShell.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / state.zoom,
      y: (clientY - rect.top - state.panY) / state.zoom
    };
  }

  function startPan(event) {
    if (event.button !== 0 || state.drag || !state.currentImage) return;
    const coords = getImageCoordsFromClient(event.clientX, event.clientY);
    const handleIndex = findHandleHit(coords.x, coords.y);
    if (handleIndex >= 0) {
      event.preventDefault();
      state.drag = { objectIndex: state.selectedObjectIndex, pointIndex: handleIndex };
      els.canvasShell.setPointerCapture(event.pointerId);
      return;
    }

    const hitIndex = pickObjectAtPoint(coords.x, coords.y);
    if (hitIndex >= 0) {
      event.preventDefault();
      selectObject(hitIndex);
      return;
    }

    if (event.target.closest && event.target.closest("button, input, textarea, select")) return;
    event.preventDefault();
    state.pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: state.panX,
      top: state.panY,
      moved: false
    };
    els.canvasShell.classList.add("is-panning");
    els.canvasShell.setPointerCapture(event.pointerId);
  }

  function movePan(event) {
    if (state.drag) {
      const obj = currentObjects()[state.drag.objectIndex];
      if (!obj) return;
      const coords = getImageCoordsFromClient(event.clientX, event.clientY);
      const base = state.drag.pointIndex * 2;
      obj.bbox[base] = Math.round(coords.x);
      obj.bbox[base + 1] = Math.round(coords.y);
      updateEditorBboxInputs();
      els.bboxSizeText.textContent = formatBboxSize(obj.bbox);
      renderOverlay();
      return;
    }

    if (!state.pan) return;
    const dx = event.clientX - state.pan.x;
    const dy = event.clientY - state.pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      state.pan.moved = true;
      state.suppressNextClick = true;
    }
    state.panX = state.pan.left + dx;
    state.panY = state.pan.top + dy;
    applyZoom();
  }

  function endPan() {
    state.drag = null;
    if (!state.pan) return;
    state.pan = null;
    els.canvasShell.classList.remove("is-panning");
    window.setTimeout(function resetClick() {
      state.suppressNextClick = false;
    }, 0);
  }

  function resetView() {
    const width = els.mainImage.naturalWidth || 0;
    const height = els.mainImage.naturalHeight || 0;
    if (!width || !height) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      if (state.viewFrame) {
        window.cancelAnimationFrame(state.viewFrame);
        state.viewFrame = 0;
      }
      applyViewTransform();
      return;
    }
    const availableWidth = els.canvasShell.clientWidth - 24;
    const availableHeight = els.canvasShell.clientHeight - 24;
    state.zoom = Math.min(1, availableWidth / width, availableHeight / height);
    state.panX = Math.round((els.canvasShell.clientWidth - width * state.zoom) / 2);
    state.panY = Math.round((els.canvasShell.clientHeight - height * state.zoom) / 2);
    if (state.viewFrame) {
      window.cancelAnimationFrame(state.viewFrame);
      state.viewFrame = 0;
    }
    applyViewTransform();
  }

  async function copyJson() {
    const text = exportText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("宸插鍒?JSON", 100);
    } catch (error) {
      els.jsonInput.value = text;
      els.jsonInput.select();
      setStatus("褰撳墠娴忚鍣ㄤ笉鍏佽鐩存帴澶嶅埗, 宸查€変腑鏂囨湰", 100);
    }
  }

  function downloadJson() {
    const text = exportText();
    if (!text) return;
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "annotations_det_edited.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("宸插鍑?JSON", 100);
  }

  function formatJson() {
    try {
      els.jsonInput.value = JSON.stringify(JSON.parse(els.jsonInput.value), null, 2);
      setStatus("宸叉牸寮忓寲 JSON", 100);
    } catch (error) {
      setStatus("鏍煎紡鍖栧け璐? " + error.message, 0);
    }
  }

  function shouldIgnoreImageShortcut(event) {
    const target = event.target;
    if (!target || !target.tagName) return false;
    if (target.isContentEditable) return true;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  }

  function handleImageListClick(event) {
    const button = event.target.closest ? event.target.closest("button[data-image-index]") : null;
    if (!button || !els.imageList.contains(button)) return;
    const index = Number(button.dataset.imageIndex);
    const name = state.filteredImageNames[index];
    if (typeof name === "string") {
      selectImage(name);
    }
  }

  function handleObjectListClick(event) {
    const button = event.target.closest ? event.target.closest("button[data-object-index]") : null;
    if (!button || !els.objectList.contains(button)) return;
    selectObject(Number(button.dataset.objectIndex));
  }

  function stopPointerBubble(event) {
    event.stopPropagation();
  }

  els.loadBtn.addEventListener("click", loadJson);
  els.formatBtn.addEventListener("click", formatJson);
  els.copyJsonBtn.addEventListener("click", copyJson);
  els.downloadJsonBtn.addEventListener("click", downloadJson);
  els.jsonFileInput.addEventListener("change", function onchange(event) {
    readJsonFile(event.target.files[0]);
  });
  els.imageFilter.addEventListener("input", renderImageControls);
  els.labelFilter.addEventListener("input", renderImageControls);
  [els.widthMinFilter, els.widthMaxFilter, els.heightMinFilter, els.heightMaxFilter].forEach(function bind(input) {
    input.addEventListener("input", renderImageControls);
  });
  els.applyFiltersBtn.addEventListener("click", applyFilters);
  els.clearFiltersBtn.addEventListener("click", clearFilters);
  els.imageList.addEventListener("click", handleImageListClick);
  els.objectList.addEventListener("click", handleObjectListClick);
  els.prevImageBtn.addEventListener("pointerdown", stopPointerBubble);
  els.nextImageBtn.addEventListener("pointerdown", stopPointerBubble);
  els.prevImageBtn.addEventListener("click", function onprev() {
    selectAdjacentImage(-1);
  });
  els.nextImageBtn.addEventListener("click", function onnext() {
    selectAdjacentImage(1);
  });
  els.mainImage.addEventListener("load", function onload() {
    syncCanvasSize();
    if (setKnownImageSize(state.currentImage, els.mainImage.naturalWidth || 0, els.mainImage.naturalHeight || 0)) {
      updateKnownSizeText();
      if (hasSizeFilters()) {
        renderImageControls();
      }
    }
    resetView();
    renderSwitchChrome();
    if (state.sizeScanActive) {
      updateImageSizeScanStatus();
      renderAll();
      preloadAdjacentImages();
      return;
    }
    setStatus("鍥剧墖宸插姞杞? " + state.currentImage, 100);
    renderAll();
    preloadAdjacentImages();
  });
  els.mainImage.addEventListener("error", function onerror() {
    syncCanvasSize();
    renderOverlay();
    setStatus("鍥剧墖鍔犺浇澶辫触, 璇锋鏌?prefix: " + state.currentImage, 0);
  });
  els.resetViewBtn.addEventListener("click", resetView);
  els.boxVisibilityBtn.addEventListener("click", function onbox() {
    state.showBoxes = !state.showBoxes;
    renderBoxVisibilityToggle();
    renderOverlay();
  });
  els.fillToggleBtn.addEventListener("click", function onfill() {
    state.showBoxFill = !state.showBoxFill;
    renderFillToggle();
    renderOverlay();
  });
  els.strokeWidthRange.addEventListener("input", function oninput(event) {
    state.boxStrokeWidth = Number(event.target.value) || 3;
    renderSliderValues();
    renderOverlay();
  });
  els.labelSizeRange.addEventListener("input", function oninput(event) {
    state.labelFontSize = Number(event.target.value) || 13;
    renderSliderValues();
    renderOverlay();
  });
  els.brightnessRange.addEventListener("input", function oninput(event) {
    state.imageBrightness = clampBrightness(Number(event.target.value) || 100);
    renderSliderValues();
    applyImageBrightness();
  });
  els.zoomOutBtn.addEventListener("click", function onzoomout() {
    const rect = els.canvasShell.getBoundingClientRect();
    zoomAt(rect.left + els.canvasShell.clientWidth / 2, rect.top + els.canvasShell.clientHeight / 2, state.zoom - 0.1);
  });
  els.zoomInBtn.addEventListener("click", function onzoomin() {
    const rect = els.canvasShell.getBoundingClientRect();
    zoomAt(rect.left + els.canvasShell.clientWidth / 2, rect.top + els.canvasShell.clientHeight / 2, state.zoom + 0.1);
  });
  els.addObjectBtn.addEventListener("click", addObject);
  els.deleteObjectBtn.addEventListener("click", deleteObject);
  els.applyObjectBtn.addEventListener("click", applyEditor);
  els.labelsEditor.addEventListener("change", applyEditor);
  els.canvasShell.addEventListener("wheel", wheelZoom, { passive: false });
  els.canvasShell.addEventListener("pointerdown", startPan);
  els.canvasShell.addEventListener("pointermove", movePan);
  els.canvasShell.addEventListener("pointerup", endPan);
  els.canvasShell.addEventListener("pointercancel", endPan);
  els.canvasShell.addEventListener("click", function onclick(event) {
    if (state.suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!state.currentImage) return;
    const coords = getImageCoordsFromClient(event.clientX, event.clientY);
    const hitIndex = pickObjectAtPoint(coords.x, coords.y);
    if (hitIndex >= 0) {
      selectObject(hitIndex);
    }
  }, true);
  document.addEventListener("keydown", function onkeydown(event) {
    if (shouldIgnoreImageShortcut(event)) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectAdjacentImage(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectAdjacentImage(1);
    }
  });
  window.addEventListener("resize", function onresize() {
    syncCanvasSize();
    resetView();
    renderOverlay();
  });

  renderFull();
  applyImageBrightness();
})();
