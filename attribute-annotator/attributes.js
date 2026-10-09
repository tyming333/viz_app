(function () {
  "use strict";
  const core = window.AttributesCore;
  const byId = id => document.getElementById(id);
  const dialog = byId("attrsConfigDialog"), rows = byId("attrsConfigRows");
  let config = null, viewer = null;

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
    name.placeholder = "例如：外观状态";
    options.dataset.configField = "options";
    options.value = group ? group.options.join("\n") : "";
    options.placeholder = "正常\n松动\n缺失";
    options.spellcheck = false;
    const optionsField = field("可选属性名，每行一个（同组单选）", options);
    optionsField.classList.add("config-options");
    remove.type = "button";
    remove.textContent = "删除组";
    remove.addEventListener("click", () => row.remove());
    row.append(field("属性组名称", name), remove, optionsField);
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
      options: row.querySelector('[data-config-field="options"]').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    })) });
  }
  function openConfig() {
    fillRows(config);
    if (!dialog.open) dialog.showModal();
  }
  function downloadConfig(value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
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
    if (!config || !viewer || viewer.batchPreview() || !viewer.object()) return;
    try {
      const obj = viewer.object();
      const next = core.choose(obj.score_attrs, group, option);
      if (JSON.stringify(next) === JSON.stringify(obj.score_attrs)) return;
      viewer.recordUndo();
      obj.score_attrs = next;
      render();
      message(option === null ? "已清空该组属性" : "已保存：" + option);
    } catch (error) { message(error.message, true); }
  }
  function render() {
    if (!viewer) return;
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
    let selected = [], valid = true;
    try { selected = obj ? core.read(obj.score_attrs) : []; }
    catch (error) { valid = false; message(error.message, true); }
    let completed = 0;
    config.groups.forEach(group => {
      const groupValues = selected.filter(value => group.options.includes(value));
      if (groupValues.length === 1) completed += 1;
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
        button.setAttribute("aria-pressed", String(groupValues.includes(value)));
        button.disabled = !obj || !valid || viewer.batchPreview();
        button.addEventListener("click", () => choose(group, value));
        buttons.append(button);
      });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "attribute-clear";
      clear.textContent = "清空该组";
      clear.disabled = !obj || !valid || !groupValues.length || viewer.batchPreview();
      clear.addEventListener("click", () => choose(group, null));
      box.append(legend, buttons, clear);
      if (groupValues.length > 1) {
        const warning = document.createElement("p");
        warning.textContent = "已有多个同组属性，请选择一个状态修正。";
        box.append(warning);
      }
      choices.append(box);
    });
    byId("attrsProgress").textContent = obj ? completed + " / " + config.groups.length : "0 / " + config.groups.length;
  }

  byId("attrsConfigureBtn").addEventListener("click", openConfig);
  rows.addEventListener("input", () => { byId("attrsConfigError").textContent = ""; });
  byId("attrsConfigClose").addEventListener("click", () => dialog.close());
  byId("attrsAddBtn").addEventListener("click", () => addRow());
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
    attach: function (adapter) { viewer = adapter; render(); openConfig(); }
  };
})();
