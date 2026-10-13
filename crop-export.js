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
    Object.assign(menu.style, { position: "fixed", zIndex: "1000", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "6px", padding: "12px", boxShadow: "0 4px 20px #0003", width: "240px", maxWidth: "calc(100vw - 16px)" });
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
    menu.append(button, output);
    const fileInput = document.createElement("input"), fileButton = document.createElement("button");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileButton.type = "button";
    fileButton.textContent = "选择原图后裁剪";
    fileButton.hidden = true;
    menu.append(fileButton, fileInput);
    fileButton.addEventListener("click", () => fileInput.click());
    let originalFile = null;
    fileInput.addEventListener("change", () => {
      originalFile = fileInput.files[0] || null;
      if (originalFile) button.click();
      fileInput.value = "";
    });
    document.body.append(menu);
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
      target = { bbox: obj.bbox.slice(), image: viewer.imageName(), index: viewer.index() };
      originalFile = null;
      fileButton.hidden = true;
      output.textContent = "";
      menu.hidden = false;
      menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + "px";
      menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + "px";
    });
    document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) menu.hidden = true; });
    document.addEventListener("keydown", event => {
      if (!menu.hidden && event.key === "Escape") { menu.hidden = true; event.stopImmediatePropagation(); event.preventDefault(); }
    }, true);
    button.addEventListener("click", async () => {
      if (!target || !savePadding()) return;
      const selected = target, ratios = { ...padding };
      button.disabled = true;
      let bitmap;
      try {
        if (originalFile) bitmap = await createImageBitmap(originalFile);
        else {
          const loaded = document.getElementById("mainImage");
          if (selected.image === viewer.imageName() && loaded.complete && loaded.naturalWidth > 0) {
            try { bitmap = await createImageBitmap(loaded); }
            catch (_) { bitmap = await createImageBitmap(await viewer.readImage(selected.image)); }
          } else {
            bitmap = await createImageBitmap(await viewer.readImage(selected.image));
          }
        }
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
        const cropped = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        if (!cropped) throw new Error("裁剪生成失败");
        const url = URL.createObjectURL(cropped), link = document.createElement("a");
        const name = selected.image.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[<>:"|?*]/g, "_");
        link.download = name + "_object_" + (selected.index + 1) + "_crop.png";
        link.href = url;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        output.textContent = "已导出 " + canvas.width + " × " + canvas.height;
      } catch (error) {
        fileButton.hidden = false;
        output.textContent = "浏览器无法读取原图像素，请点击“选择原图后裁剪”选择当前图片。";
      }
      finally { bitmap?.close(); button.disabled = false; }
    });
  };
})();
