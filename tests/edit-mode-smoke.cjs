// Usage: node tests/edit-mode-smoke.cjs <artifact-directory>
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const artifacts = path.resolve(process.argv[2]);
fs.mkdirSync(artifacts, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("Timed out waiting for browser");
}
let browser, ws;
const server = http.createServer((req, res) => {
  const file = path.resolve(root, new URL(req.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    // Expose state only in the test server, so assertions inspect exported data too.
    if (file === path.join(root, "app.js")) bytes = bytes.toString().replace(/\}\)\(\);\s*$/, "window.editModeTest = { state, exportText, loadJsonOnMainThread, selectObject, isObjectVisibleInOverlay };})();");
    res.end(bytes);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(artifacts, "edge-profile-"));
  browser = spawn(process.env.VIEWER_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  browser.on("error", error => console.error(error));
  const port = await until(() => fs.existsSync(path.join(profile, "DevToolsActivePort")) && fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map(), exceptions = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const click = id => evaluate(`document.getElementById('${id}').click()`);
  const exported = () => evaluate("editModeTest.exportText()");
  const drag = async (x, y) => {
    const point = await evaluate(`(() => { const s=editModeTest.state, r=document.getElementById('canvasShell').getBoundingClientRect(); return {x:r.left+s.panX+${x}*s.zoom,y:r.top+s.panY+${y}*s.zoom}; })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 18, y: point.y + 12, button: "left", buttons: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 18, y: point.y + 12, button: "left", clickCount: 1 });
    await pause(40);
  };
  const key = key => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}, ctrlKey:${key === "z"}}))`);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  await until(() => evaluate("!!window.editModeTest"));
  await evaluate(`(() => {
    const canvas=document.createElement('canvas'); canvas.width=2000; canvas.height=1500;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#eeeeee'; ctx.fillRect(0,0,2000,1500);
    const image=URL.createObjectURL(new Blob([Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c=>c.charCodeAt(0))], {type:'image/png'}));
    editModeTest.loadJsonOnMainThread(JSON.stringify({[image]:{det:{objects:[{labels:['sample'],bbox:[100,100,300,100,300,260,100,260],attrs:{box_type:'rectangle'},keypoints:{points:[[150,150]],names:['point']}},{labels:['inside'],bbox:[260,220,280,220,280,240,260,240]},{labels:['outside'],bbox:[710,120,730,120,730,140,710,140]},{labels:['sample-other'],bbox:[400,100,600,100,600,260,400,260]},{labels:['inside-2'],bbox:[560,220,580,220,580,240,560,240]}]}}}));
  })()`);
  await until(() => evaluate("document.getElementById('mainImage').naturalWidth === 2000"));
  assert.equal(await evaluate("document.getElementById('strokeWidthRange').value"), "2", "stroke width uses the new default");
  assert.equal(await evaluate("document.getElementById('boxFillOpacityRange').value"), "10", "fill opacity uses the new default");
  assert.equal(await evaluate("document.getElementById('labelSizeRange').value"), "12", "label size uses the new default");
  assert.equal(await evaluate(`(() => {
    const input = document.getElementById('boxFillOpacityRange');
    input.value = '0';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    const transparent = editModeTest.state.boxFillOpacity === 0;
    input.value = '100';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    return transparent && editModeTest.state.boxFillOpacity === 100;
  })()`), true, "fill opacity can be adjusted from transparent to fully opaque");
  await evaluate("document.getElementById('boxFillOpacityRange').value = '10'; document.getElementById('boxFillOpacityRange').dispatchEvent(new Event('input', {bubbles: true}))");
  assert.equal(await evaluate(`(() => {
    editModeTest.state.boxStrokeWidth = 8;
    editModeTest.state.boxFillOpacity = 80;
    editModeTest.state.labelFontSize = 24;
    document.getElementById('strokeWidthReset').click();
    document.getElementById('boxFillOpacityReset').click();
    document.getElementById('labelSizeReset').click();
    return editModeTest.state.boxStrokeWidth === 2
      && editModeTest.state.boxFillOpacity === 10
      && editModeTest.state.labelFontSize === 12;
  })()`), true, "control labels restore defaults on click");
  assert.equal(await evaluate(`(() => {
    const button = document.getElementById('labelZoomBtn');
    const size = document.getElementById('labelZoomSizeInput');
    const before = editModeTest.state.labelZoom;
    button.click();
    const bounds = ViewerCore.getLabelZoomBounds(editModeTest.state.data[editModeTest.state.currentImage].det.objects, editModeTest.state.labelZoomSize, 2000, 1500);
    const centered = Math.abs(editModeTest.state.panX + (bounds.left + bounds.right) / 2 * editModeTest.state.zoom - document.getElementById('canvasShell').clientWidth / 2) < 1
      && Math.abs(editModeTest.state.panY + (bounds.top + bounds.bottom) / 2 * editModeTest.state.zoom - document.getElementById('canvasShell').clientHeight / 2) < 1;
    const enabled = !before && editModeTest.state.labelZoom && button.getAttribute('aria-pressed') === 'true' && centered;
    size.value = '512';
    size.dispatchEvent(new Event('change', {bubbles: true}));
    const resized = editModeTest.state.labelZoomSize === 512;
    button.click();
    return enabled && resized && !editModeTest.state.labelZoom;
  })()`), true, "label zoom focuses all boxes and accepts an adjustable minimum size");
  assert.equal(await evaluate(`(() => {
    const input = document.getElementById('labelFilter');
    input.value = 'sam';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    const opened = !document.getElementById('labelFilterMenu').hidden && input.getAttribute('aria-expanded') === 'true';
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    const closed = document.getElementById('labelFilterMenu').hidden && input.getAttribute('aria-expanded') === 'false';
    const applied = editModeTest.state.appliedFilters.label === 'sam';
    document.getElementById('clearFiltersBtn').click();
    return opened && closed && applied;
  })()`), true, "Enter applies the label filter and closes its suggestions");
  assert.equal(await evaluate(`(() => {
    const button = document.getElementById('showContainedBoxesBtn');
    const objects = editModeTest.state.data[editModeTest.state.currentImage].det.objects;
    const input = document.getElementById('labelFilter');
    input.value = 'sample';
    document.getElementById('applyFiltersBtn').click();
    const noSelection = editModeTest.state.selectedObjectIndex === -1 && !button.disabled;
    button.click();
    const active = editModeTest.state.showContainedBoxes && button.getAttribute('aria-pressed') === 'true';
    const visible = objects.map((obj, index) => editModeTest.isObjectVisibleInOverlay(obj, index, objects));
    button.click();
    document.getElementById('clearFiltersBtn').click();
    return noSelection && active && visible.join(',') === 'true,true,false,true,true' && !editModeTest.state.showContainedBoxes;
  })()`), true, "contained-box toggle expands every filtered box without selecting one");
  await evaluate("editModeTest.selectObject(0)");
  const original = await exported();
  assert.equal(await evaluate("document.getElementById('editModeBtn').getAttribute('aria-pressed')"), "false");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('#labelsEditor, #bboxGrid input, #keypointList input, #keypointList button, #addRectangleBtn, #addQuadrilateralBtn, #deleteObjectBtn, #addKeypointBtn, #applyObjectBtn')).every(el=>el.disabled)"), true);
  for (const point of [[210, 200], [100, 100], [200, 100], [150, 150]]) {
    await click("resetViewBtn"); await pause(30); await drag(...point);
    assert.equal(await exported(), original, "locked gestures preserve annotations");
  }
  assert.equal(await evaluate("editModeTest.state.undoHistory.size()"), 0);
  await key("Delete");
  assert.equal(await exported(), original);
  await click("editModeBtn");
  assert.equal(await evaluate("document.getElementById('editModeBtn').getAttribute('aria-pressed')"), "true");
  assert.equal(await evaluate("document.getElementById('labelsEditor').disabled"), false);
  for (const point of [[210, 200], [100, 100], [200, 100], [150, 150]]) {
    await click("resetViewBtn"); await pause(30); await drag(...point);
    assert.notEqual(await exported(), original, "enabled gestures edit annotations");
    await key("z");
    assert.equal(await exported(), original, "undo restores annotations");
  }
  await evaluate("const labels=document.getElementById('labelsEditor'); labels.value='edited'; labels.dispatchEvent(new Event('change'))");
  const edited = await exported();
  assert.notEqual(edited, original);
  await click("addKeypointBtn");
  assert.equal(await evaluate("!!editModeTest.state.pendingKeypointPlacement"), true);
  await click("editModeBtn");
  assert.equal(await evaluate("editModeTest.state.pendingKeypointPlacement"), null);
  await key("z"); await key("Delete");
  await click("addRectangleBtn"); await click("addQuadrilateralBtn"); await click("deleteObjectBtn");
  await evaluate("document.getElementById('labelsEditor').value='blocked'; document.getElementById('labelsEditor').dispatchEvent(new Event('change'))");
  assert.equal(await exported(), edited, "locked controls and shortcuts preserve edits");
  await evaluate("editModeTest.selectObject(0)");
  for (const [width, height, name] of [[1440, 1000, "desktop"], [390, 844, "mobile"]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await pause(150);
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  }
  assert.deepEqual(exceptions, []);
  console.log("PASS: default lock, box/handle/edge/keypoint gestures, enabled editing, undo, controls, shortcuts, pending placement, desktop/mobile screenshots");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (ws) ws.close();
  if (browser) browser.kill();
  server.close();
});
