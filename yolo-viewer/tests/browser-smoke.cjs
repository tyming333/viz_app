// Usage: node yolo-viewer/tests/browser-smoke.cjs <artifact-directory>
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const zip = require("../vendor/fflate.js");
const root = path.resolve(__dirname, "../..");
const artifacts = path.resolve(process.argv[2]);
fs.mkdirSync(artifacts, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error("Timed out waiting for YOLO browser state");
}
let browser, ws;
const server = http.createServer((req, res) => {
  const file = path.resolve(root, new URL(req.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
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
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: process.env.YOLO_TEST_FILE_URL ? require("node:url").pathToFileURL(path.join(root, "yolo-viewer/index.html")).href : `http://127.0.0.1:${server.address().port}/yolo-viewer/index.html` });
  await until(() => evaluate("!!window.YoloDataset"));
  assert.equal(await evaluate("document.getElementById('appSwitcher').value"), "yolo-viewer");
  const fixture = await evaluate(`(() => {
    const canvas=document.createElement('canvas'); canvas.width=1000; canvas.height=500;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#e5e7eb'; ctx.fillRect(0,0,1000,500);
    ctx.fillStyle='#52636b'; ctx.fillRect(400,150,200,200); ctx.fillStyle='#a6adb2'; ctx.fillRect(425,175,150,150);
    return canvas.toDataURL().split(',')[1];
  })()`);
  const fixtureRoot = path.join(artifacts, "fixture");
  for (const directory of [fixtureRoot, path.join(fixtureRoot, "a"), path.join(fixtureRoot, "b")]) fs.mkdirSync(directory, { recursive: true });
  for (const image of ["a/001.png", "b/001.png", "empty.png", "missing.png", "invalid.png"]) fs.writeFileSync(path.join(fixtureRoot, image), Buffer.from(fixture, "base64"));
  const textFiles = { "a/001.txt": "3 0.5 0.5 0.2 0.4\n", "b/001.txt": "7 0.5 0.5 0.2 0.4\n", "empty.txt": "", "invalid.txt": "99 0.5 0.5 0.2 0.4\n", "broken.txt": "", "broken.png": "not an image", "orphan.txt": "3 0.5 0.5 0.2 0.4", "data.yaml": "names:\n  3: 正常\n  7: 缺失\n  9: 备用\n" };
  for (const [name, text] of Object.entries(textFiles)) fs.writeFileSync(path.join(fixtureRoot, name), text);
  await call("DOM.enable");
  const documentNode = await call("DOM.getDocument");
  const input = await call("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#yoloDirectoryInput" });
  await call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [fixtureRoot] });
  await until(() => evaluate("!document.getElementById('yoloLoadBtn').disabled"));
  await click("yoloLoadBtn");
  await until(() => evaluate("YoloViewer.state.imageNames.length===3 && !document.getElementById('yoloLoadBtn').disabled"));
  assert.deepEqual(await evaluate("YoloViewer.state.imageNames"), ["a/001.png", "b/001.png", "empty.png"]);
  assert.deepEqual(await evaluate("YoloViewer.state.data['a/001.png'].det.objects[0].bbox"), [400,150,600,150,600,350,400,350]);
  assert.equal(await evaluate("YoloViewer.state.knownImageSizes.size"), 3);
  assert.equal(await evaluate("document.getElementById('yoloIssuesList').children.length"), 4);
  assert.equal(await evaluate("document.getElementById('labelsEditor').disabled"), true);
  await until(() => evaluate("document.getElementById('mainImage').naturalWidth===1000"));
  await until(() => evaluate("Array.from(document.getElementById('overlayCanvas').getContext('2d').getImageData(0,0,document.getElementById('overlayCanvas').width,document.getElementById('overlayCanvas').height).data).some((v,i)=>i%4===3&&v>0)"));
  assert.equal(await evaluate("document.getElementById('addQuadrilateralBtn').offsetWidth"), 0);
  await click("editModeBtn");
  await evaluate("document.querySelector('[data-object-index=\"0\"]').click()");
  await evaluate("const labels=document.getElementById('labelsEditor'); labels.value='缺失'; labels.dispatchEvent(new Event('change'))");
  assert.deepEqual(await evaluate("YoloViewer.state.data['a/001.png'].det.objects[0].labels"), ["缺失"]);
  await click("addRectangleBtn");
  assert.deepEqual(await evaluate("YoloViewer.state.data['a/001.png'].det.objects[1].labels"), ["正常"]);
  await click("boxLabelBtn");
  await click("nextImageBtn");
  assert.equal(await evaluate("YoloViewer.state.showBoxLabels"), false);
  await click("boxLabelBtn");
  await evaluate("document.getElementById('labelFilter').value='缺失'");
  await click("applyFiltersBtn");
  assert.deepEqual(await evaluate("YoloViewer.state.filteredImageNames"), ["a/001.png", "b/001.png"]);
  await click("clearFiltersBtn");
  await click("batchPreviewBtn");
  await until(() => evaluate("document.querySelectorAll('.batch-preview-overlay').length>0"));
  await click("batchPreviewBtn");
  await evaluate("document.getElementById('yoloMissingAsNegative').checked=true");
  await click("yoloLoadBtn");
  await until(() => evaluate("YoloViewer.state.imageNames.length===4 && !document.getElementById('yoloLoadBtn').disabled"));
  assert.deepEqual(await evaluate("YoloViewer.state.data['missing.png'].det.objects"), []);
  // Capture actual archive blobs without initiating a browser download in the test.
  await evaluate(`(() => {
    const create=URL.createObjectURL.bind(URL); window.archiveBlob=null;
    URL.createObjectURL=blob=>{if(blob.type==='application/zip')window.archiveBlob=blob;return create(blob);};
    HTMLAnchorElement.prototype.click=function(){};
  })()`);
  await click("downloadJsonBtn");
  await until(() => evaluate("!!window.archiveBlob"));
  const bytes = await evaluate("archiveBlob.arrayBuffer().then(buffer=>Array.from(new Uint8Array(buffer)))");
  const archive = zip.unzipSync(new Uint8Array(bytes));
  assert.deepEqual(Object.keys(archive).sort(), ["a/001.png", "a/001.txt", "b/001.png", "b/001.txt", "empty.png", "empty.txt", "labels.json", "missing.png", "missing.txt"].sort());
  assert.deepEqual(JSON.parse(zip.strFromU8(archive["labels.json"])), { 3: "正常", 7: "缺失", 9: "备用" });
  assert.equal(zip.strFromU8(archive["a/001.txt"]), "3 0.50000000 0.50000000 0.20000000 0.40000000\n");
  assert.equal(archive["empty.txt"].length, 0);
  // Export edited classes and rectangles using the original numeric IDs.
  await evaluate("document.querySelector('[data-object-index=\"0\"]').click(); const editor=document.getElementById('labelsEditor'); editor.value='缺失'; editor.dispatchEvent(new Event('change')); archiveBlob=null");
  await evaluate("document.querySelector('.image-check').click()");
  await click("exportSelectedBtn");
  await until(() => evaluate("!!window.archiveBlob"));
  const selected = zip.unzipSync(new Uint8Array(await evaluate("archiveBlob.arrayBuffer().then(buffer=>Array.from(new Uint8Array(buffer)))")));
  assert.deepEqual(Object.keys(selected).sort(), ["a/001.png", "a/001.txt", "labels.json"].sort());
  assert.equal(zip.strFromU8(selected["a/001.txt"]).split(" ")[0], "7");
  await evaluate("document.activeElement.blur()");
  await pause(150);
  const desktop = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, "desktop.png"), Buffer.from(desktop.data, "base64"));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(200);
  const mobile = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, "mobile.png"), Buffer.from(mobile.data, "base64"));
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "mobile layout has no horizontal overflow");
  await evaluate("document.querySelector('.viewer').scrollIntoView()");
  await pause(200);
  const mobileViewer = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, "mobile-viewer.png"), Buffer.from(mobileViewer.data, "base64"));
  assert.deepEqual(exceptions, [], "no browser runtime exceptions");
  console.log("PASS: real folder import, mapping, error reporting, drawing, editing, filtering, negatives, ZIP exports, desktop/mobile");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (ws) ws.close();
  if (browser) browser.kill();
  server.close();
});
