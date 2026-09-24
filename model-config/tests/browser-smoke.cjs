// Usage: node model-config/tests/browser-smoke.cjs <reference.json> <artifact-directory>
// Uses an installed Chromium browser and Node's built-in CDP/WebSocket support.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const C = require("../core.js");
const root = path.resolve(__dirname, "../..");
const sourcePath = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
const browserPath = process.env.MODEL_CONFIG_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
fs.mkdirSync(artifacts, { recursive: true });
const originalHash = createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description) {
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch {} await pause(100); }
  throw new Error(`Timed out: ${description}`);
}
let browser, ws;
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "");
  const file = path.resolve(root, relative || "index.html");
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(bytes);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(artifacts, "edge-profile-"));
  browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  browser.on("error", error => { console.error(error); });
  const port = await until(() => fs.existsSync(path.join(profile, "DevToolsActivePort")) && fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0], "browser port");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) })).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser WebSocket timed out")), 10000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Browser WebSocket failed")); }, { once: true });
  });
  let nextId = 0;
  const pending = new Map(), exceptions = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id); pending.delete(message.id);
      if (!entry) return;
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + " " + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const input = (selector, value, event = "change") => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); input.focus(); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const screenshot = async name => {
    const result = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(artifacts, name + ".png"), Buffer.from(result.data, "base64"));
  };
  const loadFile = async file => {
    const { root: dom } = await call("DOM.getDocument");
    const { nodeId } = await call("DOM.querySelector", { nodeId: dom.nodeId, selector: "#fileInput" });
    await call("DOM.setFileInputFiles", { nodeId, files: [file] });
    await until(() => evaluate(`document.getElementById('fileName').textContent === ${JSON.stringify(path.basename(file))}`), "file loaded");
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: url + "/model-config/index.html" });
  await until(() => evaluate("!!window.ModelConfigCore"), "model config page");
  await screenshot("model-config-welcome");
  await loadFile(sourcePath);
  const expected = C.createDocument(fs.readFileSync(sourcePath), path.basename(sourcePath));
  assert.equal(await evaluate("Number(document.getElementById('routeCount').textContent)"), C.routes(expected.data).length);
  assert.equal(await evaluate("document.getElementById('fileFormat').textContent"), "UTF-8 · 无 BOM");
  assert.equal(await evaluate("document.getElementById('detailsDialog').open"), false);
  await until(() => evaluate("document.querySelector('.recursive-children') !== null"), "graph layout");
  await screenshot("model-config-canvas");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.flow-node')).every(card =>
    card.querySelectorAll('input,select').length === 7 &&
    Array.from(card.querySelectorAll('input,select')).every(input => input.getBoundingClientRect().height > 0))`), true);
  assert.equal(await evaluate("document.querySelectorAll('.flow-node.selected').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('#graphTableHeader > span').length"), 10);
  // Check every visible incoming index and label against the real source, including
  // dw_ls_1.onnx output 0 -> 安装底座 (the source uses lable_name).
  const visibleLabels = await evaluate(`Array.from(document.querySelectorAll('.flow-node'), card => ({
    path: JSON.parse(card.dataset.nodePath),
    index: card.querySelector('.node-address input').value,
    label: card.querySelector('.node-label input').value,
    adjacent: card.querySelector('.node-address').nextElementSibling === card.querySelector('.node-label'),
    hidden: card.querySelector('.node-label').hidden
  }))`);
  for (const row of visibleLabels) {
    const node = row.path.reduce((value, key) => value[key], expected.data);
    assert.equal(row.index, String(node.last_output ?? "—"));
    assert.equal(row.label, C.nodeLabel(node));
    assert.equal(row.adjacent, true);
    assert.equal(row.hidden, false);
  }
  const installationRoot = expected.data.model_route.findIndex(node => node.current_model === "dw_ls_1.onnx");
  if (installationRoot >= 0) {
    const branch = expected.data.model_route[installationRoot].childlist.findIndex(node => String(node.last_output) === "0");
    const row = visibleLabels.find(row => JSON.stringify(row.path) === JSON.stringify(["model_route", installationRoot, "childlist", branch]));
    assert.ok(row, "dw_ls_1.onnx output 0 is visible");
    assert.equal(row.label, "安装底座");
    await screenshot("model-config-installation-base");
  }
  const overviewCount = expected.data.model_route.reduce((sum, root) => sum + 1 + root.childlist.length, 0);
  assert.equal(await evaluate("document.querySelectorAll('.flow-node').length"), overviewCount);
  // Row actions work directly on an unselected child and include all descendants.
  const firstChildPath = ["model_route", 0, "childlist", 0];
  const childAction = (path, action) => evaluate(`Array.from(document.querySelectorAll('.flow-node')).find(card => card.dataset.nodePath === ${JSON.stringify(JSON.stringify(path))}).querySelector(${JSON.stringify(action)}).click()`);
  const readConfig = async () => JSON.parse(await evaluate("document.getElementById('jsonEditor').value"));
  const dragStart = path => evaluate(`(() => {
    const card = [...document.querySelectorAll('.flow-node')].find(row => row.dataset.nodePath === ${JSON.stringify(JSON.stringify(path))});
    window.__dragHandle = card.querySelector('.node-drag-handle');
    window.__dragTransfer = new DataTransfer();
    return window.__dragHandle.dispatchEvent(new DragEvent('dragstart', {bubbles:true,cancelable:true,dataTransfer:window.__dragTransfer}));
  })()`);
  const dragHover = (target, position) => evaluate(`(() => {
    const card = ${target === null ? "document.getElementById('graphAddRoot')" : `[...document.querySelectorAll('.flow-node')].find(row => row.dataset.nodePath === ${JSON.stringify(JSON.stringify(target))})`};
    const rect = card.getBoundingClientRect();
    const ratio = ${position === "before" ? 0.1 : position === "after" ? 0.9 : 0.5};
    card.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:window.__dragTransfer,clientY:rect.top + rect.height * ratio}));
    window.__dropCard = card;
    return {marked:card.classList.contains(${JSON.stringify(target === null ? "drop-root" : `drop-${position}`)}),hint:document.getElementById('dragHint').textContent};
  })()`);
  const dragEnd = drop => evaluate(`(() => {
    if (${drop}) window.__dropCard.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:window.__dragTransfer}));
    window.__dragHandle.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:window.__dragTransfer}));
    delete window.__dragHandle; delete window.__dragTransfer; delete window.__dropCard;
  })()`);
  const place = async (position, target) => {
    if (target !== undefined) await input("#placementTarget", target === null ? "root" : JSON.stringify(target));
    await input("#placementPosition", position);
    await click("confirmPlacementBtn");
    assert.equal(await evaluate("document.getElementById('placementDialog').open"), false);
  };
  const stripes = () => evaluate(`(() => {
    const rows = [...document.querySelectorAll('.flow-node')];
    return rows.every((row,i) => row.classList.contains('alternate') === (i % 2 === 1));
  })()`);
  assert.equal(await stripes(), true);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.flow-node')).every(row => row.querySelector('.node-drag-handle[draggable=true]'))"), true);
  const secondDragPath = ["model_route",0,"childlist",1];
  const pointerDrag = async (source, target) => {
    const points = await evaluate(`(() => {
      const row = path => [...document.querySelectorAll('.flow-node')].find(card => card.dataset.nodePath === JSON.stringify(path));
      const from = row(${JSON.stringify(source)}).querySelector('.node-drag-handle').getBoundingClientRect();
      const to = row(${JSON.stringify(target)}).getBoundingClientRect();
      return {start:{x:from.left + from.width / 2,y:from.top + from.height / 2},end:{x:to.left + 110,y:to.top + to.height / 2}};
    })()`);
    await call("Input.dispatchMouseEvent", {type:"mouseMoved",...points.start});
    await call("Input.dispatchMouseEvent", {type:"mousePressed",...points.start,button:"left",buttons:1,clickCount:1});
    for (let i = 1; i <= 8; i++) await call("Input.dispatchMouseEvent", {type:"mouseMoved",x:points.start.x + (points.end.x - points.start.x) * i / 8,y:points.start.y + (points.end.y - points.start.y) * i / 8,button:"left",buttons:1});
    const marked = await evaluate(`[...document.querySelectorAll('.flow-node')].find(card => card.dataset.nodePath === ${JSON.stringify(JSON.stringify(target))}).classList.contains('drop-child')`);
    await call("Input.dispatchMouseEvent", {type:"mouseReleased",...points.end,button:"left",buttons:0,clickCount:1});
    return marked;
  };
  assert.equal(await pointerDrag(secondDragPath, firstChildPath), true, "real pointer drag must show the child drop target");
  assert.deepEqual((await readConfig()).model_route[0].childlist[0].childlist.at(-1), expected.data.model_route[0].childlist[1]);
  await click("undoBtn");
  await dragStart(secondDragPath);
  assert.equal((await dragHover(firstChildPath, "child")).marked, true);
  assert.match((await evaluate("document.getElementById('dragHint').textContent")), /子节点/);
  await screenshot("model-config-drag-child-target");
  await dragEnd(true);
  assert.deepEqual((await readConfig()).model_route[0].childlist[0].childlist.at(-1), expected.data.model_route[0].childlist[1]);
  await click("undoBtn");
  assert.deepEqual(await readConfig(), expected.data);
  for (const [source,target,position] of [[firstChildPath,secondDragPath,"after"],[secondDragPath,firstChildPath,"before"]]) {
    await dragStart(source);
    assert.equal((await dragHover(target, position)).marked, true);
    await dragEnd(true);
    assert.deepEqual((await readConfig()).model_route[0].childlist.slice(0,2), [expected.data.model_route[0].childlist[1],expected.data.model_route[0].childlist[0]]);
    await click("undoBtn");
  }
  await dragStart(firstChildPath);
  assert.equal((await dragHover(null, "root")).marked, true);
  await dragEnd(true);
  assert.deepEqual((await readConfig()).model_route.at(-1), expected.data.model_route[0].childlist[0]);
  await click("undoBtn");
  await dragStart(["model_route",0]);
  assert.equal((await dragHover(firstChildPath, "child")).marked, false);
  await dragEnd(true);
  assert.deepEqual(await readConfig(), expected.data, "dragging into a descendant must not change the tree");
  assert.equal(await evaluate("document.getElementById('dragHint').hidden"), true);
  await evaluate(`(() => {const handle=document.querySelector('.node-drag-handle');handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
  assert.equal(await evaluate("document.getElementById('placementDialog').open"), true);
  await evaluate("document.getElementById('placementDialog').close()");
  const widthOf = column => evaluate(`document.querySelector('#graphTableHeader').children[${column}].getBoundingClientRect().width`);
  const baseWidth = await widthOf(3);
  const longModel = '特别长的模型名称_'.repeat(22) + '.onnx';
  const modelField = '#graphNodes input[data-path=\'["model_route",0,"current_model"]\']';
  await input(modelField,longModel,"input");
  await until(async()=>await widthOf(3)>baseWidth+200,"auto width while typing");
  assert.deepEqual(await readConfig(),expected.data,"typing changes width before committing data");
  await input(modelField,longModel);
  await click("undoBtn");
  await until(async()=>Math.abs(await widthOf(3)-baseWidth)<1,"auto width shrinks after undo");
  // Real typing followed by Tab commits an unselected child's cell without mounting an editor.
  const directCell = '#graphNodes input[data-path=\'["model_route",0,"childlist",0,"confidence"]\']';
  await evaluate(`(() => {const cell=document.querySelector(${JSON.stringify(directCell)}); cell.focus(); cell.select();})()`);
  await call("Input.insertText", {text:"0.64"});
  await call("Input.dispatchKeyEvent", {type:"keyDown", key:"Tab", code:"Tab", windowsVirtualKeyCode:9});
  await call("Input.dispatchKeyEvent", {type:"keyUp", key:"Tab", code:"Tab", windowsVirtualKeyCode:9});
  assert.equal((await readConfig()).model_route[0].childlist[0].confidence, "0.64");
  assert.equal(await evaluate("document.activeElement.tagName"), "SELECT");
  await click("undoBtn");
  assert.equal(await evaluate("document.querySelector('.recursive-children .move-up').disabled"), true);
  await childAction(firstChildPath, ".copy-node");
  assert.deepEqual(await readConfig(), expected.data, "copying alone must not edit JSON");
  await childAction(firstChildPath, ".paste-node");
  await place("after");
  let changed = await readConfig();
  assert.deepEqual(changed.model_route[0].childlist, [expected.data.model_route[0].childlist[0], {...expected.data.model_route[0].childlist[0],childlist:[]}, ...expected.data.model_route[0].childlist.slice(1)]);
  await input(`#graphNodes input[data-path='${JSON.stringify(["model_route", 0, "childlist", 1, C.nodeLabelKey(changed.model_route[0].childlist[1]) || "label_name"])}']`, "复制后的标签");
  await childAction(["model_route", 0, "childlist", 1], ".move-down");
  changed = await readConfig();
  assert.equal(C.nodeLabel(changed.model_route[0].childlist[2]), "复制后的标签");
  assert.deepEqual(changed.model_route[0].childlist[2].childlist, []);
  assert.deepEqual(changed.model_route[0].childlist[1], expected.data.model_route[0].childlist[1]);
  await childAction(["model_route", 0, "childlist", 2], ".move-up");
  assert.equal(C.nodeLabel((await readConfig()).model_route[0].childlist[1]), "复制后的标签");
  await screenshot("model-config-child-actions");
  for (let i = 0; i < 4; i++) await click("undoBtn");
  assert.equal(await evaluate("document.getElementById('jsonEditor').value"), expected.text.replace(/\r\n|\r/g, "\n"));
  assert.equal(await evaluate("document.getElementById('changeCount').textContent"), "0");
  await evaluate("window.confirm = () => true");
  // Deleting a real pretreatment node retains its downstream chain and all siblings.
  await childAction(firstChildPath, ".delete-node");
  changed = await readConfig();
  assert.deepEqual(changed.model_route[0].childlist, [...expected.data.model_route[0].childlist[0].childlist, ...expected.data.model_route[0].childlist.slice(1)]);
  assert.equal(C.routes(changed).length, C.routes(expected.data).length - 1);
  await click("undoBtn");
  const secondChild = ["model_route",0,"childlist",1];
  await childAction(secondChild, ".indent-node");
  assert.deepEqual((await readConfig()).model_route[0].childlist[0].childlist.at(-1), expected.data.model_route[0].childlist[1]);
  await click("undoBtn");
  await childAction(firstChildPath, ".outdent-node");
  assert.deepEqual((await readConfig()).model_route[1], expected.data.model_route[0].childlist[0]);
  await click("undoBtn");
  await childAction(firstChildPath, ".relocate-node");
  assert.equal(await evaluate(`Array.from(document.getElementById('placementTarget').options).some(o=>o.value.startsWith('["model_route",0,"childlist",0,'))`), false);
  await place("child",secondChild);
  assert.deepEqual((await readConfig()).model_route[0].childlist[0].childlist.at(-1), expected.data.model_route[0].childlist[0]);
  await click("undoBtn");
  // A clipboard snapshot survives source edits; parent insertion adds only that node.
  await childAction(firstChildPath, ".copy-node");
  await childAction(secondChild, ".paste-node");
  await screenshot("model-config-paste-options");
  await place("parent");
  assert.deepEqual((await readConfig()).model_route[0].childlist[1].childlist[0], expected.data.model_route[0].childlist[1]);
  assert.equal(C.routes(await readConfig()).length, C.routes(expected.data).length + 1);
  await click("undoBtn");
  await click("pasteRootBtn"); await place("after",null);
  assert.deepEqual((await readConfig()).model_route.at(-1), {...expected.data.model_route[0].childlist[0],childlist:[]});
  await click("undoBtn");
  assert.deepEqual(await readConfig(),expected.data);
  await click("branchOverviewBtn");
  // A complete branch should fit in one desktop viewport, without hiding its descendants.
  await evaluate("document.querySelector('.recursive-children .node-fold').click()");
  const density = await evaluate(`(() => {
    const branch=document.querySelector('#graphNodes > .recursive-branch > .recursive-children > .recursive-branch');
    return {rowHeight:Math.max(...[...document.querySelectorAll('.flow-node')].map(n=>n.getBoundingClientRect().height)), branchHeight:branch.getBoundingClientRect().height, branchNodes:branch.querySelectorAll('.flow-node').length, viewportHeight:document.getElementById('graphViewport').clientHeight};
  })()`);
  assert.ok(density.rowHeight <= 34, JSON.stringify(density));
  assert.equal(density.branchNodes, C.routes({model_route:[expected.data.model_route[0].childlist[0]]}).length);
  assert.ok(density.branchHeight < density.viewportHeight, JSON.stringify(density));
  console.log("Compact tree metrics:", JSON.stringify(density));
  await screenshot("model-config-compact-branch");
  // Columns line up across depths, and each rendered value fits its content-sized cell.
  assert.equal(await evaluate(`(() => {
    const columns = [...document.querySelectorAll('#graphTableHeader > span')];
    return [...document.querySelectorAll('.flow-node-heading')].every(row => [...row.children].every((cell, i) =>
      Math.abs(cell.getBoundingClientRect().left - columns[i].getBoundingClientRect().left) < 1));
  })()`), true);
  assert.equal(await stripes(), true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('#graphNodes input')).every(input => input.scrollWidth <= input.clientWidth + 1)`), true);
  await call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await screenshot("model-config-table-1920");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await click("branchOverviewBtn");
  assert.equal(await evaluate("document.querySelectorAll('.flow-node').length"), overviewCount);
  await click("graphExpand");
  const deepNode = C.routes(expected.data).find(node => node.depth >= 3 && node.value.code);
  assert.ok(deepNode, "reference includes a nested result node");
  await evaluate(`(() => {const card=[...document.querySelectorAll('.flow-node')].find(n=>n.dataset.nodePath===${JSON.stringify(JSON.stringify(deepNode.path))});card.querySelector('.node-select').click();})()`);
  await click("locateNode");
  const deepPath = [...deepNode.path, "code"];
  const deepSelector = `#graphNodes input[data-path='${JSON.stringify(deepPath)}']`;
  await input(deepSelector, "nested-edit");
  const deepEdited = JSON.parse(await evaluate("document.getElementById('jsonEditor').value"));
  assert.equal(deepPath.reduce((value, key) => value[key], deepEdited), "nested-edit");
  assert.equal(deepEdited.model_route[0].current_model, expected.data.model_route[0].current_model);
  await screenshot("model-config-deep-node");
  await click("undoBtn");
  assert.equal(await evaluate("document.getElementById('changeCount').textContent"), "0");
  await evaluate("document.querySelector('.node-select').click()");
  await click("locateNode");
  const selector = '#graphNodes input[data-path=\'["model_route",0,"confidence"]\']';
  const sourceLabelKey = C.nodeLabelKey(expected.data.model_route[0]) || C.routes(expected.data).map(node => C.nodeLabelKey(node.value)).find(Boolean) || "label_name";
  const labelSelector = `#graphNodes input[data-path='["model_route",0,"${sourceLabelKey}"]']`;
  const outputSelector = '#graphNodes input[data-path=\'["model_route",0,"last_output"]\']';
  const beforeLabel = await evaluate("document.getElementById('jsonEditor').value");
  const originalRootLabel = expected.data.model_route[0][sourceLabelKey];
  await input(labelSelector, String(originalRootLabel ?? ""));
  assert.equal(await evaluate("document.getElementById('jsonEditor').value"), beforeLabel);
  await input(labelSelector, "新增标签");
  assert.equal(await evaluate("document.querySelector('.flow-node.selected .node-label input').value"), "新增标签");
  assert.equal(await evaluate("document.querySelector('.flow-node.selected .node-address input').value"), String(expected.data.model_route[0].last_output));
  await click("undoBtn");
  assert.equal(await evaluate("document.getElementById('jsonEditor').value"), beforeLabel);
  assert.ok(await evaluate("document.querySelector('.flow-node.selected').getBoundingClientRect().height") <= 34);
  await input(selector, "0.73");
  assert.equal(await evaluate("document.getElementById('changeCount').textContent"), "1");
  await click("detailsBtn");
  assert.equal(await evaluate("document.getElementById('detailsDialog').open"), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector.replace("#graphNodes", "#formView"))}).value`), "0.73");
  await click("changesTab");
  assert.match(await evaluate("document.getElementById('changesView').textContent"), /0\.73/);
  await click("formTab");
  await screenshot("model-config-details");
  await click("closeDetailsBtn");
  await click("undoBtn");
  assert.equal(await evaluate("document.getElementById('changeCount').textContent"), "0");
  await click("redoBtn");
  await evaluate("document.querySelector('.flow-node.selected .add-child').click()");
  assert.ok(await evaluate(`document.querySelector('.flow-node.selected input[data-path*=${JSON.stringify(sourceLabelKey)}]') !== null`));
  assert.equal(await evaluate("Number(document.getElementById('routeCount').textContent)"), C.routes(expected.data).length + 1);
  await click("undoBtn");
  await input("#graphSearch", "pretreat:", "input");
  assert.ok(await evaluate("document.querySelectorAll('.flow-node.matched').length > 0"));
  assert.equal(await stripes(), true);
  await input("#graphSearch", "", "input");
  await click("graphExpand");
  assert.equal(await evaluate("document.querySelectorAll('.flow-node').length"), C.routes(expected.data).length);
  assert.equal(await stripes(), true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('#graphNodes input')).every(input => input.scrollWidth <= input.clientWidth + 1)`), true);
  assert.equal(await evaluate(`(() => {
    return [...document.querySelectorAll('.recursive-branch')].every(branch => {
      const path = JSON.parse(branch.dataset.branchPath);
      const parent = branch.parentElement.closest('.recursive-branch');
      return path.length === 2 ? parent === null : parent?.dataset.branchPath === JSON.stringify(path.slice(0,-2));
    });
  })()`), true);
  await screenshot("model-config-recursive-tree");
  await evaluate("document.getElementById('graphViewport').scrollTop = 500");
  await until(() => evaluate("Math.abs(document.getElementById('graphTableHeader').getBoundingClientRect().top - document.getElementById('graphViewport').getBoundingClientRect().top) < 1"), "sticky table header");
  await evaluate("document.getElementById('graphViewport').scrollTop = 0");
  // Folding a nested node must retain its parent and siblings.
  await evaluate("document.querySelector('.recursive-children .node-fold').click()");
  assert.equal(await evaluate("document.querySelectorAll('#graphNodes > .recursive-branch > .recursive-children > .recursive-branch').length"), expected.data.model_route[0].childlist.length);
  assert.ok(await evaluate("document.querySelectorAll('.flow-node').length") < C.routes(expected.data).length);
  await click("graphExpand");
  await click("graphCollapse");
  assert.equal(await evaluate("document.querySelectorAll('.flow-node').length"), expected.data.model_route.length);
  await click("graphExpand");
  await evaluate("document.querySelector('.node-select').click()");
  await click("locateNode");
  await screenshot("model-config-node-1440");
  for (const width of [1920, 1180, 980, 640]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 980, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, `horizontal overflow at ${width}`);
    await screenshot(`model-config-node-${width}`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await click("detailsBtn");
  await click("jsonTab");
  await input("#jsonEditor", "{ invalid", "input");
  await click("applyJsonBtn");
  assert.ok(await evaluate("document.getElementById('jsonError').textContent.length > 0"));
  assert.equal(await evaluate("document.getElementById('saveBtn').disabled"), true);
  await evaluate("window.confirm = () => true");
  await click("discardJsonBtn");
  await click("closeDetailsBtn");
  // Browser boundary: exercise the real save dialog and exact bytes against a fake
  // directory. Actual source is only read by the file input throughout this test.
  await evaluate(`window.savedBytes = null; window.showDirectoryPicker = async () => ({ getFileHandle: async (name, options) => {
    if (!options) throw new DOMException('missing', 'NotFoundError');
    return { createWritable: async () => ({write: async bytes => {window.savedBytes=Array.from(bytes)}, close: async()=>{}, abort: async()=>{}}) };
  } });`);
  await click("saveBtn");
  await input("#saveName", path.basename(sourcePath)); await click("confirmSaveBtn");
  assert.match(await evaluate("document.getElementById('saveError').textContent"), /源文件名/);
  assert.equal(await evaluate("window.savedBytes"), null);
  await input("#saveName", "browser-copy.json"); await click("confirmSaveBtn");
  await until(() => evaluate("window.savedBytes !== null"), "export bytes");
  const output = new Uint8Array(await evaluate("window.savedBytes"));
  const exported = C.createDocument(output, "browser-copy.json");
  assert.equal(exported.format.bom.length, 0); assert.equal(exported.data.model_route[0].confidence, "0.73");
  assert.equal(exported.text, expected.text.replace('"confidence": ""', '"confidence": "0.73"'));
  fs.writeFileSync(path.join(artifacts, "browser-copy.json"), output);
  // Use real browser file-system handles in its isolated test profile too.
  const nativeSave = await evaluate(`(async () => {
    const directory = await navigator.storage.getDirectory();
    const bytes = new Uint8Array(window.savedBytes);
    await ModelConfigCore.saveNewFile(directory, 'native-copy.json', 'source.json', bytes);
    const handle = await directory.getFileHandle('native-copy.json');
    const before = Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    let rejected = false;
    try { await ModelConfigCore.saveNewFile(directory, 'native-copy.json', 'source.json', new Uint8Array([0])); }
    catch (error) { rejected = error.message.includes('已存在'); }
    const after = Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    return {before, after, rejected};
  })()`);
  assert.equal(nativeSave.rejected, true);
  assert.deepEqual(nativeSave.before, Array.from(output));
  assert.deepEqual(nativeSave.after, nativeSave.before);
  // A different configuration has multiple roots, arbitrary fields and numeric /
  // boolean parameters. Nothing depends on the reference file's node count.
  const customNode = {last_output: "root", label_name: "螺母定位", current_model: "other_model.onnx", code: "00001", num: 0, confidence: 0.9, non_defect: false, childlist: [], extension: {enabled: true}};
  const variant = { camera_config: [{train_id: "客车", camera_num: "09", remark: "额外字段"}, {train_id: "货车", camera_num: "11,12"}], line_name: ["甲线", "乙线", "丙线"], model_route: [customNode, {...customNode, current_model: "another.onnx"}], custom: {owner: "测试"} };
  const variantPath = path.join(artifacts, "variant.json"); fs.writeFileSync(variantPath, JSON.stringify(variant, null, 2));
  await loadFile(variantPath);
  const extensionSelector = '#graphNodes textarea[data-path=\'["model_route",0,"extension"]\']';
  assert.match(await evaluate("document.getElementById('graphTableHeader').textContent"), /extension/);
  await input(extensionSelector, '{"enabled":false}');
  assert.equal((await readConfig()).model_route[0].extension.enabled, false);
  await click("undoBtn");
  assert.equal(await evaluate("document.querySelector('.node-label input').value"), "螺母定位");
  await evaluate("document.querySelector('.node-select').click()");
  await click("detailsBtn");
  const detailLabelSelector = '#formView input[data-path=\'["model_route",0,"label_name"]\']';
  await input(detailLabelSelector, "详细标签_更新");
  assert.equal((await readConfig()).model_route[0].label_name, "详细标签_更新");
  await click("closeDetailsBtn");
  assert.equal(await evaluate("document.querySelector('.flow-node.selected .node-label input').value"), "详细标签_更新");
  await click("undoBtn");
  await input('#graphNodes input[data-path=\'["model_route",0,"label_name"]\']', "螺母标签_更新");
  await input(outputSelector, "07");
  assert.equal(await evaluate("document.querySelector('.flow-node.selected .node-label input').value"), "螺母标签_更新");
  assert.equal(await evaluate("document.querySelector('.flow-node.selected .node-address input').value"), "07");
  await input("#graphSearch", "螺母标签_更新", "input");
  assert.equal(await evaluate("document.querySelectorAll('.flow-node').length"), 1);
  await screenshot("model-config-label-name");
  const labelledExport = JSON.parse(await evaluate("document.getElementById('jsonEditor').value"));
  assert.equal(labelledExport.model_route[0].label_name, "螺母标签_更新");
  assert.equal(labelledExport.model_route[0].last_output, "07");
  await input("#graphSearch", "", "input");
  await click("undoBtn"); await click("undoBtn");
  assert.equal(await evaluate("document.getElementById('detailsDialog').open"), false);
  await click("graphOverviewBtn");
  assert.equal(await evaluate("document.querySelectorAll('.camera-card').length"), 2);
  assert.match(await evaluate("document.getElementById('formView').textContent"), /扩展配置/);
  assert.equal(await evaluate("document.getElementById('routeCount').textContent"), "2");
  await click("closeDetailsBtn");
  await evaluate("document.querySelector('.node-select').click()");
  await input(selector, "0.42");
  // Invalid numeric card edits stay visible and block actions that would discard them.
  await input(selector, "not-a-number");
  const beforeBlockedMove = await readConfig();
  await evaluate("document.querySelector('.flow-node.selected .relocate-node').click()");
  assert.equal(await evaluate("document.getElementById('placementDialog').open"), false);
  assert.deepEqual(await readConfig(),beforeBlockedMove);
  const otherLabelSelector = '#graphNodes input[data-path=\'["model_route",1,"label_name"]\']';
  await input(otherLabelSelector, "另一行已编辑");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), "not-a-number");
  assert.equal((await readConfig()).model_route[1].label_name, "另一行已编辑");
  await click("branchOverviewBtn");
  assert.equal(await evaluate("document.querySelector('#graphNodes [aria-invalid=true]') !== null"), true);
  await click("graphCollapse");
  assert.equal(await evaluate("document.querySelector('#graphNodes [aria-invalid=true]') !== null"), true);
  assert.equal(await evaluate("document.getElementById('saveBtn').disabled"), true);
  await input(selector, "0.42");
  await click("undoBtn");
  assert.equal((await readConfig()).model_route[1].label_name, customNode.label_name);
  await evaluate("document.querySelector('.flow-node.selected .copy-node').click()");
  await evaluate("document.querySelector('.flow-node.selected .paste-node').click()");
  await place("after");
  assert.equal(await evaluate("document.getElementById('routeCount').textContent"), "3");
  await evaluate("document.querySelector('.flow-node.selected .delete-node').click()");
  assert.equal(await evaluate("document.getElementById('routeCount').textContent"), "2");
  await click("undoBtn"); await click("undoBtn");
  await evaluate("document.querySelector('.node-select').click()");
  await click("detailsBtn");
  // Escape must commit the focused field before dismissing its detailed editor.
  await evaluate(`(() => {const field=document.querySelector(${JSON.stringify(selector.replace("#graphNodes", "#formView"))});field.focus();field.select();})()`);
  await call("Input.insertText", {text:"0.43"});
  await call("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27});
  await call("Input.dispatchKeyEvent", {type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27});
  assert.equal(await evaluate("document.getElementById('detailsDialog').open"), false);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), "0.43");
  await click("undoBtn");
  await click("detailsBtn");
  await click("jsonTab");
  const variantEdited = JSON.parse(await evaluate("document.getElementById('jsonEditor').value"));
  assert.equal(variantEdited.model_route[0].confidence, 0.42);
  assert.equal(variantEdited.model_route[0].non_defect, false);
  assert.deepEqual(variantEdited.custom, variant.custom);
  await click("closeDetailsBtn");
  await click("undoBtn");
  // Optional labels and other node fields remain absent until explicitly edited.
  const sparse = {camera_config:[], line_name:[], model_route:[{last_output:"root", current_model:"old.onnx", childlist:[]}]};
  const sparsePath = path.join(artifacts, "sparse.json"); fs.writeFileSync(sparsePath, JSON.stringify(sparse));
  await loadFile(sparsePath);
  assert.equal(await evaluate("document.querySelector('.node-label input').value"), "");
  assert.deepEqual(await readConfig(), sparse);
  await input('#graphNodes input[data-path=\'["model_route",0,"label_name"]\']', "旧格式标签");
  assert.equal((await readConfig()).model_route[0].label_name, "旧格式标签");
  await click("undoBtn");
  assert.deepEqual(await readConfig(), sparse);
  // Distinct label aliases are editable independently if both exist in one node.
  const aliases = {...sparse, model_route:[{...customNode, lable_name:"历史标签"}]};
  const aliasesPath = path.join(artifacts, "aliases.json"); fs.writeFileSync(aliasesPath, JSON.stringify(aliases));
  await loadFile(aliasesPath);
  await input('#graphNodes input[data-path=\'["model_route",0,"lable_name"]\']', "修改历史标签");
  assert.equal((await readConfig()).model_route[0].lable_name, "修改历史标签");
  assert.equal((await readConfig()).model_route[0].label_name, customNode.label_name);
  await click("undoBtn");
  for (const target of ["viewer", "field-defect", "model-config"]) {
    await until(() => evaluate("document.readyState === 'complete'"), "navigation scripts ready");
    await input("#appSwitcher", target);
    await until(() => evaluate(`document.readyState === 'complete' && document.body.dataset.app === ${JSON.stringify(target)}`), `switch to ${target}`);
  }
  assert.deepEqual(exceptions, []);
  assert.equal(createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"), originalHash);
  console.log("PASS: content widths (typing/undo/folded nodes), zebra rows, promote-on-delete, indent/outdent/relocate, clipboard insert before/after/parent/root, aligned columns, cross-row drafts, safe byte export, multiple configs and responsive screenshots.");
  console.log("Source SHA256 unchanged:", originalHash);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  if (browser) browser.kill();
  server.closeAllConnections();
  server.close();
});
