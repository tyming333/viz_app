(function () {
  "use strict";
  const core = window.AttributesCore;
  const byId = id => document.getElementById(id);
  const dialog = byId("attrsConfigDialog");
  let config = null, viewer = null, enabled = false;
  let pendingImport = null, resolveImport = null;

  function setEnabled(value, persist = true) {
    enabled = !!value;
    byId("attrsPanel").hidden = !enabled;
    document.querySelector(".attribute-workspace").classList.toggle("attributes-enabled", enabled);
    byId("attrsModeBtn").setAttribute("aria-pressed", String(enabled));
    if (enabled && viewer && !viewer.object()) viewer.selectFirst();
    render();
    if (enabled && !config) openConfig();
    if (viewer) window.requestAnimationFrame(viewer.resize);
    if (viewer && persist) viewer.saveDraft();
  }

  function showError(error) { byId("attrsConfigError").textContent = error.message || String(error); }
  function openConfig() {
    byId("attrsConfigSummary").textContent = config
      ? "当前已载入 " + config.groups.length + " 个属性词条；导入其他 JSON 可替换当前配置。"
      : "尚未导入属性配置。请导入 JSON 后开始标注。";
    byId("attrsConfigError").textContent = "";
    if (!dialog.open) dialog.showModal();
  }
  function message(text, error) {
    const output = byId("attrsMessage");
    output.textContent = text;
    output.classList.toggle("error", !!error);
  }
  function choose(group, option) {
    if (!enabled || !config || !viewer || viewer.batchPreview() || !viewer.object()) return;
    try {
      const obj = viewer.object();
      const next = core.choose(core.readObject(obj), group, option);
      if (JSON.stringify(next) === JSON.stringify(obj.attrs)) return;
      viewer.recordUndo();
      obj.attrs = next;

      render();
      message(option === null ? "已清空：" + group.name : "已保存：" + group.name + "：" + option);
    } catch (error) { message(error.message, true); }
  }
  function render() {
    if (!viewer || !enabled) return;
    const obj = viewer.object(), choices = byId("attrsChoices");
    choices.replaceChildren();
    message("");
    if (!config) { byId("attrsProgress").textContent = "未配置"; return; }
    let selected = {}, valid = true;
    try { selected = obj ? core.readObject(obj) : {}; }
    catch (error) { valid = false; message(error.message, true); }
    let completed = 0;
    config.groups.forEach(group => {
      const hasValue = Object.prototype.hasOwnProperty.call(selected, group.name);
      const selectedValue = hasValue ? selected[group.name] : undefined;
      if (hasValue && group.options.includes(selectedValue)) completed += 1;
      const box = document.createElement("section"), heading = document.createElement("div"), number = document.createElement("span"), title = document.createElement("strong"), buttons = document.createElement("div");
      box.className = "attribute-group";
      heading.className = "attribute-heading";
      number.className = "attribute-number";
      number.textContent = String(config.groups.indexOf(group) + 1).padStart(2, "0");
      title.className = "attribute-title";
      title.textContent = group.name;
      heading.append(number, title);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "attribute-clear";
      clear.textContent = "清空";
      clear.dataset.attributeClear = group.name;
      clear.disabled = !obj || !valid || !hasValue || viewer.batchPreview();
      clear.addEventListener("click", () => choose(group, null));
      heading.append(clear);
      buttons.className = "attribute-options";
      buttons.setAttribute("role", "group");
      buttons.setAttribute("aria-label", group.name + "，单选");
      group.options.forEach(value => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = value;
        button.dataset.attributeOption = value;
        button.dataset.attributeKey = group.name;
        button.setAttribute("aria-pressed", String(selectedValue === value));
        button.disabled = !obj || !valid || viewer.batchPreview();
        button.addEventListener("click", () => choose(group, value));
        buttons.append(button);
      });
      box.append(heading, buttons);
      if (hasValue && !group.options.includes(selectedValue)) {
        const warning = document.createElement("p");
        warning.textContent = "已有状态“" + selectedValue + "”不在当前配置中，选择新状态可替换。";
        box.append(warning);
      }
      choices.append(box);
    });
    byId("attrsProgress").textContent = obj ? completed + " / " + config.groups.length : "0 / " + config.groups.length;
  }

  function updateImportValidation() {
    if (!pendingImport) return;
    const reuse = byId("attrsReuseOnImport").checked;
    byId("attrsDataImportConfirm").disabled = reuse && !config;
    byId("attrsImportConfigureBtn").hidden = !reuse || !!config;
    const output = byId("attrsImportValidation");
    output.classList.remove("error");
    if (!reuse) { output.textContent = "按原始内容导入，不进行属性校验。"; return; }
    if (!config) { output.textContent = "请先导入属性配置，以校验已有标注；也可取消勾选后直接导入。"; return; }
    let reused = 0, states = 0, empty = 0;
    const unmatched = new Set(), errors = [];
    Object.entries(pendingImport).forEach(([image, entry]) => entry.det.objects.forEach((object, index) => {
      try {
        const result = core.validateExisting(object, config);
        result.unmatched.forEach(name => unmatched.add(name));
        if (result.errors.length) { errors.push(image + " #" + (index + 1) + "：" + result.errors.join("；")); return; }
        const count = Object.keys(result.values).length;
        if (count) { reused += 1; states += count; } else empty += 1;
      } catch (error) { errors.push(image + " #" + (index + 1) + "：" + error.message); }
    }));
    output.textContent = "校验通过，可复用 " + reused + " 个框、" + states + " 项属性；" + empty + " 个框尚未标注。" + (unmatched.size ? "\n配置外字段保留，不作为属性复用：" + Array.from(unmatched).join("、") : "") + (errors.length ? "\n校验失败 " + errors.length + " 个框：\n" + errors.slice(0, 20).join("\n") : "");
    output.classList.toggle("error", !!errors.length);
  }
  function finishImport(accepted) {
    byId("attrsDataImportDialog").close();
    const resolve = resolveImport;
    pendingImport = resolveImport = null;
    if (resolve) resolve(accepted);
  }
  byId("attrsReuseOnImport").addEventListener("change", updateImportValidation);
  byId("attrsImportConfigureBtn").addEventListener("click", openConfig);
  byId("attrsDataImportConfirm").addEventListener("click", () => finishImport(true));
  byId("attrsDataImportCancel").addEventListener("click", () => finishImport(false));
  byId("attrsDataImportDialog").addEventListener("cancel", event => { event.preventDefault(); finishImport(false); });
  byId("attrsModeBtn").addEventListener("click", () => setEnabled(!enabled));
  byId("attrsConfigureBtn").addEventListener("click", openConfig);
  byId("attrsConfigClose").addEventListener("click", () => dialog.close());
  byId("attrsImportBtn").addEventListener("click", () => byId("attrsConfigFile").click());
  byId("attrsConfigFile").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      config = core.normalizeConfig(JSON.parse(await file.text()));
      viewer.saveDraft();

      byId("attrsConfigSummary").textContent = "已导入 " + file.name + "（" + config.groups.length + " 个属性词条）";
      byId("attrsConfigError").textContent = "";
      dialog.close();
      updateImportValidation();
      render();
    }
    catch (error) { showError(error); }
    finally { event.target.value = ""; }
  });
  window.AttributeUI = {
    render: render,
    enabled: () => enabled,
    confirmImport: function (data) {
      const hasAttributes = Object.values(data).some(entry => entry.det.objects.some(object => object.attrs && (Array.isArray(object.attrs) || typeof object.attrs !== "object" || Object.entries(object.attrs).some(([name, value]) => name !== "box_type" && typeof value === "string"))));
      if (!hasAttributes) return Promise.resolve(true);
      if (resolveImport) finishImport(false);
      pendingImport = data;
      byId("attrsReuseOnImport").checked = true;
      updateImportValidation();
      byId("attrsDataImportDialog").showModal();
      return new Promise(resolve => { resolveImport = resolve; });
    },
    draft: () => ({ config, enabled }),
    restoreDraft: function (saved) {
      config = saved?.config ? core.normalizeConfig(saved.config) : null;
      if (config && dialog.open) dialog.close();
      setEnabled(saved ? !!saved.enabled : window.location.hash === "#attributes", false);
    },
    draftStatus: function (text, error) {
      byId("attrsDraftStatus").textContent = text;
      byId("attrsDraftStatus").classList.toggle("error", !!error);
    },
    attach: function (adapter) {
      viewer = adapter;
      if (window.location.hash === "#attributes") setEnabled(true, false);
    }
  };
})();
