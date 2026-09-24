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
    if (file === path.join(root, "app.js")) bytes = bytes.toString().replace(/\}\)\(\);\s*$/, "window.editModeTest = { state, exportText, loadJsonOnMainThread, selectObject };})();");
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
    const canvas=document.createElement('canvas'); canvas.width=600; canvas.height=400;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#eeeeee'; ctx.fillRect(0,0,600,400);
    const image=URL.createObjectURL(new Blob([Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c=>c.charCodeAt(0))], {type:'image/png'}));
    editModeTest.loadJsonOnMainThread(JSON.stringify({[image]:{det:{objects:[{labels:['sample'],bbox:[100,100,300,100,300,260,100,260],attrs:{box_type:'rectangle'},keypoints:{points:[[150,150]],names:['point']}}]}}}));
  })()`);
  await until(() => evaluate("document.getElementById('mainImage').naturalWidth === 600"));
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
