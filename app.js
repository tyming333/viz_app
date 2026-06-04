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
    imageList: document.getElementById("imageList"),
    currentImageText: document.getElementById("currentImageText"),
    imageSelect: document.getElementById("imageSelect"),
    canvasShell: document.getElementById("canvasShell"),
    stage: document.getElementById("stage"),
    mainImage: document.getElementById("mainImage"),
    overlay: document.getElementById("overlay"),
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
    zoomOutBtn: document.getElementById("zoomOutBtn"),
    zoomInBtn: document.getElementById("zoomInBtn"),
    zoomText: document.getElementById("zoomText"),
    objectCount: document.getElementById("objectCount"),
    addObjectBtn: document.getElementById("addObjectBtn"),
    deleteObjectBtn: document.getElementById("deleteObjectBtn"),
    objectList: document.getElementById("objectList"),
    selectedBadge: document.getElementById("selectedBadge"),
    labelsEditor: document.getElementById("labelsEditor"),
    bboxGrid: document.getElementById("bboxGrid"),
    applyObjectBtn: document.getElementById("applyObjectBtn")
  };

  const state = {
    data: null,
    imageNames: [],
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
    viewFrame: 0,
    detailFrame: 0,
    overlayFrame: 0,
    overlayResumeTimer: 0,
    renderVersion: 0,
    suppressNextClick: false
  };

  const colors = ["#4ade80", "#38bdf8", "#facc15", "#fb7185", "#a78bfa", "#2dd4bf"];
  const pointNames = ["x1", "y1", "x2", "y2", "x3", "y3", "x4", "y4"];
  const imageButtons = new Map();
  const imageNameToIndex = new Map();
  const preloadImages = new Map();
  let activeImageButton = null;
  let activeObjectButton = null;

  function setProgress(percent) {
    els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
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
      normalized = `file:///${normalized}`;
    }
    if (!hasProtocol && !normalized.endsWith("/")) {
      normalized += "/";
    }
    if (hasProtocol && !normalized.endsWith("/")) {
      normalized += "/";
    }
    return normalized;
  }

  function imageUrl(name) {
    return normalizePrefix(els.prefixInput.value) + encodeURI(name).replace(/#/g, "%23");
  }

  function getObjects(name) {
    if (!state.data || !state.data[name] || !state.data[name].det) return [];
    return state.data[name].det.objects || [];
  }

  function validateData(data) {
    if (!data || Array.isArray(data) || typeof data !== "object") {
      throw new Error("JSON 根节点必须是图片名到标注内容的对象");
    }

    const names = Object.keys(data);
    let objectTotal = 0;
    names.forEach((name) => {
      const entry = data[name];
      const objects = entry && entry.det && entry.det.objects;
      if (!Array.isArray(objects)) {
        throw new Error(`${name} 缺少 det.objects 数组`);
      }
      objects.forEach((obj, index) => {
        if (!Array.isArray(obj.bbox) || obj.bbox.length !== 8) {
          throw new Error(`${name} 的 object ${index + 1} bbox 必须是 8 个数字`);
        }
        obj.bbox.forEach((value, coordIndex) => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`${name} 的 object ${index + 1} bbox[${coordIndex}] 不是有效数字`);
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
    });

    return { names, objectTotal };
  }

  function loadJson() {
    setStatus("解析 JSON...", 10);
    let parsed;
    try {
      parsed = JSON.parse(els.jsonInput.value);
      const result = validateData(parsed);
      state.data = parsed;
      state.imageNames = result.names;
      preloadImages.clear();
      const firstImage = state.imageNames[0] || "";
      state.currentImage = "";
      state.currentImageIndex = -1;
      state.selectedObjectIndex = -1;
      setStatus(`已加载 ${state.imageNames.length} 张图片，${result.objectTotal} 个 objects`, 55);
      renderImageControls();
      selectImage(firstImage);
      setStatus(`已加载 ${state.imageNames.length} 张图片，${result.objectTotal} 个 objects`, 100);
    } catch (err) {
      state.data = null;
      state.imageNames = [];
      preloadImages.clear();
      state.currentImage = "";
      state.currentImageIndex = -1;
      state.selectedObjectIndex = -1;
      setStatus(`加载失败：${err.message}`, 0);
      renderFull();
    }
  }

  function renderImageControls() {
    const filter = els.imageFilter.value.trim().toLowerCase();
    const visibleNames = state.imageNames.filter((name) => name.toLowerCase().includes(filter));

    els.imageCount.textContent = String(state.imageNames.length);
    els.imageSelect.innerHTML = "";
    imageButtons.clear();
    imageNameToIndex.clear();
    activeImageButton = null;
    const optionsFragment = document.createDocumentFragment();
    state.imageNames.forEach((name, index) => {
      imageNameToIndex.set(name, index);
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      optionsFragment.appendChild(option);
    });
    els.imageSelect.replaceChildren(optionsFragment);

    const listFragment = document.createDocumentFragment();
    visibleNames.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = name === state.currentImage ? "active" : "";
      button.dataset.imageName = name;
      button.textContent = name;
      button.title = name;
      imageButtons.set(name, button);
      if (name === state.currentImage) {
        activeImageButton = button;
      }
      listFragment.appendChild(button);
    });
    els.imageList.replaceChildren(listFragment);
    updateImageSelection();
  }

  function updateImageSelection() {
    els.currentImageText.value = state.currentImage;
    els.currentImageText.title = state.currentImage || "可选中复制当前图片名";
    els.imageSelect.selectedIndex = state.currentImageIndex;
    if (activeImageButton) {
      activeImageButton.classList.remove("active");
    }
    activeImageButton = imageButtons.get(state.currentImage) || null;
    if (activeImageButton) {
      activeImageButton.classList.add("active");
    }
    renderImageNavButtons();
  }

  function currentImageIndex() {
    return state.currentImageIndex;
  }

  function renderImageNavButtons() {
    const index = currentImageIndex();
    const hasImage = index >= 0;
    els.prevImageBtn.hidden = !hasImage;
    els.nextImageBtn.hidden = !hasImage;
    els.prevImageBtn.disabled = !hasImage || index <= 0;
    els.nextImageBtn.disabled = !hasImage || index >= state.imageNames.length - 1;
  }

  function selectAdjacentImage(step) {
    const index = currentImageIndex();
    if (index < 0) return;
    const nextIndex = Math.max(0, Math.min(state.imageNames.length - 1, index + step));
    if (nextIndex === index) return;
    selectImage(state.imageNames[nextIndex]);
  }

  function shouldIgnoreImageShortcut(event) {
    const target = event.target;
    if (!target || !target.tagName) return false;
    if (target.isContentEditable) return true;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  }

  function selectImage(name) {
    const nextName = name || "";
    if (nextName && nextName === state.currentImage) {
      updateImageSelection();
      return;
    }
    cancelDeferredRender();
    const nextIndex = nextName ? imageNameToIndex.get(nextName) : -1;
    state.currentImage = nextName;
    state.currentImageIndex = typeof nextIndex === "number" ? nextIndex : -1;
    state.selectedObjectIndex = -1;
    updateImageSelection();
    if (state.currentImage) {
      clearOverlay();
      els.mainImage.src = imageUrl(state.currentImage);
      els.mainImage.alt = state.currentImage;
      els.emptyState.style.display = "none";
      setStatus(`加载图片：${state.currentImage}`, 70);
    } else {
      els.mainImage.removeAttribute("src");
      els.emptyState.style.display = "grid";
      clearOverlay();
      renderImageChrome();
      return;
    }
    renderSwitchChrome();
  }

  function renderAll() {
    renderObjects();
    renderEditor();
    renderOverlay();
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    applyOverlayCssVars();
    applyZoom();
  }

  function renderImageChrome() {
    renderObjects();
    renderEditor();
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    applyOverlayCssVars();
    applyZoom();
  }

  function renderSwitchChrome() {
    renderImageNavButtons();
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    applyOverlayCssVars();
    applyZoom();
  }

  function renderFull() {
    renderImageControls();
    renderAll();
  }

  function clearOverlay() {
    els.overlay.innerHTML = "";
    els.overlay.setAttribute("width", "0");
    els.overlay.setAttribute("height", "0");
    els.overlay.setAttribute("viewBox", "0 0 1 1");
  }

  function cancelDeferredRender() {
    state.renderVersion += 1;
    if (state.detailFrame) {
      window.cancelAnimationFrame(state.detailFrame);
      window.clearTimeout(state.detailFrame);
      state.detailFrame = 0;
    }
    if (state.overlayFrame) {
      window.cancelAnimationFrame(state.overlayFrame);
      window.clearTimeout(state.overlayFrame);
      state.overlayFrame = 0;
    }
  }

  function renderImageDetailsDeferred() {
    const version = state.renderVersion;
    state.detailFrame = window.setTimeout(() => {
      state.detailFrame = 0;
      if (version !== state.renderVersion) return;
      renderObjects();
      renderEditor();
      renderImageNavButtons();
      renderBoxVisibilityToggle();
      renderFillToggle();
      renderSliderValues();
      applyOverlayCssVars();

      state.overlayFrame = window.setTimeout(() => {
        state.overlayFrame = 0;
        if (version !== state.renderVersion) return;
        renderOverlay();
        applyZoom();
      }, 80);
    }, 60);
  }

  function preloadAdjacentImages() {
    const index = currentImageIndex();
    if (index < 0) return;
    [index - 3, index - 2, index - 1, index + 1, index + 2, index + 3].forEach((nextIndex) => {
      const name = state.imageNames[nextIndex];
      if (!name || preloadImages.has(name)) return;
      const image = new Image();
      const entry = { image, decoded: false };
      preloadImages.set(name, entry);
      image.onload = () => {
        if (!image.decode) {
          entry.decoded = true;
          return;
        }
        image.decode()
          .then(() => {
            entry.decoded = true;
          })
          .catch(() => {
            entry.decoded = true;
          });
      };
      image.src = imageUrl(name);
    });
    trimPreloadCache();
  }

  function trimPreloadCache() {
    const index = currentImageIndex();
    if (index < 0 || preloadImages.size <= 12) return;
    const keep = new Set();
    for (let offset = -4; offset <= 4; offset += 1) {
      const name = state.imageNames[index + offset];
      if (name) keep.add(name);
    }
    preloadImages.forEach((entry, name) => {
      if (!keep.has(name)) {
        preloadImages.delete(name);
      }
    });
  }

  function formatSliderValue(value) {
    return Number.isInteger(value) ? String(value) : String(value.toFixed(1));
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

  function applyOverlayCssVars() {
    const scale = getOverlayScale();
    els.overlay.style.setProperty("--box-stroke-width", String(state.boxStrokeWidth));
    els.overlay.style.setProperty("--label-font-size", `${getRenderedLabelFontSize() / scale}px`);
    els.overlay.style.setProperty("--label-stroke-width", `${getRenderedLabelStrokeWidth() / scale}px`);
  }

  function renderSliderValues() {
    els.strokeWidthRange.value = String(state.boxStrokeWidth);
    els.strokeWidthText.textContent = formatSliderValue(state.boxStrokeWidth);
    els.labelSizeRange.value = String(state.labelFontSize);
    els.labelSizeText.textContent = String(state.labelFontSize);
  }

  function renderBoxVisibilityToggle() {
    els.boxVisibilityBtn.classList.toggle("active", state.showBoxes);
    els.boxVisibilityBtn.setAttribute("aria-pressed", String(state.showBoxes));
    els.boxVisibilityBtn.title = state.showBoxes ? "隐藏所有框" : "显示所有框";
    els.overlay.style.display = state.showBoxes ? "" : "none";
  }

  function renderFillToggle() {
    els.fillToggleBtn.classList.toggle("active", state.showBoxFill);
    els.fillToggleBtn.setAttribute("aria-pressed", String(state.showBoxFill));
  }

  function updateOverlayStyle() {
    renderBoxVisibilityToggle();
    renderFillToggle();
    renderSliderValues();
    applyOverlayCssVars();
    updateOverlaySelection();
  }

  function updateOverlayMetrics() {
    renderSliderValues();
    applyOverlayCssVars();
  }

  function renderObjects() {
    const objects = getObjects(state.currentImage);
    els.objectCount.textContent = String(objects.length);
    activeObjectButton = null;
    const fragment = document.createDocumentFragment();
    objects.forEach((obj, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === state.selectedObjectIndex ? "active" : "";
      button.dataset.objectIndex = String(index);
      const label = Array.isArray(obj.labels) && obj.labels.length ? obj.labels.join(" / ") : "未命名";
      button.textContent = `${index + 1}. ${label}`;
      button.title = button.textContent;
      if (index === state.selectedObjectIndex) {
        activeObjectButton = button;
      }
      fragment.appendChild(button);
    });
    els.objectList.replaceChildren(fragment);
  }

  function updateObjectSelection() {
    if (activeObjectButton) {
      activeObjectButton.classList.remove("active");
    }
    activeObjectButton = els.objectList.querySelector(`button[data-object-index="${state.selectedObjectIndex}"]`);
    if (activeObjectButton) {
      activeObjectButton.classList.add("active");
    }
  }

  function renderEditor() {
    const obj = getObjects(state.currentImage)[state.selectedObjectIndex];
    els.selectedBadge.textContent = obj ? `#${state.selectedObjectIndex + 1}` : "未选中";
    els.labelsEditor.disabled = !obj;
    els.applyObjectBtn.disabled = !obj;
    els.deleteObjectBtn.disabled = !obj;
    els.labelsEditor.value = obj ? (obj.labels || []).join("\n") : "";

    els.bboxGrid.innerHTML = "";
    pointNames.forEach((name, index) => {
      const label = document.createElement("label");
      const span = document.createElement("span");
      const input = document.createElement("input");
      span.textContent = name;
      input.type = "number";
      input.step = "1";
      input.value = obj ? obj.bbox[index] : "";
      input.disabled = !obj;
      input.dataset.coordIndex = String(index);
      input.addEventListener("change", applyEditor);
      label.appendChild(span);
      label.appendChild(input);
      els.bboxGrid.appendChild(label);
    });
  }

  function selectObject(index) {
    state.selectedObjectIndex = index;
    updateObjectSelection();
    renderEditor();
    updateOverlaySelection();
    scrollSelectedObjectIntoView();
  }

  function scrollSelectedObjectIntoView() {
    const button = els.objectList.querySelector(`button[data-object-index="${state.selectedObjectIndex}"]`);
    if (!button) return;
    button.scrollIntoView({ block: "center" });
  }

  function updateEditorBboxInputs() {
    const obj = getObjects(state.currentImage)[state.selectedObjectIndex];
    if (!obj) return;
    const inputs = els.bboxGrid.querySelectorAll("input");
    inputs.forEach((input, index) => {
      input.value = obj.bbox[index];
    });
  }

  function updateOverlaySelection() {
    const groups = els.overlay.querySelectorAll("g[data-object-index]");
    groups.forEach((group) => {
      const index = Number(group.dataset.objectIndex);
      const isActive = index === state.selectedObjectIndex;
      const polygon = group.querySelector("[data-role='polygon']");
      if (polygon) {
        polygon.setAttribute("class", isActive ? "poly active" : "poly");
        polygon.style.stroke = isActive ? "#facc15" : colors[index % colors.length];
        polygon.style.fill = state.showBoxFill ? "" : "transparent";
      }
    });
    renderHandles();
  }

  function updateOverlayObject(index) {
    const obj = getObjects(state.currentImage)[index];
    const group = els.overlay.querySelector(`g[data-object-index="${index}"]`);
    if (!obj || !group) return;

    const points = bboxToPoints(obj.bbox);
    const polygon = group.querySelector("[data-role='polygon']");
    if (polygon) {
      polygon.setAttribute("points", points.map((p) => p.join(",")).join(" "));
    }

    const text = group.querySelector("[data-role='label']");
    if (text) {
      const minX = Math.min(points[0][0], points[1][0], points[2][0], points[3][0]);
      const minY = Math.min(points[0][1], points[1][1], points[2][1], points[3][1]);
      text.setAttribute("x", String(minX));
      text.setAttribute("y", String(Math.max(16, minY - 8)));
    }

    updateSelectedHandles(index);
  }

  function bboxToPoints(bbox) {
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
      [bbox[4], bbox[5]],
      [bbox[6], bbox[7]]
    ];
  }

  function renderOverlay() {
    const image = els.mainImage;
    const objects = getObjects(state.currentImage);
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    els.overlay.innerHTML = "";
    els.overlay.setAttribute("width", String(width));
    els.overlay.setAttribute("height", String(height));
    els.overlay.setAttribute("viewBox", `0 0 ${width || 1} ${height || 1}`);
    els.stage.style.width = width ? `${width}px` : "100%";
    els.stage.style.height = height ? `${height}px` : "100%";

    if (!state.currentImage || !width || !height) return;

    const fragment = document.createDocumentFragment();
    objects.forEach((obj, index) => {
      const points = bboxToPoints(obj.bbox);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.dataset.objectIndex = String(index);
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const color = colors[index % colors.length];
      polygon.setAttribute("points", points.map((p) => p.join(",")).join(" "));
      polygon.setAttribute("class", index === state.selectedObjectIndex ? "poly active" : "poly");
      polygon.dataset.role = "polygon";
      polygon.style.stroke = index === state.selectedObjectIndex ? "#facc15" : color;
      polygon.style.fill = state.showBoxFill ? "" : "transparent";
      polygon.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        selectObject(index);
      });
      group.appendChild(polygon);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const labelText = obj.labels && obj.labels.length ? obj.labels[0] : `object ${index + 1}`;
      const minX = Math.min(points[0][0], points[1][0], points[2][0], points[3][0]);
      const minY = Math.min(points[0][1], points[1][1], points[2][1], points[3][1]);
      text.setAttribute("x", String(minX));
      text.setAttribute("y", String(Math.max(16, minY - 8)));
      text.setAttribute("class", "box-label");
      text.dataset.role = "label";
      text.textContent = labelText;
      group.appendChild(text);

      fragment.appendChild(group);
    });
    els.overlay.appendChild(fragment);
    renderHandles();
  }

  function removeHandles() {
    const handles = els.overlay.querySelector("[data-role='handles']");
    if (handles) {
      handles.remove();
    }
  }

  function renderHandles() {
    removeHandles();
    const obj = getObjects(state.currentImage)[state.selectedObjectIndex];
    if (!obj || !els.mainImage.naturalWidth) return;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset.role = "handles";
    bboxToPoints(obj.bbox).forEach((point, pointIndex) => {
      const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      handle.setAttribute("cx", String(point[0]));
      handle.setAttribute("cy", String(point[1]));
      handle.setAttribute("r", "6");
      handle.setAttribute("class", "handle");
      handle.dataset.role = "handle";
      handle.dataset.pointIndex = String(pointIndex);
      handle.addEventListener("pointerdown", (event) => startDrag(event, state.selectedObjectIndex, pointIndex));
      group.appendChild(handle);
    });
    els.overlay.appendChild(group);
  }

  function updateSelectedHandles(objectIndex) {
    if (objectIndex !== state.selectedObjectIndex) return;
    const group = els.overlay.querySelector("[data-role='handles']");
    const obj = getObjects(state.currentImage)[state.selectedObjectIndex];
    if (!group || !obj) {
      renderHandles();
      return;
    }
    const points = bboxToPoints(obj.bbox);
    group.querySelectorAll("[data-role='handle']").forEach((handle) => {
      const pointIndex = Number(handle.dataset.pointIndex);
      const point = points[pointIndex];
      handle.setAttribute("cx", String(point[0]));
      handle.setAttribute("cy", String(point[1]));
    });
  }

  function startDrag(event, objectIndex, pointIndex) {
    event.preventDefault();
    event.stopPropagation();
    if (state.selectedObjectIndex !== objectIndex) {
      selectObject(objectIndex);
    }
    state.drag = { objectIndex, pointIndex };
    els.overlay.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!state.drag) return;
    const obj = getObjects(state.currentImage)[state.drag.objectIndex];
    if (!obj) return;
    const rect = els.canvasShell.getBoundingClientRect();
    const x = (event.clientX - rect.left - state.panX) / state.zoom;
    const y = (event.clientY - rect.top - state.panY) / state.zoom;
    const base = state.drag.pointIndex * 2;
    obj.bbox[base] = Math.round(x);
    obj.bbox[base + 1] = Math.round(y);
    updateOverlayObject(state.drag.objectIndex);
    updateEditorBboxInputs();
  }

  function endDrag() {
    state.drag = null;
  }

  function clampZoom(value) {
    return Math.max(0.1, Math.min(4, value));
  }

  function applyEditor() {
    const obj = getObjects(state.currentImage)[state.selectedObjectIndex];
    if (!obj) return;
    obj.labels = els.labelsEditor.value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

    const inputs = Array.from(els.bboxGrid.querySelectorAll("input"));
    const next = inputs.map((input) => Number(input.value));
    if (next.length !== 8 || next.some((value) => !Number.isFinite(value))) {
      setStatus("bbox 必须保持 8 个有效数字", 0);
      return;
    }
    obj.bbox = next;
    setStatus("已应用修改", 100);
    renderAll();
  }

  function addObject() {
    if (!state.currentImage || !state.data) return;
    const image = els.mainImage;
    const width = image.naturalWidth || 200;
    const height = image.naturalHeight || 160;
    const left = Math.round(width * 0.35);
    const top = Math.round(height * 0.35);
    const right = Math.round(width * 0.65);
    const bottom = Math.round(height * 0.65);
    const objects = getObjects(state.currentImage);
    objects.push({
      labels: ["new_object"],
      bbox: [left, top, right, top, right, bottom, left, bottom],
      attrs: {}
    });
    state.selectedObjectIndex = objects.length - 1;
    setStatus("已新增 object", 100);
    renderAll();
  }

  function deleteObject() {
    const objects = getObjects(state.currentImage);
    if (state.selectedObjectIndex < 0 || state.selectedObjectIndex >= objects.length) return;
    objects.splice(state.selectedObjectIndex, 1);
    state.selectedObjectIndex = Math.min(state.selectedObjectIndex, objects.length - 1);
    setStatus("已删除选中 object", 100);
    renderAll();
  }

  function suspendOverlayForViewChange() {
    if (!state.showBoxes) return;
    els.overlay.classList.add("is-view-changing");
    if (state.overlayResumeTimer) {
      window.clearTimeout(state.overlayResumeTimer);
    }
    state.overlayResumeTimer = window.setTimeout(() => {
      state.overlayResumeTimer = 0;
      els.overlay.classList.remove("is-view-changing");
    }, 120);
  }

  function applyZoom(suspendOverlay) {
    if (suspendOverlay) {
      suspendOverlayForViewChange();
    }
    state.zoom = clampZoom(state.zoom);
    if (state.viewFrame) return;
    state.viewFrame = window.requestAnimationFrame(() => {
      state.viewFrame = 0;
      applyViewTransform();
    });
  }

  function applyViewTransform() {
    els.stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    els.zoomText.textContent = `${Math.round(state.zoom * 100)}%`;
    applyOverlayCssVars();
  }

  function zoomAt(clientX, clientY, nextZoom, options) {
    const oldZoom = state.zoom;
    const newZoom = clampZoom(nextZoom);
    if (newZoom === oldZoom) return;

    const shell = els.canvasShell;
    const rect = shell.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const imageX = (offsetX - state.panX) / oldZoom;
    const imageY = (offsetY - state.panY) / oldZoom;

    state.zoom = newZoom;
    state.panX = offsetX - imageX * newZoom;
    state.panY = offsetY - imageY * newZoom;
    applyZoom(options && options.suspendOverlay);
  }

  function wheelZoom(event) {
    if (!state.currentImage || !els.mainImage.naturalWidth) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, state.zoom * factor, { suspendOverlay: true });
  }

  function startPan(event) {
    if (event.button !== 0 || state.drag || !state.currentImage) return;
    if (event.target.classList && event.target.classList.contains("handle")) return;
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
    if (!state.pan) return;
    const dx = event.clientX - state.pan.x;
    const dy = event.clientY - state.pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      state.pan.moved = true;
      state.suppressNextClick = true;
    }
    state.panX = state.pan.left + dx;
    state.panY = state.pan.top + dy;
    applyZoom(true);
  }

  function endPan() {
    if (!state.pan) return;
    state.pan = null;
    els.canvasShell.classList.remove("is-panning");
    window.setTimeout(() => {
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

  function exportText() {
    if (!state.data) return "";
    return JSON.stringify(state.data, null, 2);
  }

  async function copyJson() {
    const text = exportText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已复制 JSON", 100);
    } catch (err) {
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

  function formatJson() {
    try {
      els.jsonInput.value = JSON.stringify(JSON.parse(els.jsonInput.value), null, 2);
      setStatus("已格式化 JSON", 100);
    } catch (err) {
      setStatus(`格式化失败：${err.message}`, 0);
    }
  }

  function readJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        setStatus("读取 JSON 文件...", Math.round((event.loaded / event.total) * 50));
      }
    };
    reader.onload = () => {
      els.jsonInput.value = String(reader.result || "");
      setStatus("JSON 文件读取完成", 60);
      loadJson();
    };
    reader.onerror = () => setStatus("JSON 文件读取失败", 0);
    reader.readAsText(file, "utf-8");
  }

  function stopPointerBubble(event) {
    event.stopPropagation();
  }

  els.loadBtn.addEventListener("click", loadJson);
  els.formatBtn.addEventListener("click", formatJson);
  els.copyJsonBtn.addEventListener("click", copyJson);
  els.downloadJsonBtn.addEventListener("click", downloadJson);
  els.jsonFileInput.addEventListener("change", (event) => readJsonFile(event.target.files[0]));
  els.imageFilter.addEventListener("input", renderImageControls);
  els.imageList.addEventListener("click", (event) => {
    const button = event.target.closest ? event.target.closest("button[data-image-name]") : null;
    if (!button || !els.imageList.contains(button)) return;
    selectImage(button.dataset.imageName);
  });
  els.imageSelect.addEventListener("change", (event) => selectImage(event.target.value));
  els.prevImageBtn.addEventListener("pointerdown", stopPointerBubble);
  els.nextImageBtn.addEventListener("pointerdown", stopPointerBubble);
  els.prevImageBtn.addEventListener("click", () => selectAdjacentImage(-1));
  els.nextImageBtn.addEventListener("click", () => selectAdjacentImage(1));
  els.mainImage.addEventListener("load", () => {
    resetView();
    renderSwitchChrome();
    setStatus(`图片已加载：${state.currentImage}`, 100);
    renderImageDetailsDeferred();
    preloadAdjacentImages();
  });
  els.mainImage.addEventListener("error", () => {
    renderOverlay();
    setStatus(`图片加载失败，请检查 prefix：${state.currentImage}`, 0);
  });
  els.resetViewBtn.addEventListener("click", resetView);
  els.boxVisibilityBtn.addEventListener("click", () => {
    state.showBoxes = !state.showBoxes;
    updateOverlayStyle();
  });
  els.fillToggleBtn.addEventListener("click", () => {
    state.showBoxFill = !state.showBoxFill;
    updateOverlayStyle();
  });
  els.strokeWidthRange.addEventListener("input", (event) => {
    state.boxStrokeWidth = Number(event.target.value) || 3;
    updateOverlayMetrics();
  });
  els.labelSizeRange.addEventListener("input", (event) => {
    state.labelFontSize = Number(event.target.value) || 13;
    updateOverlayMetrics();
  });
  els.zoomOutBtn.addEventListener("click", () => {
    zoomAt(
      els.canvasShell.getBoundingClientRect().left + els.canvasShell.clientWidth / 2,
      els.canvasShell.getBoundingClientRect().top + els.canvasShell.clientHeight / 2,
      state.zoom - 0.1,
      { suspendOverlay: true }
    );
  });
  els.zoomInBtn.addEventListener("click", () => {
    zoomAt(
      els.canvasShell.getBoundingClientRect().left + els.canvasShell.clientWidth / 2,
      els.canvasShell.getBoundingClientRect().top + els.canvasShell.clientHeight / 2,
      state.zoom + 0.1,
      { suspendOverlay: true }
    );
  });
  els.addObjectBtn.addEventListener("click", addObject);
  els.deleteObjectBtn.addEventListener("click", deleteObject);
  els.objectList.addEventListener("click", (event) => {
    const button = event.target.closest ? event.target.closest("button[data-object-index]") : null;
    if (!button || !els.objectList.contains(button)) return;
    selectObject(Number(button.dataset.objectIndex));
  });
  els.applyObjectBtn.addEventListener("click", applyEditor);
  els.labelsEditor.addEventListener("change", applyEditor);
  els.canvasShell.addEventListener("wheel", wheelZoom, { passive: false });
  els.canvasShell.addEventListener("pointerdown", startPan);
  els.canvasShell.addEventListener("pointermove", movePan);
  els.canvasShell.addEventListener("pointerup", endPan);
  els.canvasShell.addEventListener("pointercancel", endPan);
  els.overlay.addEventListener("pointermove", moveDrag);
  els.overlay.addEventListener("pointerup", endDrag);
  els.overlay.addEventListener("pointercancel", endDrag);
  els.overlay.addEventListener("click", (event) => {
    if (state.suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  document.addEventListener("keydown", (event) => {
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

  renderFull();
})();
