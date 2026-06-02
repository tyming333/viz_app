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
    imageSelect: document.getElementById("imageSelect"),
    canvasShell: document.getElementById("canvasShell"),
    stage: document.getElementById("stage"),
    mainImage: document.getElementById("mainImage"),
    overlay: document.getElementById("overlay"),
    emptyState: document.getElementById("emptyState"),
    resetViewBtn: document.getElementById("resetViewBtn"),
    fillToggleBtn: document.getElementById("fillToggleBtn"),
    strokeWidthSelect: document.getElementById("strokeWidthSelect"),
    labelSizeSelect: document.getElementById("labelSizeSelect"),
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
    selectedObjectIndex: -1,
    zoom: 1,
    panX: 0,
    panY: 0,
    drag: null,
    pan: null,
    showBoxFill: true,
    boxStrokeWidth: 3,
    labelFontSize: 15,
    viewFrame: 0,
    suppressNextClick: false
  };

  const colors = ["#4ade80", "#38bdf8", "#facc15", "#fb7185", "#a78bfa", "#2dd4bf"];
  const pointNames = ["x1", "y1", "x2", "y2", "x3", "y3", "x4", "y4"];

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
      state.currentImage = state.imageNames[0] || "";
      state.selectedObjectIndex = -1;
      setStatus(`已加载 ${state.imageNames.length} 张图片，${result.objectTotal} 个 objects`, 55);
      renderImageControls();
      selectImage(state.currentImage);
      setStatus(`已加载 ${state.imageNames.length} 张图片，${result.objectTotal} 个 objects`, 100);
    } catch (err) {
      state.data = null;
      state.imageNames = [];
      state.currentImage = "";
      state.selectedObjectIndex = -1;
      setStatus(`加载失败：${err.message}`, 0);
      renderAll();
    }
  }

  function renderImageControls() {
    const filter = els.imageFilter.value.trim().toLowerCase();
    const visibleNames = state.imageNames.filter((name) => name.toLowerCase().includes(filter));

    els.imageCount.textContent = String(state.imageNames.length);
    els.imageSelect.innerHTML = "";
    state.imageNames.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      els.imageSelect.appendChild(option);
    });
    els.imageSelect.value = state.currentImage;

    els.imageList.innerHTML = "";
    visibleNames.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = name === state.currentImage ? "active" : "";
      button.textContent = name;
      button.title = name;
      button.addEventListener("click", () => selectImage(name));
      els.imageList.appendChild(button);
    });
  }

  function selectImage(name) {
    state.currentImage = name || "";
    state.selectedObjectIndex = -1;
    if (state.currentImage) {
      els.imageSelect.value = state.currentImage;
      els.mainImage.src = imageUrl(state.currentImage);
      els.mainImage.alt = state.currentImage;
      els.emptyState.style.display = "none";
      setStatus(`加载图片：${state.currentImage}`, 70);
    } else {
      els.mainImage.removeAttribute("src");
      els.emptyState.style.display = "grid";
    }
    renderAll();
  }

  function renderAll() {
    renderImageControls();
    renderObjects();
    renderEditor();
    renderOverlay();
    renderFillToggle();
    applyZoom();
  }

  function renderFillToggle() {
    els.fillToggleBtn.classList.toggle("active", state.showBoxFill);
    els.fillToggleBtn.setAttribute("aria-pressed", String(state.showBoxFill));
  }

  function updateOverlayStyle() {
    renderFillToggle();
    updateOverlaySelection();
  }

  function renderObjects() {
    const objects = getObjects(state.currentImage);
    els.objectCount.textContent = String(objects.length);
    els.objectList.innerHTML = "";
    objects.forEach((obj, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === state.selectedObjectIndex ? "active" : "";
      button.dataset.objectIndex = String(index);
      const label = Array.isArray(obj.labels) && obj.labels.length ? obj.labels.join(" / ") : "未命名";
      button.textContent = `${index + 1}. ${label}`;
      button.title = button.textContent;
      button.addEventListener("click", () => {
        selectObject(index);
      });
      els.objectList.appendChild(button);
    });
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
    renderObjects();
    renderEditor();
    updateOverlaySelection();
    scrollSelectedObjectIntoView();
  }

  function scrollSelectedObjectIntoView() {
    const button = els.objectList.querySelector(`button[data-object-index="${state.selectedObjectIndex}"]`);
    if (!button) return;
    button.scrollIntoView({ block: "nearest" });
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
        polygon.style.strokeWidth = String(state.boxStrokeWidth);
        polygon.style.fill = state.showBoxFill ? "" : "transparent";
      }
      const text = group.querySelector("[data-role='label']");
      if (text) {
        text.style.fontSize = `${state.labelFontSize}px`;
        text.style.strokeWidth = `${Math.max(2, state.labelFontSize * 0.27)}px`;
      }
      group.querySelectorAll("[data-role='handle']").forEach((handle) => {
        handle.style.display = isActive ? "block" : "none";
      });
    });
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

    group.querySelectorAll("[data-role='handle']").forEach((handle) => {
      const pointIndex = Number(handle.dataset.pointIndex);
      const point = points[pointIndex];
      handle.setAttribute("cx", String(point[0]));
      handle.setAttribute("cy", String(point[1]));
    });
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
      polygon.style.strokeWidth = String(state.boxStrokeWidth);
      polygon.style.fill = state.showBoxFill ? "" : "transparent";
      polygon.addEventListener("click", () => {
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
      text.style.fontSize = `${state.labelFontSize}px`;
      text.style.strokeWidth = `${Math.max(2, state.labelFontSize * 0.27)}px`;
      text.textContent = labelText;
      group.appendChild(text);

      points.forEach((point, pointIndex) => {
        const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handle.setAttribute("cx", String(point[0]));
        handle.setAttribute("cy", String(point[1]));
        handle.setAttribute("r", "6");
        handle.setAttribute("class", "handle");
        handle.dataset.role = "handle";
        handle.dataset.pointIndex = String(pointIndex);
        handle.style.display = index === state.selectedObjectIndex ? "block" : "none";
        handle.addEventListener("pointerdown", (event) => startDrag(event, index, pointIndex));
        group.appendChild(handle);
      });

      fragment.appendChild(group);
    });
    els.overlay.appendChild(fragment);
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

  function applyZoom() {
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
  }

  function zoomAt(clientX, clientY, nextZoom) {
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
    applyZoom();
  }

  function wheelZoom(event) {
    if (!state.currentImage || !els.mainImage.naturalWidth) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, state.zoom * factor);
  }

  function startPan(event) {
    if (event.button !== 0 || state.drag || !state.currentImage) return;
    if (event.target.classList && event.target.classList.contains("handle")) return;
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
    applyZoom();
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

  els.loadBtn.addEventListener("click", loadJson);
  els.formatBtn.addEventListener("click", formatJson);
  els.copyJsonBtn.addEventListener("click", copyJson);
  els.downloadJsonBtn.addEventListener("click", downloadJson);
  els.jsonFileInput.addEventListener("change", (event) => readJsonFile(event.target.files[0]));
  els.imageFilter.addEventListener("input", renderImageControls);
  els.imageSelect.addEventListener("change", (event) => selectImage(event.target.value));
  els.mainImage.addEventListener("load", () => {
    resetView();
    renderAll();
    setStatus(`图片已加载：${state.currentImage}`, 100);
  });
  els.mainImage.addEventListener("error", () => {
    renderOverlay();
    setStatus(`图片加载失败，请检查 prefix：${state.currentImage}`, 0);
  });
  els.resetViewBtn.addEventListener("click", resetView);
  els.fillToggleBtn.addEventListener("click", () => {
    state.showBoxFill = !state.showBoxFill;
    updateOverlayStyle();
  });
  els.strokeWidthSelect.addEventListener("change", (event) => {
    state.boxStrokeWidth = Number(event.target.value) || 3;
    updateOverlayStyle();
  });
  els.labelSizeSelect.addEventListener("change", (event) => {
    state.labelFontSize = Number(event.target.value) || 15;
    updateOverlayStyle();
  });
  els.zoomOutBtn.addEventListener("click", () => {
    zoomAt(
      els.canvasShell.getBoundingClientRect().left + els.canvasShell.clientWidth / 2,
      els.canvasShell.getBoundingClientRect().top + els.canvasShell.clientHeight / 2,
      state.zoom - 0.1
    );
  });
  els.zoomInBtn.addEventListener("click", () => {
    zoomAt(
      els.canvasShell.getBoundingClientRect().left + els.canvasShell.clientWidth / 2,
      els.canvasShell.getBoundingClientRect().top + els.canvasShell.clientHeight / 2,
      state.zoom + 0.1
    );
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
  els.overlay.addEventListener("pointermove", moveDrag);
  els.overlay.addEventListener("pointerup", endDrag);
  els.overlay.addEventListener("pointercancel", endDrag);
  els.overlay.addEventListener("click", (event) => {
    if (state.suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  renderAll();
})();
