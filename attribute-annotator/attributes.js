(function () {
  "use strict";
  const core = window.AttributesCore;
  const byId = id => document.getElementById(id);
  const dialog = byId("attrsConfigDialog"), rows = byId("attrsConfigRows");
  let config = null, viewer = null, enabled = false;

  function setEnabled(value) {
    enabled = !!value;
    byId("attrsPanel").hidden = !enabled;
    document.querySelector(".attribute-workspace").classList.toggle("attributes-enabled", enabled);
    byId("attrsModeBtn").setAttribute("aria-pressed", String(enabled));
    if (enabled && viewer && !viewer.object()) viewer.selectFirst();
    render();
    if (enabled && !config) openConfig();
    if (viewer) window.requestAnimationFrame(viewer.resize);
  }

  function showError(error) { byId("attrsConfigError").textContent = error.message || String(error); }
  function field(text, input) {
    const label = document.createElement("label"), span = document.createElement("span");
    label.className = "field";
    span.textContent = text;
    label.append(span, input);
    return label;
  }
  function addRow(group) {
    const row = document.createElement("div"), name = document.createElement("input"), options = document.createElement("textarea"), remove = document.createElement("button");
    row.className = "config-row";
    name.dataset.configField = "name";
    name.value = group ? group.name : "";
    name.placeholder = "例如：螺母数量";
    options.dataset.configField = "options";
    options.value = group ? group.options.join("、") : "";
    options.placeholder = "明确可辨、存疑、不可辨";
    options.spellcheck = false;
    const optionsField = field("可选状态（用顿号、逗号或换行分隔）", options);
    optionsField.classList.add("config-options");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => row.remove());
    row.append(field("属性词条", name), optionsField, remove);
    rows.append(row);
  }
  function fillRows(value) {
    rows.replaceChildren();
    if (value) value.groups.forEach(addRow); else addRow();
    byId("attrsConfigError").textContent = "";
  }
  function readRows() {
    return core.normalizeConfig({ version: 1, groups: Array.from(rows.children, row => ({
      name: row.querySelector('[data-config-field="name"]').value,
      options: row.querySelector('[data-config-field="options"]').value.split(/[、,，\r\n]+/).map(value => value.trim()).filter(Boolean)
    })) });
  }
  function openConfig() {
    fillRows(config || core.defaultConfig());
    if (!dialog.open) dialog.showModal();
  }
  function downloadConfig(value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(core.exportConfig(value), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "attrs-selection-table.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
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
      if (JSON.stringify(next) === JSON.stringify(obj.attrs) && !Object.prototype.hasOwnProperty.call(obj, "score_attrs")) return;
      viewer.recordUndo();
      obj.attrs = next;
      delete obj.score_attrs;
      render();
      message(option === null ? "已清空：" + group.name : "已保存：" + group.name + "：" + option);
    } catch (error) { message(error.message, true); }
  }
  function render() {
    if (!viewer || !enabled) return;
    const obj = viewer.object(), objects = viewer.objects();
    const select = byId("attrsObjectSelect");
    const choices = byId("attrsChoices");
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "-1";
    empty.textContent = objects.length ? "选择标注框" : "当前图片没有标注框";
    select.append(empty);
    objects.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = "#" + (index + 1) + " · " + (item.labels || []).join(" / ");
      select.append(option);
    });
    select.value = String(viewer.index());
    select.disabled = !objects.length || viewer.batchPreview();
    byId("attrsUndoBtn").disabled = !viewer.canUndo();
    byId("attrsTarget").textContent = !config ? "请先配置或导入属性选择表" : viewer.batchPreview() ? "退出批量预览后选择属性" : obj ? "当前标注：#" + (viewer.index() + 1) + " · " + (obj.labels || []).join(" / ") : "请在图中、Objects 列表或上方选择标注框";
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
      const box = document.createElement("fieldset"), legend = document.createElement("legend"), buttons = document.createElement("div");
      box.className = "attribute-group";
      legend.textContent = group.name;
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
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "attribute-clear";
      clear.textContent = "清空该项";
      clear.dataset.attributeClear = group.name;
      clear.disabled = !obj || !valid || !hasValue || viewer.batchPreview();
      clear.addEventListener("click", () => choose(group, null));
      box.append(legend, buttons, clear);
      if (hasValue && !group.options.includes(selectedValue)) {
        const warning = document.createElement("p");
        warning.textContent = "已有状态“" + selectedValue + "”不在当前配置中，选择新状态可替换。";
        box.append(warning);
      }
      choices.append(box);
    });
    byId("attrsProgress").textContent = obj ? completed + " / " + config.groups.length : "0 / " + config.groups.length;
  }

  byId("attrsModeBtn").addEventListener("click", () => setEnabled(!enabled));
  byId("attrsConfigureBtn").addEventListener("click", openConfig);
  rows.addEventListener("input", () => { byId("attrsConfigError").textContent = ""; });
  byId("attrsConfigClose").addEventListener("click", () => dialog.close());
  byId("attrsAddBtn").addEventListener("click", () => addRow());
  byId("attrsPresetBtn").addEventListener("click", () => fillRows(core.defaultConfig()));
  byId("attrsApplyBtn").addEventListener("click", () => {
    try { config = readRows(); dialog.close(); render(); }
    catch (error) { showError(error); }
  });
  byId("attrsExportBtn").addEventListener("click", () => {
    try { downloadConfig(readRows()); byId("attrsConfigError").textContent = ""; }
    catch (error) { showError(error); }
  });
  byId("attrsImportBtn").addEventListener("click", () => byId("attrsConfigFile").click());
  byId("attrsConfigFile").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try { fillRows(core.normalizeConfig(JSON.parse(await file.text()))); }
    catch (error) { showError(error); }
    finally { event.target.value = ""; }
  });
  byId("attrsObjectSelect").addEventListener("change", event => viewer.selectObject(Number(event.target.value)));
  byId("attrsUndoBtn").addEventListener("click", () => viewer.undo());
  window.AttributeUI = {
    render: render,
    enabled: () => enabled,
    attach: function (adapter) {
      viewer = adapter;
      if (window.location.hash === "#attributes") setEnabled(true);
    }
  };
})();
