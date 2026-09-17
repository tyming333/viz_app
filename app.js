(function () {
  "use strict";

  const { collectDataLabels, matchesLabelFilter, firstFilteredImageName } = window.ViewerCore;

  const els = {
    prefixInput: document.getElementById("prefixInput"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    jsonInput: document.getElementById("jsonInput"),
    copyJsonBtn: document.getElementById("copyJsonBtn"),
    downloadJsonBtn: document.getElementById("downloadJsonBtn"),
    exportSelectedBtn: document.getElementById("exportSelectedBtn"),
    progressBar: document.getElementById("progressBar"),
    statusText: document.getElementById("statusText"),
    imageCount: document.getElementById("imageCount"),
    imageFilter: document.getElementById("imageFilter"),
    labelFilter: document.getElementById("labelFilter"),
    labelSelect: document.getElementById("labelSelect"),
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
    showAllBoxesBtn: document.getElementById("showAllBoxesBtn"),
    fillToggleBtn: document.getElementById("fillToggleBtn"),
    keypointVisibilityBtn: document.getElementById("keypointVisibilityBtn"),
    keypointLabelBtn: document.getElementById("keypointLabelBtn"),
    strokeWidthRange: document.getElementById("strokeWidthRange"),
    strokeWidthText: document.getElementById("strokeWidthText"),
    labelSizeRange: document.getElementById("labelSizeRange"),
    labelSizeText: document.getElementById("labelSizeText"),
    brightnessRange: document.getElementById("brightnessRange"),
    brightnessText: document.getElementById("brightnessText"),
    resetBrightnessBtn: document.getElementById("resetBrightnessBtn"),
    contrastRange: document.getElementById("contrastRange"),
    contrastText: document.getElementById("contrastText"),
    resetContrastBtn: document.getElementById("resetContrastBtn"),
    imageInfoIndex: document.getElementById("imageInfoIndex"),
    imageInfoSize: document.getElementById("imageInfoSize"),
    imageInfoObjects: document.getElementById("imageInfoObjects"),
    imageInfoZoom: document.getElementById("imageInfoZoom"),
    imageInfoCreated: document.getElementById("imageInfoCreated"),
    objectCount: document.getElementById("objectCount"),
    addRectangleBtn: document.getElementById("addRectangleBtn"),
    addQuadrilateralBtn: document.getElementById("addQuadrilateralBtn"),
    deleteObjectBtn: document.getElementById("deleteObjectBtn"),
    objectList: document.getElementById("objectList"),
    selectedBadge: document.getElementById("selectedBadge"),
    bboxSizeText: document.getElementById("bboxSizeText"),
    labelsEditor: document.getElementById("labelsEditor"),
    bboxGrid: document.getElementById("bboxGrid"),
    addKeypointBtn: document.getElementById("addKeypointBtn"),
    keypointList: document.getElementById("keypointList"),
    applyObjectBtn: document.getElementById("applyObjectBtn")
  };

  const colors = ["#4ade80", "#38bdf8", "#facc15", "#fb7185", "#a78bfa", "#2dd4bf"];
  const pointNames = ["x1", "y1", "x2", "y2", "x3", "y3", "x4", "y4"];
  const overlayContext = els.overlayCanvas.getContext("2d");

  const state = {
    data: null,
    imageNames: [],
    filteredImageNames: [],
    appliedFilters: {
      image: "",
      label: "",
      labelExact: "",
      widthMin: "",
      widthMax: "",
      heightMin: "",
      heightMax: ""
    },
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
    pendingKeypointPlacement: null,
    showBoxes: true,
    showBoxFill: true,
    showKeypoints: true,
    showKeypointLabels: true,
    boxStrokeWidth: 3,
    labelFontSize: 13,
    imageBrightness: 100,
    imageContrast: 100,
    viewFrame: 0,
    overlayFrame: 0,
    imageListScrollFrame: 0,
    suppressNextClick: false,
    workerJobId: 0,
    sizeScanJobId: 0,
    sizeScanActive: false,
    sizeScanCompleted: 0,
    sizeScanTotal: 0,
    selectedImages: new Set()
  };

  const preloadImages = new Map();
  let imageWorker = null;

  function isMissingKeypoint(point) {
    return point === null || (Array.isArray(point) && point.length === 1 && point[0] === "null");
  }

  function validateObjectKeypoints(imageName, obj, objectIndex) {
    if (obj.keypoints === undefined || obj.keypoints === null) return;
    if (typeof obj.keypoints !== "object" || Array.isArray(obj.keypoints)) {
      throw new Error(imageName + " 的 object " + (objectIndex + 1) + " keypoints 必须是对象");
    }
    if (!Array.isArray(obj.keypoints.points)) {
      throw new Error(imageName + " 的 object " + (objectIndex + 1) + " keypoints.points 必须是坐标数组");
    }
    obj.keypoints.points.forEach(function eachKeypoint(point, pointIndex) {
      // Some annotations reserve a keypoint slot with null or ["null"].
      // Both forms mean the point is absent and are skipped by overlay rendering.
      if (isMissingKeypoint(point)) return;
      if (!Array.isArray(point) || point.length < 2) {
        throw new Error(imageName + " 的 object " + (objectIndex + 1) + " keypoint " + (pointIndex + 1) + " 必须是 [x, y]");
      }
      if (typeof point[0] !== "number" || !Number.isFinite(point[0]) || typeof point[1] !== "number" || !Number.isFinite(point[1])) {
        throw new Error(imageName + " 的 object " + (objectIndex + 1) + " keypoint " + (pointIndex + 1) + " 坐标不是有效数字");
      }
    });
    if (obj.keypoints.names !== undefined && obj.keypoints.names !== null && !Array.isArray(obj.keypoints.names)) {
      throw new Error(imageName + " 的 object " + (objectIndex + 1) + " keypoints.names 必须是数组");
    }
  }

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
        validateObjectKeypoints(name, obj, index);
      });
      objectTotal += objects.length;
      meta[name] = buildImageMetaFromObjects(name, objects);
    });

    return {
      imageNames,
      objectTotal,
      meta,
      labels: collectDataLabels(data)
    };
  }

  function buildImageMetaFromObjects(name, objects) {
    const labels = collectImageLabels(objects);
    return {
      nameLower: name.toLowerCase(),
      labelText: Array.from(labels, function lower(label) {
        return label.toLowerCase();
      }).join("\n"),
      labels: Array.from(labels),
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
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "image-check";
        checkbox.checked = state.selectedImages.has(view.items[i]);
        checkbox.dataset.imageIndex = String(i);
        checkbox.title = "勾选导出图片";
        const button = document.createElement("button");
        button.type = "button";
        button.dataset[view.buttonDatasetKey] = String(i);
        button.textContent = view.getLabel(view.items[i], i);
        button.title = button.textContent;
        if (i === view.selectedIndex) {
          button.classList.add("active");
        }
        row.appendChild(checkbox);
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

  const imageListView = createVirtualList(els.imageList, 27, "imageIndex", function getImageLabel(item) {
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

  function visibleOverlayObjects() {
    const objects = currentObjects();
    return objects.filter(function filterObject(obj) {
      const labels = Array.isArray(obj.labels) ? obj.labels : [];
      return matchesLabelFilter(labels, state.appliedFilters.labelExact, state.appliedFilters.label);
    });
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

  function renderLabelOptions(labels) {
    const items = Array.isArray(labels) ? labels : [];
    const current = els.labelSelect.value || state.appliedFilters.labelExact;
    const fragment = document.createDocumentFragment();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "全部 labels";
    fragment.appendChild(allOption);
    items.forEach(function addLabelOption(label) {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      fragment.appendChild(option);
    });
    els.labelSelect.replaceChildren(fragment);
    els.labelSelect.disabled = items.length === 0;
    if (items.includes(current)) {
      els.labelSelect.value = current;
      return;
    }
    els.labelSelect.value = "";
    if (state.appliedFilters.labelExact === current) state.appliedFilters.labelExact = "";
  }

  function refreshLabelOptions() {
    renderLabelOptions(collectDataLabels(state.data));
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

  // Older annotations have no type marker and retain the original free four-point behavior.
  function getObjectBoxType(obj) {
    return obj && obj.attrs && obj.attrs.box_type === "rectangle" ? "rectangle" : "quadrilateral";
  }

  function setRectangleHandlePosition(bbox, handleIndex, x, y) {
    const points = bboxToPoints(bbox);
    const opposite = points[(handleIndex + 2) % 4];
    const left = Math.min(x, opposite[0]);
    const right = Math.max(x, opposite[0]);
    const top = Math.min(y, opposite[1]);
    const bottom = Math.max(y, opposite[1]);
    return [left, top, right, top, right, bottom, left, bottom];
  }

  function translateBbox(bbox, dx, dy) {
    return bbox.map(function translateCoordinate(value, index) {
      return Math.round(value + (index % 2 === 0 ? dx : dy));
    });
  }

  function getObjectKeypointPoints(obj) {
    if (!obj || !obj.keypoints || !Array.isArray(obj.keypoints.points)) return [];
    return obj.keypoints.points.reduce(function collectKeypoints(result, point, index) {
      if (!isMissingKeypoint(point)) {
        result.push({ point: point, index: index });
      }
      return result;
    }, []);
  }

  function getObjectKeypointName(obj, index) {
    if (!obj || !obj.keypoints || !Array.isArray(obj.keypoints.names)) return undefined;
    return obj.keypoints.names[index];
  }

  function getDefaultKeypointName(index) {
    return "p" + (index + 1);
  }

  function ensureObjectKeypoints(obj) {
    if (!obj.keypoints || typeof obj.keypoints !== "object" || Array.isArray(obj.keypoints)) {
      obj.keypoints = { names: [], format: "xy", points: [] };
    }
    if (!Array.isArray(obj.keypoints.points)) obj.keypoints.points = [];
    if (!Array.isArray(obj.keypoints.names)) obj.keypoints.names = [];
    return obj.keypoints;
  }

  function getKeypointEditorName(obj, index) {
    const name = getObjectKeypointName(obj, index);
    return name === undefined || name === null || name === "" ? getDefaultKeypointName(index) : String(name);
  }

  function clampZoom(value) {
    return Math.max(0.1, Math.min(4, value));
  }

  function clampBrightness(value) {
    return Math.max(0, Math.min(600, value));
  }

  function clampContrast(value) {
    return Math.max(0, Math.min(600, value));
  }

  function getVisibleImageNames() {
    const filters = state.appliedFilters;
    const nameFilter = filters.image.trim().toLowerCase();
    const widthMin = filters.widthMin === "" ? null : Number(filters.widthMin);
    const widthMax = filters.widthMax === "" ? null : Number(filters.widthMax);
    const heightMin = filters.heightMin === "" ? null : Number(filters.heightMin);
    const heightMax = filters.heightMax === "" ? null : Number(filters.heightMax);

    return state.imageNames.filter(function filterImage(name) {
      const meta = state.imageMeta.get(name);
      if (nameFilter && (!meta || !meta.nameLower.includes(nameFilter))) return false;
      if (!meta || !matchesLabelFilter(meta.labels, filters.labelExact, filters.label)) return false;
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
    els.knownSizeText.textContent = "宽高筛选基于已知图像尺寸 " + state.knownImageSizes.size + "/" + state.imageNames.length;
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
    setStatus("正在读取图片尺寸... " + state.sizeScanCompleted + "/" + state.sizeScanTotal, percent);
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
      setStatus("没有可读取尺寸的图片", 100);
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
    setStatus("已完成图片尺寸读取 " + state.knownImageSizes.size + "/" + state.imageNames.length, 100);
  }

  function clearFilters() {
    els.imageFilter.value = "";
    els.labelFilter.value = "";
    els.labelSelect.value = "";
    els.widthMinFilter.value = "";
    els.widthMaxFilter.value = "";
    els.heightMinFilter.value = "";
    els.heightMaxFilter.value = "";
    state.appliedFilters = { image: "", label: "", labelExact: "", widthMin: "", widthMax: "", heightMin: "", heightMax: "" };
    renderImageControls();
  }

  function applyFilters() {
    state.appliedFilters = {
      image: els.imageFilter.value,
      label: els.labelFilter.value,
      labelExact: els.labelSelect.value,
      widthMin: els.widthMinFilter.value,
      widthMax: els.widthMaxFilter.value,
      heightMin: els.heightMinFilter.value,
      heightMax: els.heightMaxFilter.value
    };
    renderImageControls();
    selectImage(firstFilteredImageName(state.filteredImageNames), { scrollList: true });
    setStatus("已刷新筛选结果: " + state.filteredImageNames.length + "/" + state.imageNames.length, 100);
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
        setStatus("读取 JSON 文件...", Math.round((event.loaded / event.total) * 45));
      }
    };
    reader.onload = function onload() {
      els.jsonInput.value = String(reader.result || "");
      setStatus("JSON 文件读取完成", 50);
      loadJson();
    };
    reader.onerror = function onerror() {
      setStatus("JSON 文件读取失败", 0);
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
        const phaseText = message.phase === "parse" ? "解析 JSON..." : "校验数据...";
        setStatus(phaseText, message.percent);
        return;
      }
      if (message.type === "error") {
        state.data = null;
        state.imageNames = [];
        state.filteredImageNames = [];
        state.imageMeta.clear();
        renderLabelOptions([]);
        state.knownImageSizes.clear();
        preloadImages.clear();
        state.currentImage = "";
        state.currentImageIndex = -1;
        state.selectedObjectIndex = -1;
        setStatus("加载失败: " + message.message, 0);
        renderFull();
        return;
      }
      if (message.type === "success") {
        applyLoadedPayload(message.payload);
      }
    });
    imageWorker.addEventListener("error", function onerror() {
      imageWorker = null;
      setStatus("Worker 不可用，切换为主线程解析...", 8);
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
    renderLabelOptions(payload.labels);
    state.knownImageSizes.clear();
    preloadImages.clear();
    state.currentImage = "";
    state.currentImageIndex = -1;
    state.selectedObjectIndex = -1;
    state.selectedImages.clear();
    const firstImage = state.imageNames[0] || "";
    setStatus("已加载 " + state.imageNames.length + " 张图片，" + payload.objectTotal + " 个 objects", 70);
    renderImageControls();
    selectImage(firstImage);
    state.sizeScanActive = state.imageNames.length > 0;
    state.sizeScanCompleted = 0;
    state.sizeScanTotal = state.imageNames.length;
    window.setTimeout(startImageSizeScan, 0);
    if (state.imageNames.length) {
      setStatus("正在读取图片尺寸... 0/" + state.imageNames.length, 70);
      return;
    }
    if (state.imageNames.length) {
      setStatus("正在读取图片尺寸... 0/" + state.imageNames.length, 70);
    }
    setStatus("已加载 " + state.imageNames.length + " 张图片，" + payload.objectTotal + " 个 objects", 100);
  }

  function loadJsonOnMainThread(text) {
    try {
      setStatus("解析 JSON...", 10);
      cancelImageSizeScan();
      const parsed = JSON.parse(text);
      setStatus("校验数据...", 40);
      const result = validateData(parsed);
      applyLoadedPayload({
        data: parsed,
        imageNames: result.imageNames,
        objectTotal: result.objectTotal,
        meta: result.meta,
        labels: result.labels
      });
    } catch (error) {
      cancelImageSizeScan();
      state.data = null;
      state.imageNames = [];
      state.filteredImageNames = [];
      state.imageMeta.clear();
      renderLabelOptions([]);
      state.knownImageSizes.clear();
      preloadImages.clear();
      state.currentImage = "";
      state.currentImageIndex = -1;
      state.selectedObjectIndex = -1;
      state.selectedImages.clear();
      setStatus("加载失败: " + error.message, 0);
      renderFull();
    }
  }

  function loadJson() {
    const text = els.jsonInput.value;
    if (!text.trim()) {
      setStatus("请输入或导入 JSON", 0);
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
    setStatus("准备解析 JSON...", 2);
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
      const keypointCount = getObjectKeypointPoints(obj).length;
      const type = getObjectBoxType(obj) === "rectangle" ? "矩形" : "四点框";
      const suffix = " · " + type + (keypointCount ? " · " + keypointCount + " pts" : "");
      return (text || "object " + (index + 1)) + suffix;
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
    els.addKeypointBtn.disabled = !obj;
    els.labelsEditor.value = obj ? (obj.labels || []).join("\n") : "";
    renderKeypointPlacementButton();

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
    renderKeypointEditor(obj);
  }

  function renderKeypointEditor(obj) {
    const fragment = document.createDocumentFragment();
    const keypoints = obj ? getObjectKeypointPoints(obj) : [];
    if (!obj || !keypoints.length) {
      const empty = document.createElement("div");
      empty.className = "keypoint-empty";
      empty.textContent = obj ? "暂无关键点，可通过“新增点”创建" : "未选中";
      fragment.appendChild(empty);
      els.keypointList.replaceChildren(fragment);
      return;
    }

    keypoints.forEach(function eachKeypoint(keypoint) {
      const row = document.createElement("div");
      const nameInput = document.createElement("input");
      const xInput = document.createElement("input");
      const yInput = document.createElement("input");
      const deleteBtn = document.createElement("button");
      row.className = "keypoint-row";
      row.dataset.keypointIndex = String(keypoint.index);

      nameInput.type = "text";
      nameInput.value = getKeypointEditorName(obj, keypoint.index);
      nameInput.setAttribute("aria-label", "关键点名称");
      nameInput.dataset.keypointField = "name";

      [xInput, yInput].forEach(function configureCoord(input, coordIndex) {
        input.type = "number";
        input.step = "1";
        input.value = String(keypoint.point[coordIndex]);
        input.setAttribute("aria-label", coordIndex === 0 ? "关键点 X 坐标" : "关键点 Y 坐标");
        input.dataset.keypointField = coordIndex === 0 ? "x" : "y";
      });

      deleteBtn.type = "button";
      deleteBtn.textContent = "x";
      deleteBtn.title = "删除关键点";
      deleteBtn.setAttribute("aria-label", "删除关键点");
      deleteBtn.dataset.keypointAction = "delete";

      row.append(nameInput, xInput, yInput, deleteBtn);
      fragment.appendChild(row);
    });
    els.keypointList.replaceChildren(fragment);
  }

  function isKeypointPlacementPending() {
    const request = state.pendingKeypointPlacement;
    return !!request && request.image === state.currentImage && request.objectIndex === state.selectedObjectIndex;
  }

  function renderKeypointPlacementButton() {
    const pending = isKeypointPlacementPending();
    els.addKeypointBtn.textContent = pending ? "取消放点" : "新增点";
    els.addKeypointBtn.classList.toggle("active", pending);
    els.addKeypointBtn.setAttribute("aria-pressed", String(pending));
    els.addKeypointBtn.title = pending ? "取消图像点击放点" : "在图像上点击选择新关键点位置";
    els.canvasShell.classList.toggle("is-placing-keypoint", pending);
  }

  function renderImageInfo() {
    const hasImage = state.currentImageIndex >= 0 && !!state.currentImage;
    const width = els.mainImage.naturalWidth || 0;
    const height = els.mainImage.naturalHeight || 0;
    els.imageInfoIndex.textContent = hasImage ? state.currentImageIndex + 1 + "/" + state.imageNames.length : "-";
    els.imageInfoSize.textContent = width && height ? width + " x " + height : "-";
    els.imageInfoObjects.textContent = String(currentObjects().length);
    els.imageInfoZoom.textContent = Math.round(state.zoom * 100) + "%";
    els.imageInfoCreated.textContent = hasImage ? "无法读取" : "-";
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
    els.contrastRange.value = String(state.imageContrast);
    els.contrastText.textContent = Math.round(state.imageContrast) + "%";
  }

  function renderBoxVisibilityToggle() {
    els.boxVisibilityBtn.classList.toggle("active", state.showBoxes);
    els.boxVisibilityBtn.setAttribute("aria-pressed", String(state.showBoxes));
    els.boxVisibilityBtn.title = state.showBoxes ? "隐藏所有框" : "显示所有框";
  }

  function renderFillToggle() {
    els.fillToggleBtn.classList.toggle("active", state.showBoxFill);
    els.fillToggleBtn.setAttribute("aria-pressed", String(state.showBoxFill));
  }

  function showAllBoxes() {
    state.showBoxes = true;
    renderBoxVisibilityToggle();
    renderOverlay();
  }

  function renderKeypointVisibilityToggle() {
    els.keypointVisibilityBtn.classList.toggle("active", state.showKeypoints);
    els.keypointVisibilityBtn.setAttribute("aria-pressed", String(state.showKeypoints));
    els.keypointVisibilityBtn.title = state.showKeypoints ? "隐藏所有关键点" : "显示所有关键点";
  }

  function renderKeypointLabelToggle() {
    els.keypointLabelBtn.classList.toggle("active", state.showKeypointLabels);
    els.keypointLabelBtn.setAttribute("aria-pressed", String(state.showKeypointLabels));
    els.keypointLabelBtn.title = state.showKeypointLabels ? "隐藏关键点标签" : "显示关键点标签";
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
    overlayContext.setTransform(1, 0, 0, 1, 0, 0);
    overlayContext.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  }

  function syncCanvasSize() {
    const imageWidth = els.mainImage.naturalWidth || els.mainImage.width || 0;
    const imageHeight = els.mainImage.naturalHeight || els.mainImage.height || 0;
    const canvasWidth = els.canvasShell.clientWidth || 1;
    const canvasHeight = els.canvasShell.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    els.overlayCanvas.width = Math.max(1, Math.round(canvasWidth * dpr));
    els.overlayCanvas.height = Math.max(1, Math.round(canvasHeight * dpr));
    els.overlayCanvas.style.width = canvasWidth + "px";
    els.overlayCanvas.style.height = canvasHeight + "px";
    overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    els.stage.style.width = imageWidth ? imageWidth + "px" : "100%";
    els.stage.style.height = imageHeight ? imageHeight + "px" : "100%";
  }

  function syncOverlayCanvasSizeIfNeeded() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round((els.canvasShell.clientWidth || 1) * dpr));
    const height = Math.max(1, Math.round((els.canvasShell.clientHeight || 1) * dpr));
    if (els.overlayCanvas.width !== width || els.overlayCanvas.height !== height) {
      syncCanvasSize();
    }
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

  function findKeypointHit(imageX, imageY) {
    const obj = currentObject();
    if (!obj) return -1;
    const threshold = 9 / getOverlayScale();
    const keypoints = getObjectKeypointPoints(obj);
    for (let i = 0; i < keypoints.length; i += 1) {
      const keypoint = keypoints[i];
      const dx = keypoint.point[0] - imageX;
      const dy = keypoint.point[1] - imageY;
      if (Math.sqrt(dx * dx + dy * dy) <= threshold) return keypoint.index;
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

  function drawKeypoints(keypoints, color, active) {
    if (!keypoints.length) return;
    const radius = (active ? 5.5 : 4.5) / getOverlayScale();
    overlayContext.save();
    overlayContext.lineWidth = (active ? 2.5 : 1.5) / getOverlayScale();
    overlayContext.strokeStyle = active ? "#facc15" : "#ffffff";
    overlayContext.fillStyle = color;
    keypoints.forEach(function eachKeypoint(keypoint) {
      const point = keypoint.point;
      overlayContext.beginPath();
      overlayContext.arc(point[0], point[1], radius, 0, Math.PI * 2);
      overlayContext.fill();
      overlayContext.stroke();
    });
    overlayContext.restore();
  }

  function drawKeypointLabels(keypoints, obj, active) {
    if (!keypoints.length) return;
    overlayContext.save();
    overlayContext.font = "700 " + Math.max(8, getRenderedLabelFontSize() - 2) / getOverlayScale() + "px Microsoft YaHei";
    overlayContext.textBaseline = "middle";
    overlayContext.lineJoin = "round";
    overlayContext.lineWidth = getRenderedLabelStrokeWidth() / getOverlayScale();
    overlayContext.strokeStyle = "rgba(0,0,0,0.82)";
    overlayContext.fillStyle = active ? "#facc15" : "#ffffff";
    keypoints.forEach(function eachKeypointLabel(keypoint) {
      const point = keypoint.point;
      const rawName = getObjectKeypointName(obj, keypoint.index);
      const label = rawName === undefined || rawName === null || rawName === "" ? "p" + (keypoint.index + 1) : String(rawName);
      const x = point[0] + 7 / getOverlayScale();
      const y = point[1] - 7 / getOverlayScale();
      overlayContext.strokeText(label, x, y);
      overlayContext.fillText(label, x, y);
    });
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
    syncOverlayCanvasSizeIfNeeded();
    clearOverlayCanvas();
    if (!state.currentImage || !els.mainImage.naturalWidth) return;
    const dpr = window.devicePixelRatio || 1;
    overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayContext.translate(state.panX, state.panY);
    overlayContext.scale(state.zoom, state.zoom);
    const objects = visibleOverlayObjects();
    objects.forEach(function eachObject(obj, index) {
      const points = bboxToPoints(obj.bbox);
      const color = colors[index % colors.length];
      const active = index === state.selectedObjectIndex;
      if (state.showBoxes) {
        drawPolygon(points, color, "rgba(37,99,235,0.14)", active);
        drawLabel(points, obj.labels && obj.labels.length ? obj.labels[0] : "object " + (index + 1));
      }
      if (state.showKeypoints) {
        const keypoints = getObjectKeypointPoints(obj);
        drawKeypoints(keypoints, color, active);
        if (state.showKeypointLabels) {
          drawKeypointLabels(keypoints, obj, active);
        }
      }
    });
    if (state.showBoxes) {
      drawHandles();
    }
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
    renderKeypointVisibilityToggle();
    renderKeypointLabelToggle();
    renderSliderValues();
    renderImageInfo();
    applyZoom();
  }

  function renderSwitchChrome() {
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderKeypointVisibilityToggle();
    renderKeypointLabelToggle();
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
    renderKeypointVisibilityToggle();
    renderKeypointLabelToggle();
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
    state.pendingKeypointPlacement = null;
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
      setStatus("加载图片: " + state.currentImage, 72);
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
    if (state.pendingKeypointPlacement && state.pendingKeypointPlacement.objectIndex !== index) {
      state.pendingKeypointPlacement = null;
    }
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

  function updateEditorKeypointInputs(keypointIndex) {
    const obj = currentObject();
    if (!obj || !obj.keypoints || !Array.isArray(obj.keypoints.points)) return;
    const point = obj.keypoints.points[keypointIndex];
    if (isMissingKeypoint(point)) return;
    const row = els.keypointList.querySelector('[data-keypoint-index="' + keypointIndex + '"]');
    if (!row) return;
    const xInput = row.querySelector('[data-keypoint-field="x"]');
    const yInput = row.querySelector('[data-keypoint-field="y"]');
    if (xInput) xInput.value = String(point[0]);
    if (yInput) yInput.value = String(point[1]);
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
    refreshLabelOptions();
    renderImageControls();
    setStatus("已应用修改", 100);
    renderAll();
  }

  function applyKeypointEditor() {
    const obj = currentObject();
    if (!obj) return;
    const keypoints = ensureObjectKeypoints(obj);
    const rows = Array.from(els.keypointList.querySelectorAll(".keypoint-row"));
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const pointIndex = Number(row.dataset.keypointIndex);
      const x = Number(row.querySelector('[data-keypoint-field="x"]').value);
      const y = Number(row.querySelector('[data-keypoint-field="y"]').value);
      if (!Number.isInteger(pointIndex) || !Number.isFinite(x) || !Number.isFinite(y)) {
        setStatus("关键点坐标必须是有效数字", 0);
        return;
      }
      keypoints.points[pointIndex] = [x, y];
      const name = row.querySelector('[data-keypoint-field="name"]').value.trim();
      keypoints.names[pointIndex] = name || getDefaultKeypointName(pointIndex);
    }
    refreshImageMeta(state.currentImage);
    setStatus("已应用关键点修改", 100);
    renderOverlay();
  }

  function addKeypoint() {
    const obj = currentObject();
    if (!obj) return;
    if (isKeypointPlacementPending()) {
      state.pendingKeypointPlacement = null;
      renderKeypointPlacementButton();
      setStatus("已取消新增关键点", 100);
      return;
    }
    state.pendingKeypointPlacement = {
      image: state.currentImage,
      objectIndex: state.selectedObjectIndex
    };
    renderKeypointPlacementButton();
    setStatus("请在图像上点击，选择新关键点的位置", 100);
  }

  function placePendingKeypoint(imageX, imageY) {
    const request = state.pendingKeypointPlacement;
    if (!request) return false;
    if (request.image !== state.currentImage || request.objectIndex !== state.selectedObjectIndex) {
      state.pendingKeypointPlacement = null;
      renderKeypointPlacementButton();
      return false;
    }

    const width = els.mainImage.naturalWidth || 0;
    const height = els.mainImage.naturalHeight || 0;
    if (imageX < 0 || imageY < 0 || imageX > width || imageY > height) {
      setStatus("请在图像范围内点击放置关键点", 0);
      return true;
    }

    const obj = currentObjects()[request.objectIndex];
    if (!obj) {
      state.pendingKeypointPlacement = null;
      renderKeypointPlacementButton();
      setStatus("目标 object 已不存在，已取消新增关键点", 0);
      return true;
    }

    const keypoints = ensureObjectKeypoints(obj);
    let pointIndex = keypoints.points.findIndex(isMissingKeypoint);
    if (pointIndex < 0) pointIndex = keypoints.points.length;
    keypoints.points[pointIndex] = [Math.round(imageX), Math.round(imageY)];
    if (!keypoints.names[pointIndex]) keypoints.names[pointIndex] = getDefaultKeypointName(pointIndex);
    state.selectedObjectIndex = request.objectIndex;
    state.pendingKeypointPlacement = null;
    refreshImageMeta(state.currentImage);
    renderImageControls();
    setStatus("已新增关键点", 100);
    renderAll();
    return true;
  }

  function deleteKeypoint(pointIndex) {
    const obj = currentObject();
    if (!obj || !obj.keypoints || !Array.isArray(obj.keypoints.points)) return;
    if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= obj.keypoints.points.length) return;
    // Keep the original slot so fixed-index keypoint names remain aligned.
    obj.keypoints.points[pointIndex] = ["null"];
    refreshImageMeta(state.currentImage);
    renderImageControls();
    setStatus("已删除关键点", 100);
    renderAll();
  }

  function addObject(boxType) {
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
      // box_type controls vertex editing: rectangle keeps perpendicular edges, quadrilateral is free-form.
      attrs: { box_type: boxType }
    });
    state.selectedObjectIndex = objects.length - 1;
    refreshImageMeta(state.currentImage);
    refreshLabelOptions();
    renderImageControls();
    setStatus(boxType === "rectangle" ? "已新增矩形框" : "已新增四点框", 100);
    renderAll();
  }

  function deleteObject() {
    const objects = currentObjects();
    if (state.selectedObjectIndex < 0 || state.selectedObjectIndex >= objects.length) return;
    objects.splice(state.selectedObjectIndex, 1);
    state.selectedObjectIndex = Math.min(state.selectedObjectIndex, objects.length - 1);
    refreshImageMeta(state.currentImage);
    refreshLabelOptions();
    renderImageControls();
    setStatus("已删除选中 object", 100);
    renderAll();
  }

  function applyViewTransform() {
    els.stage.style.transform = "translate(" + state.panX + "px, " + state.panY + "px) scale(" + state.zoom + ")";
    els.imageInfoZoom.textContent = Math.round(state.zoom * 100) + "%";
    renderOverlay();
  }

  function applyImageAdjustments() {
    els.mainImage.style.filter =
      "brightness(" + (state.imageBrightness / 100).toFixed(2) + ") " +
      "contrast(" + (state.imageContrast / 100).toFixed(2) + ")";
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
    if (isKeypointPlacementPending()) {
      if (event.target.closest && event.target.closest("button, input, textarea, select")) return;
      event.preventDefault();
      return;
    }
    const coords = getImageCoordsFromClient(event.clientX, event.clientY);
    const keypointIndex = state.showKeypoints ? findKeypointHit(coords.x, coords.y) : -1;
    if (keypointIndex >= 0) {
      event.preventDefault();
      state.drag = { kind: "keypoint", objectIndex: state.selectedObjectIndex, pointIndex: keypointIndex };
      els.canvasShell.setPointerCapture(event.pointerId);
      return;
    }
    const handleIndex = findHandleHit(coords.x, coords.y);
    if (handleIndex >= 0) {
      event.preventDefault();
      state.drag = { kind: "bbox", objectIndex: state.selectedObjectIndex, pointIndex: handleIndex };
      els.canvasShell.setPointerCapture(event.pointerId);
      return;
    }

    const hitIndex = pickObjectAtPoint(coords.x, coords.y);
    if (hitIndex >= 0) {
      event.preventDefault();
      if (hitIndex !== state.selectedObjectIndex) {
        selectObject(hitIndex);
        return;
      }
      state.drag = {
        kind: "object",
        objectIndex: hitIndex,
        startX: coords.x,
        startY: coords.y,
        bbox: currentObjects()[hitIndex].bbox.slice()
      };
      els.canvasShell.setPointerCapture(event.pointerId);
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
      if (state.drag.kind === "keypoint") {
        const keypoints = ensureObjectKeypoints(obj);
        keypoints.points[state.drag.pointIndex] = [Math.round(coords.x), Math.round(coords.y)];
        updateEditorKeypointInputs(state.drag.pointIndex);
        renderOverlay();
        return;
      }
      if (state.drag.kind === "object") {
        obj.bbox = translateBbox(state.drag.bbox, coords.x - state.drag.startX, coords.y - state.drag.startY);
      } else if (getObjectBoxType(obj) === "rectangle") {
        obj.bbox = setRectangleHandlePosition(obj.bbox, state.drag.pointIndex, Math.round(coords.x), Math.round(coords.y));
      } else {
        const base = state.drag.pointIndex * 2;
        obj.bbox[base] = Math.round(coords.x);
        obj.bbox[base + 1] = Math.round(coords.y);
      }
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
      setStatus("已复制 JSON", 100);
    } catch (error) {
      els.jsonInput.value = text;
      els.jsonInput.select();
      setStatus("当前浏览器不允许直接复制，已选中文本", 100);
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
    setStatus("已导出 JSON", 100);
  }

  function toggleImageExportSelection(name, checked) {
    if (checked) {
      state.selectedImages.add(name);
    } else {
      state.selectedImages.delete(name);
    }
  }

  function selectedExportNames() {
    return state.imageNames.filter(function filterSelected(name) {
      return state.selectedImages.has(name);
    });
  }

  function safeRelativeImagePath(name) {
    const normalized = normalizeImagePath(name).replace(/^\/+/, "");
    const parts = normalized.split("/").filter(function keepPart(part) {
      return part && part !== "." && part !== "..";
    });
    return parts.join("/");
  }

  async function readImageBlob(name, sourceDirectory) {
    if (sourceDirectory) {
      let directory = sourceDirectory;
      const parts = safeRelativeImagePath(name).split("/");
      const fileName = parts.pop();
      for (const part of parts) {
        directory = await directory.getDirectoryHandle(part);
      }
      const fileHandle = await directory.getFileHandle(fileName);
      return fileHandle.getFile();
    }
    const response = await fetch(imageUrl(name));
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.blob();
  }

  async function writeImageBlob(root, name, blob) {
    let directory = await root.getDirectoryHandle("images", { create: true });
    const parts = safeRelativeImagePath(name).split("/");
    const fileName = parts.pop();
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function exportSelected() {
    const names = selectedExportNames();
    if (!names.length) {
      setStatus("请先勾选要导出的图片", 0);
      return;
    }
    if (!window.showDirectoryPicker) {
      setStatus("当前浏览器不支持选择目录导出，请使用 Chrome 或 Edge", 0);
      return;
    }
    try {
      const root = await window.showDirectoryPicker({ mode: "readwrite" });
      let sourceDirectory = null;
      const failed = [];
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        try {
          const blob = await readImageBlob(name, sourceDirectory);
          await writeImageBlob(root, name, blob);
        } catch (error) {
          if (!sourceDirectory) {
            sourceDirectory = await window.showDirectoryPicker({ mode: "read" });
            try {
              const blob = await readImageBlob(name, sourceDirectory);
              await writeImageBlob(root, name, blob);
            } catch (retryError) {
              failed.push(name);
            }
          } else {
            failed.push(name);
          }
        }
        setStatus("正在导出图片... " + (index + 1) + "/" + names.length, Math.round(((index + 1) / names.length) * 90));
      }
      const exportData = {};
      names.forEach(function copySelectedData(name) {
        if (!failed.includes(name)) exportData[name] = state.data[name];
      });
      const jsonHandle = await root.getFileHandle("annotations_det_edited.json", { create: true });
      const writable = await jsonHandle.createWritable();
      await writable.write(JSON.stringify(exportData, null, 2));
      await writable.close();
      setStatus(failed.length ? "导出完成，失败 " + failed.length + " 张图片" : "导出完成，共 " + names.length + " 张图片", 100);
    } catch (error) {
      if (error && error.name === "AbortError") {
        setStatus("已取消导出", 0);
      } else {
        setStatus("导出失败: " + (error.message || error), 0);
      }
    }
  }

  function formatJson() {
    try {
      els.jsonInput.value = JSON.stringify(JSON.parse(els.jsonInput.value), null, 2);
      setStatus("已格式化 JSON", 100);
    } catch (error) {
      setStatus("格式化失败: " + error.message, 0);
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

  els.copyJsonBtn.addEventListener("click", copyJson);
  els.downloadJsonBtn.addEventListener("click", downloadJson);
  els.exportSelectedBtn.addEventListener("click", exportSelected);
  els.jsonFileInput.addEventListener("change", function onchange(event) {
    readJsonFile(event.target.files[0]);
  });
  els.applyFiltersBtn.addEventListener("click", applyFilters);
  els.clearFiltersBtn.addEventListener("click", clearFilters);
  els.labelSelect.addEventListener("change", function onLabelSelectChange() {
    if (els.labelSelect.value) els.labelFilter.value = "";
  });
  els.labelFilter.addEventListener("input", function onLabelFilterInput() {
    if (els.labelFilter.value.trim()) els.labelSelect.value = "";
  });
  [els.imageFilter, els.labelFilter, els.widthMinFilter, els.widthMaxFilter, els.heightMinFilter, els.heightMaxFilter]
    .forEach(function bindFilterEnter(input) {
      input.addEventListener("keydown", function onfilterkeydown(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        applyFilters();
      });
    });
  els.imageList.addEventListener("click", handleImageListClick);
  els.imageList.addEventListener("change", function onImageSelectionChange(event) {
    const checkbox = event.target.closest ? event.target.closest("input.image-check") : null;
    if (!checkbox) return;
    const index = Number(checkbox.dataset.imageIndex);
    const name = state.filteredImageNames[index];
    if (typeof name === "string") toggleImageExportSelection(name, checkbox.checked);
  });
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
    setStatus("图片已加载: " + state.currentImage, 100);
    renderAll();
    preloadAdjacentImages();
  });
  els.mainImage.addEventListener("error", function onerror() {
    syncCanvasSize();
    renderOverlay();
    setStatus("图片加载失败，请检查 prefix: " + state.currentImage, 0);
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
  els.showAllBoxesBtn.addEventListener("click", showAllBoxes);
  els.keypointVisibilityBtn.addEventListener("click", function onkeypoints() {
    state.showKeypoints = !state.showKeypoints;
    renderKeypointVisibilityToggle();
    renderOverlay();
  });
  els.keypointLabelBtn.addEventListener("click", function onkeypointlabels() {
    state.showKeypointLabels = !state.showKeypointLabels;
    renderKeypointLabelToggle();
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
    applyImageAdjustments();
  });
  els.resetBrightnessBtn.addEventListener("click", function onresetbrightness() {
    state.imageBrightness = 100;
    renderSliderValues();
    applyImageAdjustments();
  });
  els.contrastRange.addEventListener("input", function oninput(event) {
    state.imageContrast = clampContrast(Number(event.target.value) || 100);
    renderSliderValues();
    applyImageAdjustments();
  });
  els.resetContrastBtn.addEventListener("click", function onresetcontrast() {
    state.imageContrast = 100;
    renderSliderValues();
    applyImageAdjustments();
  });
  els.addRectangleBtn.addEventListener("click", function addRectangle() {
    addObject("rectangle");
  });
  els.addQuadrilateralBtn.addEventListener("click", function addQuadrilateral() {
    addObject("quadrilateral");
  });
  els.deleteObjectBtn.addEventListener("click", deleteObject);
  els.addKeypointBtn.addEventListener("click", addKeypoint);
  els.applyObjectBtn.addEventListener("click", applyEditor);
  els.labelsEditor.addEventListener("change", applyEditor);
  els.keypointList.addEventListener("change", applyKeypointEditor);
  els.keypointList.addEventListener("click", function onkeypointaction(event) {
    const button = event.target.closest("[data-keypoint-action]");
    if (!button || button.dataset.keypointAction !== "delete") return;
    const row = button.closest("[data-keypoint-index]");
    if (row) deleteKeypoint(Number(row.dataset.keypointIndex));
  });
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
    if (placePendingKeypoint(coords.x, coords.y)) return;
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
  applyImageAdjustments();
})();
