(function () {
  "use strict";
  const C = window.ModelConfigCore;
  const G = window.ModelConfigGraph;
  const $ = id => document.getElementById(id);
  const kindNames = { model: "模型", pretreat: "预处理", result: "结果" };
  let doc = null, selected = null, tab = "form", jsonPending = false, saving = false;
  let collapsed = new Set();
  let graphCollapsed = new Set(), graphQuery = "";
  let clipboard = null, placement = null, draggedPath = null, dropTarget = null;
  let widthFrame = null;
  const measureContext = document.createElement("canvas").getContext("2d");
  const invalid = new Set();
  function el(tag, cls, text) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function button(text, handler, cls) {
    const result = el("button", cls, text); result.type = "button";
    result.addEventListener("click", handler); return result;
  }
  function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
  function pathText(path) { return path.reduce((s, p) => s + (typeof p === "number" ? `[${p}]` : `${s ? "." : ""}${p}`), ""); }
  function hasDraft() { return jsonPending || invalid.size > 0; }
  function mayNavigate() {
    if (!hasDraft()) return true;
    status("请先应用或放弃 JSON 修改，并修正标红的字段。", true); return false;
  }
  function run(action, rerender = true) {
    if (!mayNavigate()) return false;
    try { action(); refresh(rerender); return true; }
    catch (error) { status(error.message, true); return false; }
  }
  function select(path) {
    if (!mayNavigate()) return;
    const findCard = () => [...$("graphNodes").querySelectorAll(".flow-node")].find(card => card.dataset.nodePath === C.keyOf(path));
    const before = !$("detailsDialog").open && findCard()?.getBoundingClientRect();
    selected = path; tab = "form"; refresh();
    if (before) requestAnimationFrame(() => {
      const after = findCard()?.getBoundingClientRect();
      if (after) $("graphViewport").scrollBy(after.left - before.left, after.top - before.top);
    });
  }
  function selectTableRow(path) {
    // Focusing another cell must not replace live inputs or discard invalid drafts.
    selected = path;
    for (const row of $("graphNodes").querySelectorAll(".flow-node")) {
      const active = row.dataset.nodePath === C.keyOf(path);
      row.classList.toggle("selected", active);
      row.querySelector(".node-select").setAttribute("aria-pressed", String(active));
    }
  }
  function configuredLabelKey() {
    const route = (doc ? C.routes(doc.data) : []).find(node => C.nodeLabelKey(node.value));
    return route ? C.nodeLabelKey(route.value) : "label_name";
  }
  function newNode() { return { last_output: selected ? "0" : "root", [configuredLabelKey()]: "", current_model: "", code: "", num: "0", confidence: "0.5", non_defect: "false", childlist: [] }; }
  async function openFile(file) {
    if (!file) return;
    try {
      const next = C.createDocument(new Uint8Array(await file.arrayBuffer()), file.name);
      doc = next; selected = null; tab = "form"; jsonPending = false; invalid.clear(); collapsed.clear();
      graphCollapsed = branchOverview();
      clipboard = null; placement = null;
      clearDrag();
      graphQuery = ""; $("graphSearch").value = "";
      $("searchInput").value = ""; $("jsonError").textContent = "";
      $("welcome").hidden = true; $("workspace").hidden = false; $("graphWorkspace").hidden = false;
      refresh(); status(`已读取 ${file.name}。源文件只读，所有修改将在副本中进行。`);
      $("graphViewport").scrollTo(0, 0);
    } catch (error) { status(`打开失败：${error.message}`, true); }
  }
  function chooseFile() {
    if (doc && (doc.dirty || hasDraft()) && !window.confirm("当前修改尚未另存，打开其他文件将放弃这些修改。继续？")) return;
    $("fileInput").value = ""; $("fileInput").click();
  }
  function encodingLabel() { return `${doc.format.encoding.toUpperCase()} · ${doc.format.bom.length ? "有 BOM" : "无 BOM"}`; }
  function renderTree() {
    const all = C.routes(doc.data), query = $("searchInput").value.trim().toLowerCase();
    $("routeCount").textContent = all.length;
    $("overviewBtn").classList.toggle("active", selected === null);
    const tree = $("routeTree"); tree.replaceChildren();
    let visible = null;
    if (query) {
      visible = new Set();
      for (const node of all) {
        const terms = Object.entries(node.value).filter(([key]) => key !== "childlist").map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(" ").toLowerCase();
        if (terms.includes(query)) {
          for (let length = 2; length <= node.path.length; length += 2) visible.add(C.keyOf(node.path.slice(0, length)));
        }
      }
    }
    for (const node of all) {
      if (query && !visible.has(C.keyOf(node.path))) continue;
      if (!query && node.path.some((_, i) => i >= 2 && i % 2 === 0 && collapsed.has(C.keyOf(node.path.slice(0, i))))) continue;
      const row = el("div", "tree-row"); row.style.setProperty("--depth", node.depth);
      const active = C.keyOf(selected) === C.keyOf(node.path);
      row.classList.toggle("active", active);
      const open = query || !collapsed.has(C.keyOf(node.path));
      const toggle = button(node.value.childlist.length ? (open ? "▾" : "▸") : "·", () => {
        const key = C.keyOf(node.path);
        if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
        renderTree();
      }, "tree-toggle");
      toggle.disabled = !node.value.childlist.length || Boolean(query);
      toggle.setAttribute("aria-label", `${open ? "收起" : "展开"} ${node.title}`);
      if (node.value.childlist.length) toggle.setAttribute("aria-expanded", String(Boolean(open)));
      const label = button("", () => select(node.path), "tree-label");
      label.title = `${pathText(node.path)}\n${node.title}\n上级输出: ${node.value.last_output ?? "—"} · 置信度: ${node.value.confidence || "—"}`;
      if (active) label.setAttribute("aria-current", "true");
      label.append(el("i", `dot ${node.kind}`));
      const text = el("span", "tree-text"); text.append(el("strong", "", node.title), el("small", "", `输出 ${node.value.last_output ?? "—"} · ${kindNames[node.kind]}${node.value.childlist.length ? ` · ${node.value.childlist.length} 分支` : ""}`));
      label.append(text); row.append(toggle, label); tree.append(row);
    }
    if (!tree.childElementCount) tree.append(el("p", "empty", query ? "未找到匹配节点" : "暂无路由，可添加根节点。"));
  }
  function updateMeta() {
    $("fileName").textContent = doc.name;
    $("fileFormat").textContent = encodingLabel();
    $("dirtyBadge").textContent = doc.dirty || hasDraft() ? "未另存" : doc.text === doc.format.text ? "未修改" : "已另存";
    $("dirtyBadge").classList.toggle("changed", doc.dirty || hasDraft());
    $("graphFileName").textContent = doc.name;
    $("graphDirty").textContent = $("dirtyBadge").textContent;
    $("graphDirty").className = $("dirtyBadge").className;
    $("graphSummary").textContent = `${C.routes(doc.data).length} 个节点 · ${encodingLabel()}`;
    $("undoBtn").disabled = !doc.canUndo || hasDraft() || saving;
    $("redoBtn").disabled = !doc.canRedo || hasDraft() || saving;
    $("saveBtn").disabled = hasDraft() || saving;
    $("detailUndoBtn").disabled = $("undoBtn").disabled;
    $("detailRedoBtn").disabled = $("redoBtn").disabled;
    $("detailSaveBtn").disabled = $("saveBtn").disabled;
    const changes = C.diff(doc.format.text, doc.text);
    $("changeCount").textContent = changes.length;
    const routes = C.routes(doc.data);
    const stats = $("stats"); stats.replaceChildren();
    for (const [name, count] of [["路由节点", routes.length], ["模型节点", routes.filter(n => n.kind === "model").length], ["预处理", routes.filter(n => n.kind === "pretreat").length], ["结果节点", routes.filter(n => n.kind === "result").length], ["相机配置", doc.data.camera_config.length], ["线路条目", doc.data.line_name.length]]) {
      const stat = el("div", "stat"); stat.append(el("strong", "", count), el("span", "", name)); stats.append(stat);
    }
    const details = $("fileDetails"); details.replaceChildren();
    for (const [key, value] of [["编码", doc.format.encoding.toUpperCase()], ["BOM", doc.format.bom.length ? "保留原 BOM" : "无 BOM · 不添加"], ["换行", doc.format.newline === "\r\n" ? "CRLF" : doc.format.newline === "\r" ? "CR" : "LF"], ["源大小", `${doc.format.bytes.length.toLocaleString()} 字节`], ["最大层级", routes.length ? Math.max(...routes.map(n => n.depth)) + 1 : 0]]) details.append(el("dt", "", key), el("dd", "", value));
    const warnings = doc.warnings;
    $("validationBadge").textContent = warnings.length ? `${warnings.length} 项提示` : "通过";
    $("validationBadge").className = `badge ${warnings.length ? "changed" : "good"}`;
    const validation = $("validation"); validation.replaceChildren();
    if (!warnings.length) validation.append(el("p", "validation-ok", "JSON 语法与配置结构有效。"));
    for (const warning of warnings) validation.append(el("p", "validation-item", `${warning.path}：${warning.message}`));
    return changes;
  }
  function field(path, value, options = {}) {
    const key = String(path.at(-1)), info = C.fieldInfo[key];
    const label = el("label", `field${options.wide ? " wide" : ""}${options.compact ? " compact-field" : ""}${options.table ? " table-field" : ""}`);
    const heading = el("span", "field-label", options.title || info?.[0] || key);
    if (!options.compact) heading.append(el("code", "", options.title ? "" : key), el("span", "badge", value === null ? "null" : Array.isArray(value) ? "array" : typeof value));
    if (options.table) heading.classList.add("sr-only");
    label.append(heading);
    const complex = value === null || typeof value === "object";
    const input = el(complex ? "textarea" : typeof value === "boolean" || (key === "non_defect" && ["true", "false"].includes(value)) ? "select" : "input");
    input.dataset.path = C.keyOf(path);
    input.setAttribute("aria-label", `${options.title || info?.[0] || key} (${pathText(path)})`);
    if (input.tagName === "SELECT") {
      for (const val of ["false", "true"]) { const option = el("option", "", val); option.value = val; input.append(option); }
    } else if (input.tagName === "INPUT") { input.type = "text"; if (typeof value === "number") input.inputMode = "decimal"; }
    input.value = complex || typeof value === "number" ? doc.raw(path) : String(value);
    input.title = `${key}: ${input.value}`;
    if (options.table && complex) input.rows = 1;
    if (options.table) input.addEventListener("input", scheduleWidths);
    if (complex) input.spellcheck = false;
    label.append(input);
    if (info && !options.compact) label.append(el("small", "", info[1]));
    const errorText = el("small", "field-error"); errorText.setAttribute("role", "alert"); label.append(errorText);
    input.addEventListener("change", () => {
      try {
        if (options.optional) {
          // Missing labels remain absent until the user supplies a name.
          if (!Object.hasOwn(doc.node(path.slice(0, -1)).value, path.at(-1)) && input.value === "") return;
          doc.setOptional(path, input.value);
        }
        else if (typeof value === "string") doc.set(path, input.value);
        else if (typeof value === "boolean") doc.set(path, input.value === "true");
        else if (typeof value === "number") {
          const n = JSON.parse(input.value);
          if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("请输入有效的 JSON 数字。");
          doc.replace(path, input.value);
        } else doc.replace(path, input.value.replace(/\r\n|\r|\n/g, doc.format.newline));
        invalid.delete(input); input.removeAttribute("aria-invalid"); errorText.textContent = "";
        input.title = `${key}: ${input.value}`;
        refresh(false); status("参数已更新，可通过“另存为新文件”导出副本。");
      } catch (error) {
        invalid.add(input); input.setAttribute("aria-invalid", "true"); errorText.textContent = error.message;
        updateMeta(); status("字段内容无效，请修正后再保存或切换节点。", true);
      }
    });
    return label;
  }
  function openDetails(path = selected) {
    if (!mayNavigate()) return;
    selected = path; tab = "form"; refresh();
    if (!$("detailsDialog").open) $("detailsDialog").showModal();
  }
  function closeDetails() {
    document.activeElement?.blur();
    if (!mayNavigate()) return;
    $("detailsDialog").close(); refresh();
  }
  function revealSelected() {
    if (!selected) return;
    for (let length = 2; length < selected.length; length += 2) graphCollapsed.delete(C.keyOf(selected.slice(0, length)));
  }
  function graphAction(path, action) {
    run(() => {
      selected = path; action(); revealSelected();
      graphQuery = ""; $("graphSearch").value = "";
    });
  }
  function structureAction(action) {
    return run(() => {
      selected = action();
      // Old array paths may now refer to different nodes; rebuild a consistent overview.
      collapsed.clear(); graphCollapsed = branchOverview(); revealSelected();
      graphQuery = ""; $("graphSearch").value = "";
    });
  }
  function clearDrag() {
    $("graphNodes").querySelectorAll(".dragging, .drop-before, .drop-child, .drop-after").forEach(row => {
      row.classList.remove("dragging", "drop-before", "drop-child", "drop-after");
    });
    $("graphAddRoot").classList.remove("drop-root");
    $("dragHint").hidden = true;
    draggedPath = null; dropTarget = null;
  }
  function dragAllowed(path, target, position) {
    if (!path || !target) return false;
    if (path.length <= target.length && path.every((part, i) => target[i] === part)) return false;
    const parent = path.slice(0, -1);
    if (position === "child") return C.keyOf(parent) !== C.keyOf([...target, "childlist"]) || path.at(-1) !== doc.node([...target, "childlist"]).value.length - 1;
    if (C.keyOf(parent) !== C.keyOf(target.slice(0, -1))) return true;
    return position === "before" ? path.at(-1) !== target.at(-1) - 1 : path.at(-1) !== target.at(-1) + 1;
  }
  function markDrop(card, target, position) {
    if (dropTarget?.card === card && dropTarget.position === position) return;
    $("graphNodes").querySelectorAll(".drop-before, .drop-child, .drop-after").forEach(row => row.classList.remove("drop-before", "drop-child", "drop-after"));
    $("graphAddRoot").classList.remove("drop-root");
    card.classList.add(`drop-${position}`);
    dropTarget = { card, target, position };
    $("dragHint").hidden = false;
    $("dragHint").textContent = `${position === "child" ? "作为子节点接到" : position === "before" ? "插入到" : "插入到"} ${C.nodeTitle(doc.node(target).value)} ${position === "before" ? "前面" : position === "after" ? "后面" : position === "末尾"}`;
  }
  function dragOverNode(event, card, target) {
    if (!draggedPath || event.target.closest(".flow-node") !== card) return;
    const rect = card.getBoundingClientRect(), relative = (event.clientY - rect.top) / rect.height;
    const position = relative < 0.28 ? "before" : relative > 0.72 ? "after" : "child";
    event.stopPropagation();
    if (!dragAllowed(draggedPath, target, position)) {
      $("graphNodes").querySelectorAll(".drop-before, .drop-child, .drop-after").forEach(row => row.classList.remove("drop-before", "drop-child", "drop-after"));
      $("graphAddRoot").classList.remove("drop-root");
      dropTarget = null; $("dragHint").hidden = true;
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    markDrop(card, target, position);
    const viewport = $("graphViewport").getBoundingClientRect();
    if (event.clientY < viewport.top + 38) $("graphViewport").scrollTop -= 18;
    else if (event.clientY > viewport.bottom - 38) $("graphViewport").scrollTop += 18;
  }
  function copyToClipboard(path, subtree = false) {
    if (!mayNavigate()) return;
    clipboard = {raw: doc.copyNode(path, subtree), title: C.nodeTitle(doc.node(path).value), subtree};
    document.querySelectorAll(".paste-node, #pasteRootBtn").forEach(button => { button.disabled = false; });
    $("clipboardStatus").textContent = `已复制${subtree ? "子树" : "单节点"}：${clipboard.title}`;
    status(`已复制${subtree ? "整个子树" : "单个节点（不含子节点）"}。点击目标行“粘贴”选择插入位置。`);
  }
  function deleteSingle(path) {
    if (!mayNavigate()) return;
    const count = doc.node([...path, "childlist"]).value.length;
    if (!window.confirm(`只删除此节点？${count ? `${count} 个直属子节点将按原顺序上提，全部后代保留。` : "其他节点保留。"}可撤销。`)) return;
    structureAction(() => doc.deleteNode(path));
  }
  function openPlacement(mode, target) {
    if (!mayNavigate() || (mode === "paste" && !clipboard)) return;
    placement = {mode, source: target?.slice()};
    const moving = mode === "move";
    $("placementTitle").textContent = moving ? "调整节点层级 / 位置" : "插入已复制节点";
    $("placementSource").textContent = moving ? `移动：${C.nodeTitle(doc.node(target).value)}（携带全部后代）` : `已复制${clipboard.subtree ? "子树" : "单节点"}：${clipboard.title}`;
    const select = $("placementTarget"); select.replaceChildren();
    const root = el("option", "", "根节点列表（末尾）"); root.value = "root"; select.append(root);
    for (const node of C.routes(doc.data)) {
      if (moving && target.every((part, i) => node.path[i] === part)) continue;
      const option = el("option", "", `${"　".repeat(node.depth)}${node.value.last_output ?? "—"} ${node.title} · ${pathText(node.path)}`);
      option.value = C.keyOf(node.path); select.append(option);
    }
    select.value = target && !moving ? C.keyOf(target) : "root";
    const positions = $("placementPosition"); positions.replaceChildren();
    for (const [value, title] of [["before", "同级前面"], ["after", "同级后面"], ["child", "作为最后一个子节点"], ["parent", "插为父节点（目标及其后代接在下面）"]]) {
      if (value === "parent" && (moving || clipboard.subtree)) continue;
      const option = el("option", "", title); option.value = value; positions.append(option);
    }
    positions.value = moving ? "child" : "after"; positions.disabled = select.value === "root";
    $("placementError").textContent = "";
    if (!$("placementDialog").open) $("placementDialog").showModal();
  }
  function branchOverview() {
    // Fold only first-level branches. Opening one reveals its full recursive subtree.
    return new Set(C.routes(doc.data).filter(n => n.depth === 1 && n.value.childlist.length).map(n => C.keyOf(n.path)));
  }
  function expandSubtree(path) {
    for (const key of graphCollapsed) {
      const candidate = JSON.parse(key);
      if (path.every((part, i) => candidate[i] === part)) graphCollapsed.delete(key);
    }
  }
  function tableColumns() {
    const standard = ["last_output", "label_name", "lable_name", "current_model", "code", "num", "confidence", "non_defect", "childlist"];
    const extra = new Set();
    for (const { value } of C.routes(doc.data)) {
      for (const key of Object.keys(value)) {
        if (!standard.includes(key) || (key === "lable_name" && Object.hasOwn(value, "label_name"))) extra.add(key);
      }
    }
    return [
      { key: "last_output", title: "上级 index" },
      { key: "label", title: "标签名称", label: true },
      { key: "current_model", title: "模型 / 预处理" },
      { key: "code", title: "结果编码" },
      { key: "num", title: "数量" },
      { key: "confidence", title: "置信度" },
      { key: "non_defect", title: "非缺陷标记" },
      ...[...extra].map(key => ({ key, title: key, extra: true }))
    ];
  }
  function scheduleWidths() {
    if (widthFrame !== null) cancelAnimationFrame(widthFrame);
    widthFrame = requestAnimationFrame(() => { widthFrame = null; if (doc) fitColumns(); });
  }
  function fitColumns(columns = tableColumns()) {
    const nodes = C.routes(doc.data), header = $("graphTableHeader");
    if (!header.children.length) return;
    const textWidth = (text, font) => {
      measureContext.font = font;
      return Math.max(0, ...String(text).split(/\r\n|\r|\n/).map(line => measureContext.measureText(line).width));
    };
    const headerFont = getComputedStyle(header).font;
    const widths = columns.map(column => {
      const cell = [...$("graphNodes").querySelectorAll(".table-field")].find(cell => cell.dataset.column === column.key);
      const control = cell?.querySelector("input,select,textarea");
      const font = control ? getComputedStyle(control).font : '12px "Microsoft YaHei"';
      let width = Math.max(52, textWidth(column.title, headerFont) + 18);
      for (const node of nodes) {
        const key = column.label ? C.nodeLabelKey(node.value) : column.key;
        if (!key || !Object.hasOwn(node.value, key)) continue;
        const value = node.value[key];
        const text = typeof value === "string" ? value : doc.raw([...node.path, key]);
        width = Math.max(width, textWidth(text, font) + (typeof value === "boolean" || key === "non_defect" ? 34 : 20));
      }
      // Include uncommitted/invalid text without replacing or blurring its input.
      for (const live of $("graphNodes").querySelectorAll(".table-field")) {
        if (live.dataset.column === column.key) {
          const input = live.querySelector("input,select,textarea");
          width = Math.max(width, textWidth(input.value, getComputedStyle(input).font) + (input.tagName === "SELECT" ? 34 : 20));
        }
      }
      return Math.ceil(width);
    });
    const maxDepth = Math.max(0, ...nodes.map(node => node.depth));
    const treeWidth = Math.max(74, maxDepth * 18 + 72);
    const tracks = [treeWidth, ...widths, 82, 344];
    const table = $("graphTable");
    table.style.setProperty("--tree-columns", tracks.map(width => `${width}px`).join(" "));
    table.style.width = `${tracks.reduce((sum, width) => sum + width, 0) + (tracks.length - 1) * 6 + 11}px`;
  }
  function renderGraph() {
    const roots = G.buildTree(doc.data.model_route, graphCollapsed, graphQuery);
    const columns = tableColumns();
    const header = $("graphTableHeader"); header.replaceChildren();
    for (const title of ["层级", ...columns.map(column => column.title), "子项 / 后代", "操作"]) header.append(el("span", "", title));
    let visibleCount = 0;
    const container = $("graphNodes"); container.replaceChildren();
    $("graphEmpty").hidden = roots.length > 0;
    $("graphEmpty").textContent = graphQuery ? "没有匹配的节点，请更换搜索内容。" : "尚无路由节点，点击“＋ 根节点”开始。";
    function renderBranch(node) {
      visibleCount++;
      const branch = el("section", "recursive-branch");
      branch.dataset.branchPath = node.key;
      branch.setAttribute("aria-label", `节点 ${node.value.last_output ?? "—"} ${C.nodeLabel(node.value)} 及其子树`);
      const active = C.keyOf(selected) === C.keyOf(node.path);
      const card = el("article", `flow-node ${node.kind}${visibleCount % 2 === 0 ? " alternate" : ""}${active ? " selected" : ""}${node.match ? " matched" : ""}`);
      card.dataset.nodePath = C.keyOf(node.path);
      const heading = el("div", "flow-node-heading");
      const treeCell = el("div", "node-hierarchy"); treeCell.style.setProperty("--depth", node.depth);
      if (node.childCount) {
        const toggle = button(node.expanded ? "▾" : "▸", () => {
          if (!mayNavigate()) return;
          if (node.expanded) graphCollapsed.add(node.key); else graphCollapsed.delete(node.key);
          renderGraph();
        }, "node-fold");
        toggle.disabled = Boolean(graphQuery);
        toggle.title = `${node.expanded ? "收起" : "展开"}子树：${node.childCount} 个子节点，${node.descendants} 个后代`;
        toggle.setAttribute("aria-label", `${node.expanded ? "收起" : "展开"}节点 ${node.title} 的子树`);
        toggle.setAttribute("aria-expanded", String(node.expanded));
        treeCell.append(toggle);
      } else treeCell.append(el("span", "node-leaf", "·"));
      const selectButton = button("", () => selectTableRow(node.path), "node-select");
      selectButton.setAttribute("aria-label", `选中节点 ${node.title}`);
      if (active) selectButton.setAttribute("aria-pressed", "true");
      selectButton.title = `上级传入 ${node.value.last_output ?? "—"} · ${node.title}\n${pathText(node.path)}`;
      selectButton.append(el("i", `dot ${node.kind}`));
      const handle = el("span", "node-drag-handle", "⠿");
      handle.draggable = true;
      handle.title = "拖动节点及全部后代：行上方 / 中间 / 下方分别是前面 / 子级 / 后面";
      handle.setAttribute("aria-label", `拖动 ${node.title} 调整层级`);
      handle.setAttribute("role", "button");
      handle.tabIndex = 0;
      handle.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); openPlacement("move", node.path);
      });
      handle.addEventListener("dragstart", event => {
        if (!mayNavigate()) { event.preventDefault(); return; }
        clearDrag();
        draggedPath = node.path.slice();
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", C.keyOf(node.path));
        $("dragHint").hidden = false;
        $("dragHint").textContent = `正在移动 ${node.title}`;
      });
      handle.addEventListener("dragend", clearDrag);
      treeCell.append(handle, selectButton); heading.append(treeCell);
      for (const column of columns) {
        const key = column.label ? C.nodeLabelKey(node.value) || configuredLabelKey() : column.key;
        const missing = !Object.hasOwn(node.value, key);
        // An alias shown in its own extra column must not duplicate the primary label.
        const aliasAlreadyShown = column.extra && key === "lable_name" && C.nodeLabelKey(node.value) === key;
        if (aliasAlreadyShown || (missing && !column.label)) {
          const absent = el("span", "node-absent", "—"); absent.title = "此节点没有该字段"; heading.append(absent);
        } else {
          const cell = field([...node.path, key], missing ? "" : node.value[key], { compact: true, table: true, optional: missing && column.label });
          cell.dataset.column = column.key;
          if (column.label) cell.classList.add("node-label");
          if (key === "last_output") cell.classList.add("node-address");
          heading.append(cell);
        }
      }
      const count = el("span", "node-count", node.childCount ? `${node.childCount} / ${node.descendants}` : "叶节点");
      count.title = node.childCount ? `${node.childCount} 个直属子节点 / ${node.descendants} 个后代` : "没有子节点";
      const details = button("↗", () => openDetails(node.path), "node-details");
      details.title = "打开完整参数"; details.setAttribute("aria-label", `节点详细配置 ${node.title}`);
      const shortcuts = el("div", "node-shortcuts");
      const copy = button("复制", () => copyToClipboard(node.path), "copy-node");
      copy.title = "复制单个节点，不包含子节点";
      copy.setAttribute("aria-label", `复制单节点 ${node.title}`);
      const copySubtree = button("复制子树", () => copyToClipboard(node.path, true), "copy-subtree-node");
      copySubtree.title = "复制当前节点及全部后代";
      copySubtree.setAttribute("aria-label", `复制节点及全部子节点 ${node.title}`);
      const paste = button("粘贴", () => openPlacement("paste", node.path), "paste-node");
      paste.disabled = !clipboard;
      paste.title = "将已复制节点插入此处：前、后、子级或父级";
      shortcuts.append(copy, copySubtree, paste);
      for (const [label, symbol, offset, cls] of [["上移", "↑", -1, "move-up"], ["下移", "↓", 1, "move-down"]]) {
        const move = button(symbol, () => graphAction(node.path, () => {
          if (doc.move(node.path, offset)) selected = [...node.path.slice(0, -1), node.path.at(-1) + offset];
        }), cls);
        move.title = `${label}：调整同级顺序，携带全部后代`;
        move.setAttribute("aria-label", `${label}子树 ${node.title}`);
        move.disabled = node.path.at(-1) + offset < 0 || node.path.at(-1) + offset >= doc.node(node.path.slice(0, -1)).value.length;
        shortcuts.append(move);
      }
      const add = button("＋ 子项", () => graphAction(node.path, () => {
          const children = [...node.path, "childlist"], index = doc.node(children).value.length;
          doc.insert(children, index, JSON.stringify(newNode())); selected = [...children, index];
          requestAnimationFrame(locateSelected);
        }), "add-child");
      add.title = "新增直属子节点";
      const remove = button("删除", () => deleteSingle(node.path), "danger delete-node");
      remove.title = "只删除本节点，子节点按原顺序上提，保留后代";
      const outdent = button("⇤", () => structureAction(() => doc.outdentNode(node.path)), "outdent-node");
      outdent.title = "升一级：移动到父节点后面，携带后代"; outdent.setAttribute("aria-label", "升一级"); outdent.disabled = node.path.length <= 2;
      const indent = button("⇥", () => structureAction(() => doc.indentNode(node.path)), "indent-node");
      indent.title = "降一级：成为前一个同级节点的子节点，携带后代"; indent.setAttribute("aria-label", "降一级"); indent.disabled = node.path.at(-1) === 0;
      const level = button("层级", () => openPlacement("move", node.path), "relocate-node"); level.title = "选择任意目标，调整父节点或插入位置";
      const expand = button("⋁", () => {
          if (mayNavigate()) { expandSubtree(node.path); renderGraph(); }
        }, "expand-subtree");
      expand.title = "展开全部后代"; expand.setAttribute("aria-label", "展开此子树"); expand.disabled = !node.childCount;
      shortcuts.append(outdent, indent, level, add, remove, expand, details);
      heading.append(count, shortcuts); card.append(heading);
      card.addEventListener("focusin", () => selectTableRow(node.path));
      card.addEventListener("click", event => { if (!event.target.closest("button,input,select,textarea,label")) selectTableRow(node.path); });
      card.addEventListener("dragover", event => dragOverNode(event, card, node.path));
      card.addEventListener("drop", event => {
        if (!draggedPath || dropTarget?.card !== card) return;
        event.preventDefault(); event.stopPropagation();
        const source = draggedPath.slice(), position = dropTarget.position;
        clearDrag();
        structureAction(() => doc.moveNode(source, node.path, position));
      });
      branch.append(card);
      if (node.children.length) {
        const children = el("div", "recursive-children");
        children.setAttribute("aria-label", `节点 ${node.title} 的子节点`);
        for (const child of node.children) children.append(renderBranch(child));
        branch.append(children);
      }
      return branch;
    }
    for (const root of roots) container.append(renderBranch(root));
    $("graphVisible").textContent = `显示 ${visibleCount} / ${C.routes(doc.data).length} 个节点`;
    $("pasteRootBtn").disabled = !clipboard;
    $("clipboardStatus").textContent = clipboard ? `已复制${clipboard.subtree ? "子树" : "单节点"}：${clipboard.title}` : "删除仅移除本节点，子节点顺次上提";
    fitColumns(columns);
  }
  function locateSelected() {
    if (!doc || !mayNavigate()) return;
    revealSelected(); graphQuery = ""; $("graphSearch").value = "";
    renderGraph();
    const card = [...$("graphNodes").querySelectorAll(".flow-node")].find(n => n.dataset.nodePath === C.keyOf(selected)) || $("graphNodes").querySelector(".flow-node");
    card?.scrollIntoView({block: "center", inline: "nearest"});
  }
  function card(title, description, action) {
    const result = el("section", "card"), heading = el("div", "section-title"), copy = el("div");
    copy.append(el("h3", "", title)); if (description) copy.append(el("p", "", description));
    heading.append(copy); if (action) heading.append(action); result.append(heading); return result;
  }
  function renderOverview(container) {
    const cameras = card("相机配置", "按车型指定相机范围，原样保留编号及分隔符。", button("＋ 添加相机配置", () => run(() => doc.insert(["camera_config"], doc.data.camera_config.length, '{"train_id":"all","camera_num":""}'))));
    doc.data.camera_config.forEach((camera, i) => {
      const group = el("div", "camera-card"), heading = el("div", "section-title");
      heading.append(el("h3", "", `相机组 ${i + 1}`), button("删除", () => run(() => {
        if (window.confirm(`删除相机组 ${i + 1}？可撤销。`)) doc.remove(["camera_config", i]);
      }), "danger"));
      group.append(heading); const fields = el("div", "fields");
      for (const [key, value] of Object.entries(camera)) fields.append(field(["camera_config", i, key], value));
      group.append(fields); cameras.append(group);
    });
    if (!doc.data.camera_config.length) cameras.append(el("p", "empty", "暂无相机配置"));
    container.append(cameras);
    const lines = card("线路范围", "条目顺序、重复值及 all 标记均按原配置保留。", button("＋ 添加线路", () => run(() => doc.insert(["line_name"], doc.data.line_name.length, '"all"'))));
    doc.data.line_name.forEach((value, i) => {
      const row = el("div", "line-item");
      row.append(field(["line_name", i], value, { title: `线路 ${i + 1}` }), button("删除", () => run(() => doc.remove(["line_name", i])), "danger"));
      lines.append(row);
    });
    if (!doc.data.line_name.length) lines.append(el("p", "empty", "暂无线路条目"));
    container.append(lines);
    const extra = Object.keys(doc.data).filter(key => !["camera_config", "line_name", "model_route"].includes(key));
    if (extra.length) {
      const other = card("扩展配置", "文件中的其他字段完整保留，可以直接编辑。");
      const fields = el("div", "fields");
      for (const key of extra) fields.append(field([key], doc.data[key], { wide: true }));
      other.append(fields); container.append(other);
    }
    container.append(el("p", "muted", "从左侧选择路由节点以编辑模型参数；在“完整 JSON”中可增补任何字段。"));
  }
  function renderNode(container) {
    const node = doc.node(selected).value;
    const actions = el("div", "node-actions");
    actions.append(button("＋ 子节点", () => run(() => {
      const path = [...selected, "childlist"], length = node.childlist.length;
      doc.insert(path, length, JSON.stringify(newNode())); collapsed.delete(C.keyOf(selected)); selected = [...path, length];
    })), button("复制单节点", () => copyToClipboard(selected)), button("粘贴到此处", () => openPlacement("paste", selected), "paste-node"), button("复制子树到剪贴板", () => copyToClipboard(selected, true)), button("复制分支到下一项", () => run(() => {
      const index = selected.at(-1); doc.insert(selected.slice(0, -1), index + 1, doc.raw(selected)); selected = [...selected.slice(0, -1), index + 1];
    })));
    const parentLength = doc.node(selected.slice(0, -1)).value.length;
    for (const [label, offset] of [["上移", -1], ["下移", 1]]) {
      const move = button(label, () => run(() => { if (doc.move(selected, offset)) selected = [...selected.slice(0, -1), selected.at(-1) + offset]; }));
      move.disabled = selected.at(-1) + offset < 0 || selected.at(-1) + offset >= parentLength; actions.append(move);
    }
    actions.querySelector(".paste-node").disabled = !clipboard;
    const outdent = button("升一级", () => structureAction(() => doc.outdentNode(selected)), "outdent-node"); outdent.disabled = selected.length <= 2;
    const indent = button("降一级", () => structureAction(() => doc.indentNode(selected)), "indent-node"); indent.disabled = selected.at(-1) === 0;
    actions.append(outdent, indent, button("移动到…", () => openPlacement("move", selected)), button("删除本节点（保留子节点）", () => deleteSingle(selected), "danger"));
    actions.append(button("删除整棵子树", () => run(() => {
      if (!window.confirm("删除此节点及其全部子节点？可通过撤销恢复。")) return;
      doc.remove(selected); selected = selected.length > 2 ? selected.slice(0, -2) : null;
    }), "danger"));
    const parameters = card("节点参数", "保留字段原类型，空值不会被自动补写。", actions);
    const fields = el("div", "fields");
    for (const [key, value] of Object.entries(node)) {
      if (key !== "childlist") fields.append(field([...selected, key], value, { wide: key === "current_model" || (value !== null && typeof value === "object") }));
    }
    if (!C.nodeLabelKey(node)) fields.append(field([...selected, configuredLabelKey()], "", { optional: true }));
    parameters.append(fields); container.append(parameters);
    const children = card(`下游分支 · ${node.childlist.length}`, "按配置中的执行顺序显示。数量参数 num 由你手动维护。");
    const list = el("div", "child-list");
    node.childlist.forEach((child, i) => {
      const link = button("", () => select([...selected, "childlist", i]), "child-item");
      link.append(el("span", "", `${i + 1}. ${C.nodeTitle(child)}`), el("small", "", `输出 ${child.last_output ?? "—"} →`)); list.append(link);
    });
    if (!node.childlist.length) list.append(el("p", "empty", "当前节点没有下游分支"));
    children.append(list); container.append(children);
  }
  function renderChanges(changes) {
    const container = $("changesView"); container.replaceChildren();
    const title = el("div", "section-title"); title.append(el("h3", "", `相对源文件的修改 · ${changes.length}`), el("p", "", "左侧为源值，右侧为当前值；数组按位置对照。")); container.append(title);
    if (!changes.length) container.append(el("p", "empty", "当前内容与源文件一致。"));
    for (const change of changes) {
      const row = el("div", "change-card"); row.append(el("div", "change-path", pathText(change.path) || "根配置"));
      const grid = el("div", "diff-grid"); grid.append(el("pre", "", change.before ?? "（新增）"), el("pre", "", change.after ?? "（已删除）")); row.append(grid); container.append(row);
    }
  }
  function refresh(form = true) {
    if (!doc) return;
    if (selected) { try { doc.node(selected); } catch { selected = null; } }
    renderTree();
    const changes = updateMeta();
    const selectedNode = selected && C.routes(doc.data).find(n => C.keyOf(n.path) === C.keyOf(selected));
    $("selectionTitle").textContent = selectedNode?.title || "配置概览";
    $("breadcrumb").textContent = selected ? pathText(selected) : "配置工作区 / 全局设置";
    $("nodeKind").textContent = selectedNode ? kindNames[selectedNode.kind] : "全局配置";
    for (const name of ["form", "json", "changes"]) {
      $(`${name}Tab`).setAttribute("aria-selected", String(tab === name));
      $(`${name}View`).hidden = tab !== name;
    }
    if (form) { const container = $("formView"); container.replaceChildren(); if (selected) renderNode(container); else renderOverview(container); }
    if (!jsonPending) $("jsonEditor").value = doc.text;
    if (tab === "changes") renderChanges(changes);
    if (form || $("detailsDialog").open) renderGraph();
    else {
      // Keep all cells mounted during edits, including invalid drafts in other rows.
      for (const card of $("graphNodes").querySelectorAll(".flow-node")) {
        const value = doc.node(JSON.parse(card.dataset.nodePath)).value;
        const title = C.nodeTitle(value);
        const kind = String(value.current_model || "").startsWith("pretreat:") ? "pretreat" : value.current_model ? "model" : "result";
        card.classList.remove("model", "pretreat", "result"); card.classList.add(kind);
        card.querySelector(".dot").className = `dot ${kind}`;
        card.querySelector(".node-select").setAttribute("aria-label", `选中节点 ${title}`);
        card.querySelector(".node-select").title = `上级传入 ${value.last_output ?? "—"} · ${title}\n${pathText(JSON.parse(card.dataset.nodePath))}`;
        card.querySelector(".copy-node").setAttribute("aria-label", `复制单节点 ${title}`);
        card.querySelector(".copy-subtree-node").setAttribute("aria-label", `复制节点及全部子节点 ${title}`);
        card.querySelector(".move-up").setAttribute("aria-label", `上移子树 ${title}`);
        card.querySelector(".move-down").setAttribute("aria-label", `下移子树 ${title}`);
      }
      scheduleWidths();
    }
  }
  $("detailsBtn").addEventListener("click", () => openDetails());
  $("graphOverviewBtn").addEventListener("click", () => openDetails(null));
  $("pasteRootBtn").addEventListener("click", () => openPlacement("paste"));
  $("closePlacementBtn").addEventListener("click", () => $("placementDialog").close());
  $("cancelPlacementBtn").addEventListener("click", () => $("placementDialog").close());
  $("placementTarget").addEventListener("change", event => { $("placementPosition").disabled = event.target.value === "root"; });
  $("placementForm").addEventListener("submit", event => {
    event.preventDefault();
    const mode = placement.mode;
    const targetValue = $("placementTarget").value;
    const target = targetValue === "root" ? null : JSON.parse(targetValue);
    const position = $("placementPosition").value;
    try {
      const ok = structureAction(() => mode === "move" ? doc.moveNode(placement.source, target, targetValue === "root" ? "root" : position) : doc.pasteNode(clipboard.raw, target, targetValue === "root" ? "root" : position));
      if (ok) $("placementDialog").close();
      else $("placementError").textContent = $("status").textContent;
    } catch (error) { $("placementError").textContent = error.message; }
  });
  $("closeDetailsBtn").addEventListener("click", closeDetails);
  for (const [detail, main] of [["detailUndoBtn", "undoBtn"], ["detailRedoBtn", "redoBtn"], ["detailSaveBtn", "saveBtn"]]) $(detail).addEventListener("click", () => $(main).click());
  $("detailsDialog").addEventListener("cancel", event => { event.preventDefault(); closeDetails(); });
  $("graphSearch").addEventListener("input", () => {
    if (!mayNavigate()) { $("graphSearch").value = graphQuery; return; }
    graphQuery = $("graphSearch").value; renderGraph(); $("graphViewport").scrollTo(0, 0);
  });
  $("branchOverviewBtn").addEventListener("click", () => {
    if (!mayNavigate()) return;
    graphCollapsed = branchOverview(); graphQuery = ""; $("graphSearch").value = "";
    selected = null; refresh(); $("graphViewport").scrollTo(0, 0);
  });
  $("graphExpand").addEventListener("click", () => { if (mayNavigate()) { graphCollapsed.clear(); renderGraph(); } });
  $("graphCollapse").addEventListener("click", () => {
    if (!mayNavigate()) return;
    graphQuery = ""; $("graphSearch").value = "";
    graphCollapsed = new Set(C.routes(doc.data).map(n => C.keyOf(n.path)));
    selected = null; refresh(); $("graphViewport").scrollTo(0, 0);
  });
  $("graphAddRoot").addEventListener("click", () => { $("addRootBtn").click(); requestAnimationFrame(locateSelected); });
  $("graphAddRoot").addEventListener("dragover", event => {
    if (!draggedPath || (draggedPath.length === 2 && draggedPath.at(-1) === doc.data.model_route.length - 1)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    $("graphNodes").querySelectorAll(".drop-before, .drop-child, .drop-after").forEach(row => row.classList.remove("drop-before", "drop-child", "drop-after"));
    dropTarget = null; $("graphAddRoot").classList.add("drop-root");
    $("dragHint").hidden = false; $("dragHint").textContent = "移动到根节点列表末尾";
  });
  $("graphAddRoot").addEventListener("drop", event => {
    if (!draggedPath || !$("graphAddRoot").classList.contains("drop-root")) return;
    event.preventDefault();
    const source = draggedPath.slice(); clearDrag();
    structureAction(() => doc.moveNode(source, null, "root"));
  });
  $("locateNode").addEventListener("click", locateSelected);
  $("openBtn").addEventListener("click", chooseFile);
  $("welcomeOpenBtn").addEventListener("click", chooseFile);
  $("fileInput").addEventListener("change", event => openFile(event.target.files[0]));
  $("overviewBtn").addEventListener("click", () => select(null));
  $("searchInput").addEventListener("input", () => doc && renderTree());
  $("expandBtn").addEventListener("click", () => { collapsed.clear(); renderTree(); });
  $("collapseBtn").addEventListener("click", () => { collapsed = new Set(C.routes(doc.data).map(n => C.keyOf(n.path))); renderTree(); });
  $("addRootBtn").addEventListener("click", () => run(() => {
    const node = newNode(); node.last_output = "root";
    const index = doc.data.model_route.length; doc.insert(["model_route"], index, JSON.stringify(node)); selected = ["model_route", index]; tab = "form";
  }));
  $("undoBtn").addEventListener("click", () => run(() => { doc.undo(); status("已撤销上一步修改。"); }));
  $("redoBtn").addEventListener("click", () => run(() => { doc.redo(); status("已重做。"); }));
  for (const name of ["form", "json", "changes"]) $(`${name}Tab`).addEventListener("click", () => {
    if (mayNavigate()) { tab = name; refresh(); }
  });
  $("jsonEditor").addEventListener("input", () => {
    const normalized = $("jsonEditor").value.replace(/\r\n|\r|\n/g, doc.format.newline);
    jsonPending = normalized !== doc.text; $("jsonError").textContent = ""; updateMeta();
    status(jsonPending ? "JSON 文本尚未应用，请点击“应用 JSON”。" : "JSON 与当前配置一致。");
  });
  $("applyJsonBtn").addEventListener("click", () => {
    try {
      doc.commit($("jsonEditor").value.replace(/\r\n|\r|\n/g, doc.format.newline));
      jsonPending = false; $("jsonError").textContent = ""; refresh(); status("JSON 已应用，路由与参数已同步。");
    } catch (error) { $("jsonError").textContent = error.message; status("JSON 未应用，请修正错误。", true); }
  });
  $("discardJsonBtn").addEventListener("click", () => {
    if (jsonPending && !window.confirm("放弃尚未应用的 JSON 文本修改？")) return;
    jsonPending = false; $("jsonError").textContent = ""; refresh(); status("已恢复当前配置的 JSON。");
  });
  $("saveBtn").addEventListener("click", () => {
    if (!doc || !mayNavigate()) return;
    if (typeof window.showDirectoryPicker !== "function") {
      status("当前浏览器不支持安全另存。请使用 Edge / Chrome，并通过 localhost 或 HTTPS 打开此页面；文件尚未写入。", true); return;
    }
    $("saveName").value = C.defaultName(doc.name); $("saveError").textContent = "";
    $("saveEncoding").textContent = `输出：${encodingLabel()}，保持源换行方式。`;
    $("saveDialog").showModal();
  });
  function closeSave() { if (!saving) $("saveDialog").close(); }
  $("closeSaveBtn").addEventListener("click", closeSave);
  $("cancelSaveBtn").addEventListener("click", closeSave);
  $("saveDialog").addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  $("saveForm").addEventListener("submit", async event => {
    event.preventDefault(); if (saving) return;
    const name = $("saveName").value;
    try { C.validateName(name, doc.name); } catch (error) { $("saveError").textContent = error.message; return; }
    const snapshot = doc.text, bytes = doc.exportBytes();
    saving = true; $("confirmSaveBtn").disabled = true; $("saveError").textContent = ""; updateMeta();
    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite", id: "model-config-export" });
      await C.saveNewFile(directory, name, doc.name, bytes);
      doc.markSaved(snapshot); $("saveDialog").close(); status(`已创建 ${name}，${encodingLabel()}。源文件未改动。`);
    } catch (error) {
      if (error.name === "AbortError") status("已取消另存，配置仍保留在编辑器中。");
      else { $("saveError").textContent = error.message; status(`另存失败：${error.message}`, true); }
    } finally { saving = false; $("confirmSaveBtn").disabled = false; updateMeta(); }
  });
  window.addEventListener("beforeunload", event => {
    const focused = document.activeElement;
    if (focused?.dataset.path) focused.dispatchEvent(new Event("change"));
    if (saving || doc?.dirty || hasDraft()) { event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("keydown", event => {
    if (!doc || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "s") { event.preventDefault(); document.activeElement?.blur(); $("saveBtn").click(); }
    if (!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && event.key.toLowerCase() === "z") {
      event.preventDefault(); (event.shiftKey ? $("redoBtn") : $("undoBtn")).click();
    }
  });
})();
