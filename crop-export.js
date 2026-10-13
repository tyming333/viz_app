(function () {
  "use strict";
  window.attachCropExport = function (viewer) {
    const storageKey = "viz-app.crop-padding";
    let padding = { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      for (const key of Object.keys(padding)) {
        if (Number.isFinite(saved?.[key]) && saved[key] >= 0) padding[key] = saved[key];
      }
    } catch (_) {}
    const menu = document.createElement("div");
    menu.id = "cropExportMenu";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "裁剪导出配置");
    Object.assign(menu.style, { position: "fixed", zIndex: "1000", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "6px", padding: "12px", boxShadow: "0 4px 20px #0003", width: "240px", maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)", overflowY: "auto" });
    const title = document.createElement("strong");
    title.textContent = "裁剪导出 · 扩框比例";
    menu.append(title);
    const fields = document.createElement("div");
    Object.assign(fields.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "10px 0" });
    const inputs = {};
    for (const [key, name] of Object.entries({ top: "上（按高度）", bottom: "下（按高度）", left: "左（按宽度）", right: "右（按宽度）" })) {
      const label = document.createElement("label"), input = document.createElement("input");
      label.textContent = name;
      input.type = "number";
      input.min = "0";
      input.step = "0.05";
      input.value = String(padding[key]);
      input.dataset.cropSide = key;
      input.setAttribute("aria-label", name + "扩框比例");
      inputs[key] = input;
      label.append(input);
      fields.append(label);
      input.addEventListener("change", savePadding);
    }
    menu.append(fields);
    const output = document.createElement("p");
    output.setAttribute("role", "status");
    output.style.margin = "6px 0";
    const button = document.createElement("button");
    button.id = "cropExportBtn";
    button.textContent = "裁剪导出 PNG";
    button.type = "button";
    const fallback = document.createElement("div");
    fallback.id = "cropOriginalFallback";
    fallback.hidden = true;
    const pathLabel = document.createElement("label"), pathInput = document.createElement("input");
    pathInput.id = "cropOriginalPath";
    pathInput.type = "text";
    pathInput.readOnly = true;
    pathInput.setAttribute("aria-label", "当前原图路径");
    pathInput.style.width = "100%";
    pathLabel.textContent = "当前原图路径";
    pathLabel.append(pathInput);
    const copyButton = document.createElement("button"), fileButton = document.createElement("button"), fileInput = document.createElement("input");
    copyButton.id = "cropCopyPathBtn";
    copyButton.type = fileButton.type = "button";
    copyButton.textContent = "复制路径";
    fileButton.id = "cropChooseOriginalBtn";
    fileButton.textContent = "选择原图后裁剪";
    fileInput.id = "cropOriginalFile";
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    const help = document.createElement("p");
    fallback.append(pathLabel, copyButton, fileButton, fileInput, help);
    menu.append(button, fallback, output);
    document.body.append(menu);
    function positionMenu(x, y) {
      menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + "px";
      menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px";
    }
    const confirmedFiles = new Map();
    let choosingTarget = null;
    function updatePath(selected) {
      const localPath = window.ViewerCore.getLocalImagePath(selected.source);
      pathInput.value = localPath || selected.image;
      pathInput.title = pathInput.value;
      copyButton.hidden = !localPath;
      help.textContent = localPath
        ? "选择时会尝试复制路径。在文件窗口的“文件名”中粘贴后确认；也可手动复制上方路径。"
        : "请在文件窗口中选择当前图层对应的原图。";
    }
    async function copyPath() {
      try {
        await navigator.clipboard.writeText(pathInput.value);
        output.textContent = "路径已复制，在文件窗口中粘贴后确认。";
        return true;
      } catch (_) {
        pathInput.focus();
        pathInput.select();
        try {
          if (document.execCommand("copy")) {
            output.textContent = "路径已复制，在文件窗口中粘贴后确认。";
            return true;
          }
        } catch (_) {}
        output.textContent = "路径已选中，请按 Ctrl+C 复制，再选择原图。";
        return false;
      }
    }
    copyButton.addEventListener("click", copyPath);
    fileButton.addEventListener("click", async () => {
      if (!target || button.disabled) return;
      const selected = target;
      if (window.ViewerCore.getLocalImagePath(selected.source)) {
        await copyPath();
      }
      if (target !== selected) return;
      choosingTarget = selected;
      fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0], selected = choosingTarget;
      fileInput.value = "";
      choosingTarget = null;
      if (!file || !selected) return;
      button.disabled = fileButton.disabled = true;
      let original, accepted = false;
      try {
        if (target !== selected || selected.image !== viewer.imageName() || selected.source !== document.getElementById("mainImage").currentSrc) {
          throw new Error("当前图层已切换，请重新选择原图");
        }
        const sourceName = decodeURIComponent(new URL(selected.source, location.href).pathname.split("/").pop());
        if (sourceName && file.name.normalize("NFC").toLocaleLowerCase() !== sourceName.normalize("NFC").toLocaleLowerCase()) {
          throw new Error("所选文件不是当前原图，请选择 “" + sourceName + "”");
        }
        original = await createImageBitmap(file);
        if (original.width !== selected.width || original.height !== selected.height) {
          throw new Error("所选原图尺寸与当前图层不一致，请重新确认原图");
        }
        if (target !== selected || selected.image !== viewer.imageName() || selected.source !== document.getElementById("mainImage").currentSrc) {
          throw new Error("当前图层已切换，请重新选择原图");
        }
        confirmedFiles.set(selected.source, file);
        accepted = true;
      } catch (error) { output.textContent = "原图确认失败：" + error.message; }
      finally { original?.close(); button.disabled = fileButton.disabled = false; positionMenu(parseFloat(menu.style.left), parseFloat(menu.style.top)); }
      if (accepted) button.click();
    });
    function savePadding() {
      const next = {};
      for (const key of Object.keys(padding)) {
        const value = inputs[key].value.trim() ? Number(inputs[key].value) : NaN;
        if (!Number.isFinite(value) || value < 0) {
          output.textContent = "扩框比例必须是大于或等于 0 的数字";
          return false;
        }
        next[key] = value;
      }
      padding = next;
      try { localStorage.setItem(storageKey, JSON.stringify(padding)); } catch (_) {}
      output.textContent = "";
      return true;
    }
    let target = null;
    viewer.canvas.addEventListener("contextmenu", event => {
      const obj = viewer.object();
      if (!obj || viewer.batchPreview()) return;
      event.preventDefault();
      const loaded = document.getElementById("mainImage");
      target = { bbox: obj.bbox.slice(), image: viewer.imageName(), source: loaded.currentSrc, width: loaded.naturalWidth, height: loaded.naturalHeight, index: viewer.index() };
      output.textContent = "";
      fallback.hidden = true;
      updatePath(target);
      menu.hidden = false;
      positionMenu(event.clientX, event.clientY);
    });
    document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) menu.hidden = true; });
    document.addEventListener("keydown", event => {
      if (!menu.hidden && event.key === "Escape") { menu.hidden = true; event.stopImmediatePropagation(); event.preventDefault(); }
    }, true);
    async function loadReadableImage(source) {
      const url = new URL(source, location.href);
      if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return null;
      // Retry the same displayed image using CORS when its server permits pixel access.
      return new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => { image.src = ""; reject(new DOMException("图片服务器未允许读取像素", "SecurityError")); }, 10000);
        image.crossOrigin = "anonymous";
        image.onload = () => { clearTimeout(timer); resolve(image); };
        image.onerror = () => { clearTimeout(timer); reject(new DOMException("图片服务器未允许读取像素", "SecurityError")); };
        image.src = source;
      });
    }
    button.addEventListener("click", async () => {
      if (!target || !savePadding()) return;
      const selected = target, ratios = { ...padding };
      button.disabled = true;
      let bitmap;
      try {
        const loaded = document.getElementById("mainImage");
        if (selected.image !== viewer.imageName() || selected.source !== loaded.currentSrc || !loaded.complete || !loaded.naturalWidth) {
          throw new Error("当前图层已切换或尚未加载完成，请等待当前图片加载后重新右键导出");
        }
        const confirmed = confirmedFiles.get(selected.source);
        bitmap = await createImageBitmap(confirmed || loaded);
        const xs = selected.bbox.filter((_, i) => i % 2 === 0), ys = selected.bbox.filter((_, i) => i % 2 === 1);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const width = maxX - minX, height = maxY - minY;
        const left = Math.max(0, Math.floor(minX - width * ratios.left));
        const top = Math.max(0, Math.floor(minY - height * ratios.top));
        const right = Math.min(bitmap.width, Math.ceil(maxX + width * ratios.right));
        const bottom = Math.min(bitmap.height, Math.ceil(maxY + height * ratios.bottom));
        if (right <= left || bottom <= top) throw new Error("框没有可裁剪的图像区域");
        const canvas = document.createElement("canvas");
        canvas.width = right - left;
        canvas.height = bottom - top;
        canvas.getContext("2d").drawImage(bitmap, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        let cropped;
        try {
          cropped = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        } catch (error) {
          if (error.name !== "SecurityError") throw error;
          const readable = await loadReadableImage(selected.source);
          if (!readable) throw error;
          // Resetting dimensions clears the tainted canvas before drawing the readable source.
          canvas.width = right - left;
          canvas.height = bottom - top;
          canvas.getContext("2d").drawImage(readable, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
          cropped = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        }
        if (!cropped) throw new Error("裁剪生成失败");
        const url = URL.createObjectURL(cropped), link = document.createElement("a");
        const name = selected.image.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[<>:"|?*]/g, "_");
        link.download = name + "_object_" + (selected.index + 1) + "_crop.png";
        link.href = url;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        fallback.hidden = true;
        output.textContent = "已导出 " + canvas.width + " × " + canvas.height;
      } catch (error) {
        fallback.hidden = error.name !== "SecurityError";
        output.textContent = error.name === "SecurityError"
          ? "浏览器禁止导出其像素，请确认一次当前原图；确认后本页面可复用。"
          : "裁剪失败：" + error.message;
      }
      finally { bitmap?.close(); button.disabled = false; positionMenu(parseFloat(menu.style.left), parseFloat(menu.style.top)); }
    });
  };
})();
