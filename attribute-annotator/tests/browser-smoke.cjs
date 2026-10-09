// node attribute-annotator/tests/browser-smoke.cjs <artifact-directory>
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const artifacts = path.resolve(process.argv[2]);
fs.mkdirSync(artifacts, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error("Timed out waiting for attribute annotator");
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
  const fileInput = async (selector, file) => {
    const documentNode = await call("DOM.getDocument");
    const input = await call("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector });
    await call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [file] });
  };
  const choose = value => evaluate(`Array.from(document.querySelectorAll('[data-attribute-option]')).find(button=>button.dataset.attributeOption===${JSON.stringify(value)}).click()`);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("DOM.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const url = process.env.ATTRS_TEST_FILE_URL ? require("node:url").pathToFileURL(path.join(root, "attribute-annotator/index.html")).href : `http://127.0.0.1:${server.address().port}/attribute-annotator/index.html`;
  await call("Page.navigate", { url });
  await until(() => evaluate("!!window.AttributeUI && document.getElementById('attrsConfigDialog').open"));
  assert.equal(await evaluate("document.getElementById('appSwitcher').value"), "attribute-annotator");
  await click("attrsApplyBtn");
  assert.match(await evaluate("document.getElementById('attrsConfigError').textContent"), /名称/);
  await evaluate(`(() => {
    const row=document.querySelector('.config-row');
    row.querySelector('[data-config-field="name"]').value='外观状态';
    row.querySelector('[data-config-field="options"]').value='正常\\n松动\\n缺失';
  })()`);
  await click("attrsAddBtn");
  await evaluate(`(() => {
    const row=document.querySelectorAll('.config-row')[1];
    row.querySelector('[data-config-field="name"]').value='遮挡状态';
    row.querySelector('[data-config-field="options"]').value='无遮挡\\n遮挡';
    const create=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(blob.type.startsWith('application/json'))window.lastJsonBlob=blob;return create(blob);};
    HTMLAnchorElement.prototype.click=function(){};
  })()`);
  await call("Page.captureScreenshot").then(result => fs.writeFileSync(path.join(artifacts, "config.png"), Buffer.from(result.data, "base64")));
  await click("attrsExportBtn");
  const config = JSON.parse(await evaluate("lastJsonBlob.text()"));
  assert.deepEqual(config, { version: 1, groups: [{ name: "外观状态", options: ["正常", "松动", "缺失"] }, { name: "遮挡状态", options: ["无遮挡", "遮挡"] }] });
  const configFile = path.join(artifacts, "attrs-selection-table.json");
  fs.writeFileSync(configFile, JSON.stringify(config));
  await click("attrsApplyBtn");
  await click("attrsConfigureBtn");
  await evaluate("document.querySelector('[data-config-field=options]').value='wrong'");
  await fileInput("#attrsConfigFile", configFile);
  await until(() => evaluate("document.querySelector('[data-config-field=options]').value==='正常\\n松动\\n缺失'"));
  await click("attrsApplyBtn");
  if (process.env.ATTRS_CONFIG_ONLY) {
    assert.deepEqual(exceptions, []);
    console.log("Attribute configuration browser smoke passed", artifacts);
    return;
  }
  const fixture = await evaluate(`(() => {
    const c=document.createElement('canvas');c.width=640;c.height=182;
    const ctx=c.getContext('2d');ctx.fillStyle='#e8edf0';ctx.fillRect(0,0,640,182);
    ctx.fillStyle='#687c89';ctx.fillRect(56,102,34,72);ctx.fillStyle='#8b9296';ctx.fillRect(300,75,60,60);
    const bytes=Uint8Array.from(atob(c.toDataURL().split(',')[1]), value=>value.charCodeAt(0));
    const makeImage=()=>URL.createObjectURL(new Blob([bytes], {type:'image/png'}));
    const image=makeImage();
    const objects=[{labels:['正常无遮挡螺母'],bbox:[56,102,90,102,90,174,56,174],attrs:{original:'keep'},score_attrs:['旧属性']},{labels:['备用螺母'],bbox:[300,75,360,75,360,135,300,135],attrs:{}}];
    const data={[image]:{width:640,height:182,custom:'keep',det:{objects}}};
    const image2=makeImage(); data[image2]={width:640,height:182,det:{objects:structuredClone(objects)}};
    const image3=makeImage(); data[image3]={width:640,height:182,det:{objects:[]}};
    const image4=makeImage(); const malformed=structuredClone(objects[0]);malformed.score_attrs={正常:1};
    data[image4]={width:640,height:182,det:{objects:[malformed]}};
    return data;
  })()`);
  const dataFile = path.join(artifacts, "annotations.json");
  fs.writeFileSync(dataFile, JSON.stringify(fixture));
  await fileInput("#jsonFileInput", dataFile);
  await until(() => evaluate("document.getElementById('mainImage').naturalWidth===640 && document.getElementById('attrsObjectSelect').value==='0'"));
  assert.equal(await evaluate("document.getElementById('editModeBtn').getAttribute('aria-pressed')"), "false");
  await choose("正常");
  await choose("无遮挡");
  await choose("松动");
  await click("downloadJsonBtn");
  let data = JSON.parse(await evaluate("lastJsonBlob.text()"));
  const first = Object.keys(fixture)[0], second = Object.keys(fixture)[1];
  assert.deepEqual(data[first].det.objects[0].score_attrs, ["旧属性", "松动", "无遮挡"]);
  assert.deepEqual(data[first].det.objects[0].attrs, { original: "keep" });
  assert.equal(data[first].custom, "keep");
  assert.equal("score_attrs" in data[first].det.objects[1], false);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true}))");
  await click("downloadJsonBtn");
  data = JSON.parse(await evaluate("lastJsonBlob.text()"));
  assert.deepEqual(data[first].det.objects[0].score_attrs, ["旧属性", "正常", "无遮挡"]);
  assert.equal(await evaluate("document.querySelector('[data-attribute-option=正常]').getAttribute('aria-pressed')"), "true");
  await evaluate("const select=document.getElementById('attrsObjectSelect');select.value='1';select.dispatchEvent(new Event('change'))");
  await choose("缺失");
  await click("attrsUndoBtn");
  await click("downloadJsonBtn");
  data = JSON.parse(await evaluate("lastJsonBlob.text()"));
  assert.equal("score_attrs" in data[first].det.objects[1], false);
  await choose("缺失");
  await click("boxLabelBtn");
  await click("nextImageBtn");
  await until(() => evaluate("document.getElementById('attrsObjectSelect').value==='0'"));
  assert.equal(await evaluate("document.getElementById('boxLabelBtn').getAttribute('aria-pressed')"), "false");
  assert.equal(await evaluate("document.querySelector('[data-attribute-option=松动]').getAttribute('aria-pressed')"), "false");
  await choose("遮挡");
  await click("downloadJsonBtn");
  data = JSON.parse(await evaluate("lastJsonBlob.text()"));
  assert.deepEqual(data[second].det.objects[0].score_attrs, ["旧属性", "遮挡"]);
  assert.deepEqual(data[first].det.objects[1].score_attrs, ["缺失"]);
  await click("batchPreviewBtn");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-attribute-option]')).every(button=>button.disabled)"), true);
  await click("batchPreviewBtn");
  await click("nextImageBtn");
  await until(() => evaluate("document.getElementById('attrsObjectSelect').disabled"));
  assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-attribute-option]')).every(button=>button.disabled)"), true);
  await click("prevImageBtn");
  await click("boxLabelBtn");
  await choose("正常");
  await click("nextImageBtn");
  await click("nextImageBtn");
  await until(() => evaluate("document.getElementById('attrsMessage').textContent.includes('不是属性名数组')"));
  assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-attribute-option]')).every(button=>button.disabled)"), true);
  await click("downloadJsonBtn");
  data = JSON.parse(await evaluate("lastJsonBlob.text()"));
  assert.deepEqual(data[Object.keys(fixture)[3]].det.objects[0].score_attrs, {正常:1});
  const editedFile = path.join(artifacts, "annotations-edited.json");
  fs.writeFileSync(editedFile, JSON.stringify(data));
  await fileInput("#jsonFileInput", editedFile);
  await until(() => evaluate("document.getElementById('attrsMessage').textContent==='' && document.querySelector('[data-attribute-option=正常]').getAttribute('aria-pressed')==='true'"));
  assert.equal(await evaluate("document.querySelector('[data-attribute-option=无遮挡]').getAttribute('aria-pressed')"), "true");
  await click("nextImageBtn");
  await until(() => evaluate("document.getElementById('mainImage').complete && document.getElementById('mainImage').naturalWidth===640"));
  await click("labelZoomBtn");
  await pause(150);
  assert.equal(await evaluate("(() => {const c=document.getElementById('canvasShell').getBoundingClientRect(),p=document.querySelector('.attribute-panel').getBoundingClientRect();return c.width>250 && p.left>=c.right-1 && c.height>300;})()"), true);
  await call("Page.captureScreenshot").then(result => fs.writeFileSync(path.join(artifacts, "desktop.png"), Buffer.from(result.data, "base64")));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.attribute-workspace').scrollIntoView()");
  await pause(150);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"), true);
  await call("Page.captureScreenshot").then(result => fs.writeFileSync(path.join(artifacts, "mobile.png"), Buffer.from(result.data, "base64")));
  assert.deepEqual(exceptions, []);
  console.log("Attribute annotation browser smoke passed", artifacts);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (ws) ws.close();
  if (browser) browser.kill();
  server.close();
});
