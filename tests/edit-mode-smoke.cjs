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
let browser, ws, imageFixture;
const imageServer = http.createServer((req, res) => {
  if (req.url.includes("cors=1")) res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "image/png");
  res.end(imageFixture);
});
const server = http.createServer((req, res) => {
  if ((new URL(req.url, "http://localhost").pathname === "/test-image.png" || req.url.startsWith("/directory-fixtures/")) && imageFixture) {
    res.setHeader("Content-Type", "image/png");
    res.end(imageFixture);
    return;
  }
  const file = path.resolve(root, new URL(req.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    // Expose state only in the test server, so assertions inspect exported data too.
    if (file === path.join(root, "app.js")) bytes = bytes.toString().replace(/\}\)\(\);\s*$/, "window.editModeTest = { state, exportText, loadJsonOnMainThread, selectObject, isObjectVisibleInOverlay, pickObjectAtPoint, getObjectColor };})();");
    res.end(bytes);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => imageServer.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(artifacts, "edge-profile-"));
  browser = spawn(process.env.VIEWER_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  browser.on("error", error => console.error(error));
  const port = await until(() => fs.existsSync(path.join(profile, "DevToolsActivePort")) && fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map(), exceptions = [], fileChoosers = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    else if (message.method === "Page.fileChooserOpened") fileChoosers.push(message.params);
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
  const chooseFile = async (selector, file) => {
    const doc = await call("DOM.getDocument");
    const input = await call("DOM.querySelector", {nodeId:doc.root.nodeId,selector});
    await call("DOM.setFileInputFiles", {nodeId:input.nodeId,files:[file]});
  };
  const exported = () => evaluate("editModeTest.exportText()");
  const drag = async (x, y) => {
    const point = await evaluate(`(() => { const s=editModeTest.state, r=document.getElementById('canvasShell').getBoundingClientRect(); return {x:r.left+s.panX+${x}*s.zoom,y:r.top+s.panY+${y}*s.zoom}; })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 18, y: point.y + 12, button: "left", buttons: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 18, y: point.y + 12, button: "left", clickCount: 1 });
    await pause(40);
  };
  const key = key => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}, ctrlKey:${key === "z"}}))`);
  const fineDrag = async id => {
    const point = await evaluate(`(() => { const r=document.getElementById('${id}').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 6, y: point.y, button: "left", buttons: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 6, y: point.y, button: "left", clickCount: 1 });
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  await until(() => evaluate("!!window.editModeTest"));
  imageFixture = Buffer.from(await evaluate(`(() => {
    const canvas=document.createElement('canvas'); canvas.width=2000; canvas.height=1500;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#eeeeee'; ctx.fillRect(0,0,2000,1500);
    return canvas.toDataURL().split(',')[1];
  })()`), "base64");
  await evaluate(`(() => {
    const image=location.origin+'/test-image.png?image=1';
    const data = {[image]:{det:{objects:[{labels:['sample'],bbox:[100,100,300,100,300,260,100,260],attrs:{box_type:'rectangle'},keypoints:{points:[[150,150]],names:['point']}},{labels:['inside'],bbox:[260,220,280,220,280,240,260,240]},{labels:['outside'],bbox:[710,120,730,120,730,140,710,140]},{labels:['sample-other'],bbox:[400,100,600,100,600,260,400,260]},{labels:['inside-2'],bbox:[560,220,580,220,580,240,560,240]}]}}};
    const secondImage = location.origin+'/test-image.png?image=2';
    data[secondImage] = structuredClone(data[image]);
    editModeTest.loadJsonOnMainThread(JSON.stringify(data));
  })()`);
  await until(() => evaluate("document.getElementById('mainImage').naturalWidth === 2000"));
  assert.equal(await evaluate("(() => {const s=editModeTest.state,c=document.getElementById('canvasShell');return s.zoom===Math.min(1,(c.clientWidth-24)/2000,(c.clientHeight-24)/1500) && !s.labelZoom;})()"), true, "newly loaded images fit the entire canvas by default");
  assert.equal(await evaluate("document.getElementById('brightnessRange').step"), "1", "image adjustment sliders accept one-percent changes");
  await fineDrag("brightnessRange");
  assert.equal(await evaluate("editModeTest.state.imageBrightness"), 102, "short drags change brightness by two percent");
  const thumb = await evaluate(`(() => { const input=document.getElementById('brightnessRange'), r=input.getBoundingClientRect(); return {x:r.left+3+(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*(r.width-6),y:r.top+r.height/2}; })()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...thumb, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...thumb, button: "left", clickCount: 1 });
  assert.equal(await evaluate("editModeTest.state.imageBrightness"), 102, "clicking the thumb preserves its value");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate("editModeTest.state.imageBrightness"), 103, "arrow keys retain one-percent adjustment");
  const track = await evaluate(`(() => { const r=document.getElementById('brightnessRange').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...track, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...track, button: "left", clickCount: 1 });
  assert.equal(await evaluate("editModeTest.state.imageBrightness"), 300, "clicking the track retains quick positioning");
  await click("resetBrightnessBtn");
  await fineDrag("boxFillOpacityRange");
  assert.equal(await evaluate("editModeTest.state.boxFillOpacity"), 12, "short drags change box fill by two percent");
  await click("boxFillOpacityReset");
  await evaluate(`(() => {
    window.boxLabelDraws = [];
    window.originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      boxLabelDraws.push({text, canvas: this.canvas.id || this.canvas.className});
      return originalFillText.call(this, text, ...args);
    };
  })()`);
  assert.equal(await evaluate("document.getElementById('boxLabelBtn').getAttribute('aria-pressed')"), "true", "box labels are enabled by default");
  await click("strokeWidthReset");
  await until(() => evaluate("boxLabelDraws.some(draw => draw.canvas === 'overlayCanvas' && draw.text === 'sample')"));
  assert.equal(await evaluate("boxLabelDraws.some(draw => draw.canvas === 'overlayCanvas' && draw.text === 'sample')"), true, "single image draws box labels by default");
  await evaluate("boxLabelDraws.length = 0");
  await click("boxLabelBtn");
  await until(() => evaluate("boxLabelDraws.some(draw => draw.text === 'point')"));
  assert.equal(await evaluate("boxLabelDraws.some(draw => draw.text === 'sample')"), false, "turning off box labels suppresses their drawing");
  assert.equal(await evaluate("boxLabelDraws.some(draw => draw.text === 'point') && editModeTest.state.showBoxes"), true, "box visibility and keypoint labels remain enabled");
  for (const [button, index] of [["nextImageBtn", 1], ["prevImageBtn", 0]]) {
    await evaluate("boxLabelDraws.length = 0");
    await click(button);
    await until(() => evaluate(`editModeTest.state.currentImageIndex === ${index} && boxLabelDraws.some(draw => draw.text === 'point')`));
    assert.equal(await evaluate("!editModeTest.state.showBoxLabels && document.getElementById('boxLabelBtn').getAttribute('aria-pressed') === 'false' && !boxLabelDraws.some(draw => draw.text === 'sample')"), true, "disabled box labels stay disabled when switching images");
  }
  await evaluate("boxLabelDraws.length = 0");
  await click("batchPreviewBtn");
  await until(() => evaluate("boxLabelDraws.some(draw => draw.canvas === 'batch-preview-overlay' && draw.text === 'point')"));
  assert.equal(await evaluate("boxLabelDraws.some(draw => draw.canvas === 'batch-preview-overlay' && draw.text === 'sample')"), false, "batch preview also hides box labels");
  await click("boxLabelBtn");
  assert.equal(await evaluate("boxLabelDraws.some(draw => draw.canvas === 'batch-preview-overlay' && draw.text === 'sample')"), true, "box labels can be restored in batch preview");
  await click("batchPreviewBtn");
  await click("nextImageBtn");
  await until(() => evaluate("editModeTest.state.currentImageIndex === 1 && document.getElementById('mainImage').complete"));
  assert.equal(await evaluate("editModeTest.state.showBoxLabels && document.getElementById('boxLabelBtn').getAttribute('aria-pressed') === 'true'"), true, "enabled box labels also survive image switching");
  await click("prevImageBtn");
  await until(() => evaluate("editModeTest.state.currentImageIndex === 0 && document.getElementById('mainImage').complete"));
  await evaluate("CanvasRenderingContext2D.prototype.fillText = originalFillText; delete window.originalFillText; delete window.boxLabelDraws");
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
  assert.equal(await evaluate(`(()=>{
    const field=document.getElementById('labelFilterField'), list=document.getElementById('imageList'), name=document.getElementById('imageFilter');
    const before={field:field.offsetHeight,list:list.offsetHeight,name:name.offsetHeight};
    const options=()=>Array.from(document.querySelectorAll('#labelSelectMenu button[data-label-value]')).map(button=>button.dataset.labelValue);
    const originalOrder=options();
    for(const label of editModeTest.state.labelOptions) document.querySelector('#labelSelectMenu button[data-label-value="'+label+'"]').click();
    if(JSON.stringify(options())!==JSON.stringify(originalOrder)) throw Error('Selecting labels reordered the dropdown');
    if(!editModeTest.state.labelOptions.every(label=>document.querySelector('#labelSelectMenu button[data-label-value="'+label+'"]').getAttribute('aria-selected')==='true')) throw Error('Selected labels are not checked');
    const grew=field.offsetHeight>before.field && list.offsetHeight<before.list && name.offsetHeight===before.name && field.scrollWidth===field.clientWidth;
    document.getElementById('clearFiltersBtn').click();return grew && field.offsetHeight===before.field;
  })()`), true, "label chips wrap downward, reclaim image-list space and restore it when cleared");
  assert.equal(await evaluate(`(()=>{
    const s=editModeTest.state, canvas=document.getElementById('canvasShell'), size=document.getElementById('labelZoomSizeInput');
    editModeTest.selectObject(-1);size.value='64';size.dispatchEvent(new Event('change'));
    document.getElementById('labelFilter').value='sample';document.getElementById('applyFiltersBtn').click();
    document.getElementById('labelZoomBtn').click();
    const centered=(x,y)=>Math.abs(s.panX+x*s.zoom-canvas.clientWidth/2)<1&&Math.abs(s.panY+y*s.zoom-canvas.clientHeight/2)<1;
    const filtered=centered(350,180) && !document.getElementById('filterModeIndicator').hidden;
    document.getElementById('showContainedBoxesBtn').click();const contained=centered(350,180);
    document.getElementById('showAllBoxesBtn').click();const all=centered(415,180);
    document.getElementById('boxVisibilityBtn').click();
    const hidden=s.zoom===Math.min(1,(canvas.clientWidth-24)/2000,(canvas.clientHeight-24)/1500);
    editModeTest.selectObject(2);size.dispatchEvent(new Event('change'));const selected=centered(720,130);
    editModeTest.selectObject(-1);document.getElementById('boxVisibilityBtn').click();document.getElementById('showAllBoxesBtn').click();
    document.getElementById('resetViewBtn').click();document.getElementById('clearFiltersBtn').click();size.value='512';size.dispatchEvent(new Event('change'));
    return filtered&&contained&&all&&hidden&&selected&&document.getElementById('filterModeIndicator').hidden;
  })()`), true, "label zoom uses only displayed boxes, including contained boxes and individually selected hidden boxes");
  assert.equal(await evaluate(`(() => {
    const s=editModeTest.state, canvas=document.getElementById('canvasShell');
    const original={zoom:s.zoom,panX:s.panX,panY:s.panY,index:s.selectedObjectIndex};
    editModeTest.selectObject(-1);
    document.querySelector('#objectList button[data-object-index="0"]').click();
    const unchanged=s.zoom===original.zoom && s.panX===original.panX && s.panY===original.panY;
    s.zoom=3;
    editModeTest.selectObject(-1);
    document.querySelector('#objectList button[data-object-index="0"]').click();
    const centered=s.zoom===3 && Math.abs(s.panX+200*s.zoom-canvas.clientWidth/2)<0.01
      && Math.abs(s.panY+180*s.zoom-canvas.clientHeight/2)<0.01;
    document.getElementById('resetViewBtn').click();
    editModeTest.selectObject(original.index);
    return unchanged && centered;
  })()`), true, "Objects clicks center oversized images without changing zoom or fitted views");
  assert.equal(await evaluate(`(async () => {
    const s=editModeTest.state;
    const originalVisibility=s.showBoxes;
    for (const visible of [false,true]) {
      s.showBoxes=visible;
      editModeTest.selectObject(-1);
      document.querySelector('#objectList button[data-object-index="0"]').click();
      if(s.selectedObjectIndex!==0)return false;
      const panX=s.panX,panY=s.panY;
      document.querySelector('#objectList button[data-object-index="0"]').click();
      await new Promise(r=>setTimeout(r,50));
      if(s.selectedObjectIndex!==-1 || s.showBoxes!==visible || s.hoverAnimationFrame!==0 || s.panX!==panX || s.panY!==panY)return false;
    }
    s.showBoxes=originalVisibility;
    return true;
  })()`), true, "repeated Objects clicks cancel highlighting without changing global visibility or view");
  assert.equal(await evaluate(`(async () => {
    const s=editModeTest.state, visibility=s.showBoxes, keypoints=s.showKeypoints;
    const strokes=[], original=CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='overlayCanvas')strokes.push({color:this.strokeStyle,shadow:this.shadowColor});return original.apply(this,args);};
    s.showBoxes=false;s.showKeypoints=false;editModeTest.selectObject(0);
    await new Promise(resolve=>setTimeout(resolve,70));
    CanvasRenderingContext2D.prototype.stroke=original;
    s.showBoxes=visibility;s.showKeypoints=keypoints;editModeTest.selectObject(-1);
    const color=editModeTest.getObjectColor(s.data[s.currentImage].det.objects[0],0);
    return strokes.length>0 && strokes.every(stroke=>stroke.color===color && !stroke.shadow.startsWith('rgba(250, 204, 21'));
  })()`), true, "selected breathing outlines retain their label color when global boxes are hidden");
  await click("resetViewBtn");
  await evaluate("editModeTest.selectObject(0)");
  assert.deepEqual(await evaluate("[document.getElementById('bboxWidthText').textContent,document.getElementById('bboxHeightText').textContent]"), ["200 px","160 px"], "selected object shows its enclosing rectangle dimensions below the coordinates");
  const blank = await evaluate("(() => {const s=editModeTest.state,r=document.getElementById('canvasShell').getBoundingClientRect();return {x:r.left+s.panX+1000*s.zoom,y:r.top+s.panY+800*s.zoom};})()");
  await call("Input.dispatchMouseEvent", {type:"mousePressed",...blank,button:"left",clickCount:1});
  await call("Input.dispatchMouseEvent", {type:"mouseReleased",...blank,button:"left",clickCount:1});
  assert.equal(await evaluate("editModeTest.state.selectedObjectIndex"), -1, "clicking empty canvas clears the active box");
  await until(() => evaluate("editModeTest.state.hoverAnimationFrame===0"));
  assert.equal(await evaluate(`(() => {
    const s=editModeTest.state, objects=s.data[s.currentImage].det.objects;
    const original=objects.slice(), index=s.selectedObjectIndex, filter=s.appliedFilters;
    const small={labels:['small'],bbox:[280,160,315,160,315,200,280,200],attrs:{box_type:'rectangle'}};
    const large={labels:['large'],bbox:[100,100,300,100,300,260,100,260],attrs:{box_type:'rectangle'}};
    s.appliedFilters={...filter,label:'',labelExact:[]};
    objects.splice(0,objects.length,small,large);
    editModeTest.selectObject(1);
    const overlap=editModeTest.pickObjectAtPoint(295,180)===0;
    const protruding=editModeTest.pickObjectAtPoint(310,180)===0;
    const tolerance=editModeTest.pickObjectAtPoint(315+2/s.zoom,180)===0;
    const exposedLarge=editModeTest.pickObjectAtPoint(200,180)===1;
    const savedEdit=s.editMode;
    s.editMode=true;
    const rect=document.getElementById('canvasShell').getBoundingClientRect();
    document.getElementById('canvasShell').dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:rect.left+s.panX+295*s.zoom,clientY:rect.top+s.panY+180*s.zoom,bubbles:true}));
    const selectedSmall=s.selectedObjectIndex===0 && !s.drag;
    s.editMode=savedEdit;
    editModeTest.selectObject(-1);
    s.appliedFilters={...filter,label:'large',labelExact:[]};
    const ignoresHidden=editModeTest.pickObjectAtPoint(295,180)===1;
    objects.splice(0,objects.length,...original);
    s.appliedFilters=filter;
    editModeTest.selectObject(index);
    return overlap && protruding && tolerance && exposedLarge && selectedSmall && ignoresHidden;
  })()`), true, "overlapping small boxes win independently of order and selected large edge editing");
  assert.equal(await evaluate(`(async () => {
    document.getElementById('labelFilter').value='sample';
    document.getElementById('applyFiltersBtn').click();
    document.getElementById('showContainedBoxesBtn').click();
    editModeTest.selectObject(0);
    const canvas=document.getElementById('canvasShell');
    canvas.dispatchEvent(new MouseEvent('contextmenu',{clientX:500,clientY:300,bubbles:true,cancelable:true}));
    const menu=document.getElementById('cropExportMenu');
    const input=menu.querySelector('[data-crop-side=left]');
    const defaults=Array.from(menu.querySelectorAll('[data-crop-side]')).every(i=>Number(i.value)===0.2);
    input.value='0.5';input.dispatchEvent(new Event('change'));
    const original=HTMLAnchorElement.prototype.click;
    let dimensions;
    HTMLAnchorElement.prototype.click=function(){window.cropTestUrl=this.href;};
    document.getElementById('cropExportBtn').click();
    for(let i=0;i<100 && !window.cropTestUrl;i++)await new Promise(r=>setTimeout(r,20));
    if(window.cropTestUrl){const b=await createImageBitmap(await (await fetch(window.cropTestUrl)).blob());dimensions=[b.width,b.height];b.close();}
    HTMLAnchorElement.prototype.click=original;
    const remembered=JSON.parse(localStorage.getItem('viz-app.crop-padding')).left===0.5;
    input.value='0.2';input.dispatchEvent(new Event('change'));
    menu.hidden=true;editModeTest.selectObject(-1);
    document.getElementById('showContainedBoxesBtn').click();
    document.getElementById('clearFiltersBtn').click();
    if (!(defaults && remembered && dimensions?.[0]===340 && dimensions?.[1]===224)) throw Error(JSON.stringify({defaults,remembered,dimensions,message:menu.textContent}));
    return true;
  })()`), true, "right-click crop uses the current layer under filtering plus contained boxes and remembers ratios");
  assert.deepEqual(await evaluate(`(async()=>{
    editModeTest.selectObject(0);
    document.getElementById('canvasShell').dispatchEvent(new MouseEvent('contextmenu',{clientX:500,clientY:300,bubbles:true,cancelable:true}));
    const inputs=[...document.querySelectorAll('[data-crop-side]')];
    const original=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){window.cropTestUrl=this.href;};
    inputs.forEach(input=>{input.value='-0.2';input.dispatchEvent(new Event('change'));});
    window.cropTestUrl=null;document.getElementById('cropExportBtn').click();
    for(let i=0;i<100&&!window.cropTestUrl;i++)await new Promise(r=>setTimeout(r,20));
    const b=await createImageBitmap(await(await fetch(cropTestUrl)).blob());const size=[b.width,b.height];b.close();
    const remembered=Object.values(JSON.parse(localStorage.getItem('viz-app.crop-padding'))).every(value=>value===-0.2);
    inputs.forEach(input=>{input.value='-0.6';});window.cropTestUrl=null;document.getElementById('cropExportBtn').click();
    for(let i=0;i<100&&document.getElementById('cropExportBtn').disabled;i++)await new Promise(r=>setTimeout(r,20));
    const rejected=!window.cropTestUrl&&document.getElementById('cropExportMenu').textContent.includes('扩缩后没有可裁剪区域');
    inputs.forEach(input=>{input.value='0.2';input.dispatchEvent(new Event('change'));});
    HTMLAnchorElement.prototype.click=original;document.getElementById('cropExportMenu').hidden=true;editModeTest.selectObject(-1);
    return {size,remembered,rejected};
  })()`), {size:[120,96],remembered:true,rejected:true}, "negative ratios shrink each edge relative to the original dimensions and reject collapsed crops");
  const currentLayer = await evaluate("document.getElementById('mainImage').src");
  for (const readable of [true, false]) {
    await evaluate(`document.getElementById('mainImage').src='http://127.0.0.1:${imageServer.address().port}/image.png?cors=${readable ? 1 : 0}'`);
    await until(() => evaluate("document.getElementById('mainImage').complete && document.getElementById('mainImage').naturalWidth===2000"));
    await evaluate(`(() => {
      editModeTest.selectObject(0);
      document.getElementById('canvasShell').dispatchEvent(new MouseEvent('contextmenu',{clientX:500,clientY:300,bubbles:true,cancelable:true}));
      window.originalCropClick=HTMLAnchorElement.prototype.click;
      window.cropTestUrl=null;
      HTMLAnchorElement.prototype.click=function(){window.cropTestUrl=this.href;};
      document.getElementById('cropExportBtn').click();
    })()`);
    await until(() => evaluate("!document.getElementById('cropExportBtn').disabled"));
    if (readable) {
      assert.equal(await evaluate("!!window.cropTestUrl"), true, "cross-origin current layers export automatically when their server permits CORS");
    } else {
      assert.equal(await evaluate("window.cropTestUrl===null && !document.getElementById('cropOriginalFallback').hidden && document.getElementById('cropExportMenu').textContent.includes('浏览器禁止导出其像素')"), true, "unreadable current layers offer original-file confirmation");
      const originalImage = path.join(artifacts, "image.png"), wrongImage = path.join(artifacts, "wrong.png");
      const wrongDimensions = path.join(artifacts, "wrong-dimensions", "image.png");
      fs.writeFileSync(originalImage, imageFixture);
      fs.writeFileSync(wrongImage, imageFixture);
      fs.mkdirSync(path.dirname(wrongDimensions), {recursive:true});
      fs.writeFileSync(wrongDimensions, Buffer.from(await evaluate("(()=>{const c=document.createElement('canvas');c.width=c.height=20;return c.toDataURL().split(',')[1];})()"), "base64"));
      await call("Page.setInterceptFileChooserDialog", {enabled:true});
      await click("cropChooseOriginalBtn");
      await chooseFile("#cropOriginalFile", wrongImage);
      await until(() => evaluate("document.getElementById('cropExportMenu').textContent.includes('所选文件不是当前原图')"));
      assert.equal(await evaluate("window.cropTestUrl"), null, "a different original filename cannot be silently exported");
      await click("cropChooseOriginalBtn");
      await chooseFile("#cropOriginalFile", wrongDimensions);
      await until(() => evaluate("document.getElementById('cropExportMenu').textContent.includes('原图尺寸与当前图层不一致')"));
      assert.equal(await evaluate("window.cropTestUrl"), null, "a same-name image with different dimensions cannot be silently exported");
      await click("cropChooseOriginalBtn");
      await chooseFile("#cropOriginalFile", originalImage);
      await until(() => evaluate("!!window.cropTestUrl && !document.getElementById('cropExportBtn').disabled"));
      assert.deepEqual(await evaluate("(async()=>{const b=await createImageBitmap(await(await fetch(cropTestUrl)).blob());const size=[b.width,b.height];b.close();return size;})()"), [280,224], "confirming the original exports the correct crop despite the layer's browser restriction");
      await evaluate("window.cropTestUrl=null;document.getElementById('canvasShell').dispatchEvent(new MouseEvent('contextmenu',{clientX:500,clientY:300,bubbles:true,cancelable:true}));document.getElementById('cropExportBtn').click()");
      await until(() => evaluate("!!window.cropTestUrl && !document.getElementById('cropExportBtn').disabled"));
      assert.equal(await evaluate("document.getElementById('cropOriginalFallback').hidden"), true, "a confirmed original is reused in the current page without another file choice");
      await call("Page.setInterceptFileChooserDialog", {enabled:false});
    }
    await evaluate("HTMLAnchorElement.prototype.click=originalCropClick;document.getElementById('cropExportMenu').hidden=true;editModeTest.selectObject(-1)");
  }
  await evaluate(`document.getElementById('mainImage').src=${JSON.stringify(currentLayer)}`);
  await until(() => evaluate("document.getElementById('mainImage').complete && document.getElementById('mainImage').naturalWidth===2000"));
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
  await call("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await pause(150);
  await evaluate("document.getElementById('labelFilter').value='edited';document.getElementById('applyFiltersBtn').click();editModeTest.selectObject(0);document.getElementById('labelZoomBtn').click();Object.assign(editModeTest.state,{showBoxes:false,zoom:1.7,panX:-120,panY:35});document.dispatchEvent(new Event('change'))");
  await until(() => evaluate("document.getElementById('attrsDraftStatus').textContent.includes('已自动保存')"));
  await call("Page.reload");
  await until(() => evaluate("!!window.editModeTest && !!editModeTest.state.data && document.getElementById('mainImage').naturalWidth===2000"));
  assert.equal(await exported(), edited, "reload restores the current tab's annotation data");
  assert.equal(await evaluate("editModeTest.state.showBoxes"), false, "reload retains display settings");
  assert.deepEqual(await evaluate("({filter:editModeTest.state.appliedFilters.label,selection:editModeTest.state.selectedObjectIndex})"), {filter:"edited",selection:0}, "reload restores the filter and selection");
  assert.equal(await evaluate("(() => {const s=editModeTest.state,c=document.getElementById('canvasShell'),zoom=Math.min(1,(c.clientWidth-24)/2000,(c.clientHeight-24)/1500);return !s.labelZoom && s.zoom===zoom && s.panX===Math.round((c.clientWidth-2000*zoom)/2) && s.panY===Math.round((c.clientHeight-1500*zoom)/2);})()"), true, "reload fits the entire image to the canvas instead of restoring the previous box focus or zoom");
  const currentUrl = await evaluate("location.href");
  await call("Page.navigate", {url:currentUrl});
  await until(() => evaluate("!!window.editModeTest"));
  await pause(300);
  assert.equal(await evaluate("editModeTest.state.data"), null, "fresh navigation does not open previous work");
  // Only the native picker is substituted. Directory reads and IndexedDB handle persistence are real.
  await evaluate(`(async () => {
    const root=await navigator.storage.getDirectory();
    const dir=await root.getDirectoryHandle('directory-fixtures',{create:true});
    const data={};
    for(const [name,color] of [['a','#ff0000'],['b','#0000ff']]) {
      const sub=await dir.getDirectoryHandle(name,{create:true});
      const file=await sub.getFileHandle('same.png',{create:true});
      const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1500;
      const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,2000,1500);
      const writable=await file.createWritable();await writable.write(await new Promise(r=>canvas.toBlob(r)));await writable.close();
      data[location.origin+'/directory-fixtures/'+name+'/same.png']={width:2000,height:1500,det:{objects:[{labels:['directory'],bbox:[100,100,300,100,300,260,100,260],attrs:{}}]}};
    }
    window.directoryPickerCalls=0;
    window.showDirectoryPicker=async options=>{if(options.mode!=='read')throw Error('Expected read-only picker');window.directoryPickerCalls++;return dir;};
    window.directoryFixture=JSON.stringify(data);
    editModeTest.loadJsonOnMainThread(directoryFixture);
    HTMLAnchorElement.prototype.click=function(){window.directoryCropUrl=this.href;};
  })()`);
  const openDirectoryCrop = async () => {
    await until(() => evaluate("document.getElementById('mainImage').complete && document.getElementById('mainImage').naturalWidth===2000"));
    await evaluate("editModeTest.selectObject(0);window.directoryCropUrl=null;document.getElementById('canvasShell').dispatchEvent(new MouseEvent('contextmenu',{clientX:500,clientY:300,bubbles:true,cancelable:true}))");
  };
  const cropPixel = async () => {
    await until(() => evaluate("!!window.directoryCropUrl && !document.getElementById('cropExportBtn').disabled"));
    return evaluate("(async()=>{const b=await createImageBitmap(await(await fetch(directoryCropUrl)).blob());const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();return Array.from(ctx.getImageData(0,0,1,1).data);})()");
  };
  await openDirectoryCrop();
  await click("cropChooseDirectoryBtn");
  assert.deepEqual(await cropPixel(), [255,0,0,255], "authorizing a folder immediately exports the matching original");
  await click("nextImageBtn");
  await openDirectoryCrop();
  await click("cropExportBtn");
  assert.deepEqual(await cropPixel(), [0,0,255,255], "same-named files in different subdirectories are never mixed");
  assert.equal(await evaluate("directoryPickerCalls"), 1, "switching images reuses one folder authorization");
  await until(() => evaluate("document.getElementById('attrsDraftStatus').textContent.includes('已自动保存')"));
  await call("Page.reload");
  await until(() => evaluate("!!window.editModeTest && !!editModeTest.state.data && document.getElementById('mainImage').naturalWidth===2000"));
  await evaluate("HTMLAnchorElement.prototype.click=function(){window.directoryCropUrl=this.href;};window.showDirectoryPicker=async()=>{throw Error('Unexpected picker after reload');}");
  await openDirectoryCrop();
  await click("cropExportBtn");
  assert.deepEqual(await cropPixel(), [0,0,255,255], "refresh restores real serialized directory handles and reads without another picker");
  await call("Page.captureScreenshot").then(result => fs.writeFileSync(path.join(artifacts,"directory-crop.png"),Buffer.from(result.data,"base64")));
  await call("Page.navigate", {url:currentUrl});
  await until(() => evaluate("!!window.editModeTest"));
  await pause(300);
  assert.equal(await evaluate("editModeTest.state.data"), null, "remembered directory authorization does not open old annotations in a fresh page");
  // The ordinary file:// entry supplies the real local path and confirms its original without a service.
  const localImage = path.join(artifacts, "本地 原图#100%.png"), localJson = path.join(artifacts, "local-annotations.json");
  fs.writeFileSync(localImage, imageFixture);
  fs.writeFileSync(localJson, JSON.stringify({[localImage]:{width:2000,height:1500,det:{objects:[{labels:["local"],bbox:[100,100,300,100,300,260,100,260],attrs:{}}]}}}));
  await call("Page.navigate", {url:require("node:url").pathToFileURL(path.join(root,"index.html")).href});
  await until(() => evaluate("!!window.AttributeUI && !!window.attachCropExport"));
  const dropData = {items:[],files:[localJson],dragOperationsMask:1};
  await call("Input.dispatchDragEvent", {type:"dragEnter",x:500,y:300,data:dropData});
  assert.equal(await evaluate("document.getElementById('jsonDropOverlay').hidden"), false, "dragging a file into the local page shows the import hint");
  await call("Page.captureScreenshot").then(result => fs.writeFileSync(path.join(artifacts,"json-drop.png"),Buffer.from(result.data,"base64")));
  await call("Input.dispatchDragEvent", {type:"dragOver",x:500,y:300,data:dropData});
  await call("Input.dispatchDragEvent", {type:"drop",x:500,y:300,data:dropData});
  await until(() => evaluate("document.getElementById('mainImage').complete && document.getElementById('mainImage').naturalWidth===2000"));
  assert.equal(await evaluate("document.getElementById('jsonDropOverlay').hidden && document.getElementById('jsonFileNameText').textContent==='local-annotations.json'"), true, "dropping imports annotations and updates the displayed filename");
  for (const files of [[localImage],[localJson,localJson]]) {
    const invalidDrop={items:[],files,dragOperationsMask:1};
    await call("Input.dispatchDragEvent", {type:"dragEnter",x:500,y:300,data:invalidDrop});
    await call("Input.dispatchDragEvent", {type:"dragOver",x:500,y:300,data:invalidDrop});
    await call("Input.dispatchDragEvent", {type:"drop",x:500,y:300,data:invalidDrop});
    assert.equal(await evaluate("document.getElementById('statusText').textContent.includes('请每次拖入一个 .json') && document.getElementById('jsonDropOverlay').hidden && !!document.querySelector('#objectList button[data-object-index=\"0\"]')"), true, "invalid drops retain the existing annotations and close the hint");
  }
  await evaluate("document.querySelector('#objectList button[data-object-index=\"0\"]').click();HTMLAnchorElement.prototype.click=function(){window.localCropUrl=this.href};document.getElementById('canvasShell').dispatchEvent(new MouseEvent('contextmenu',{clientX:500,clientY:300,bubbles:true,cancelable:true}));document.getElementById('cropExportBtn').click()");
  await until(() => evaluate("!document.getElementById('cropExportBtn').disabled"));
  assert.equal(await evaluate("document.getElementById('cropOriginalPath').value"), localImage, "the original path is taken from the current layer and decoded for the native file dialog");
  if (await evaluate("!document.getElementById('cropOriginalFallback').hidden")) {
    await call("Page.captureScreenshot").then(result => fs.writeFileSync(path.join(artifacts,"local-crop-confirm.png"),Buffer.from(result.data,"base64")));
    await call("Emulation.setFocusEmulationEnabled", {enabled:true});
    await call("Browser.grantPermissions", {permissions:["clipboardReadWrite","clipboardSanitizedWrite"]});
    await call("Page.setInterceptFileChooserDialog", {enabled:true});
    const count = fileChoosers.length;
    await call("Runtime.evaluate", {expression:"document.getElementById('cropChooseOriginalBtn').click()",userGesture:true,awaitPromise:true});
    await until(() => fileChoosers.length > count);
    assert.equal(await evaluate("navigator.clipboard.readText()"), localImage, "choosing the original copies the exact local path for paste and confirmation");
    await chooseFile("#cropOriginalFile", localImage);
    await until(() => evaluate("!!window.localCropUrl && !document.getElementById('cropExportBtn').disabled"));
    assert.deepEqual(await evaluate("(async()=>{const b=await createImageBitmap(await(await fetch(localCropUrl)).blob());const result=[b.width,b.height];b.close();return result;})()"), [280,224], "confirming a local original exports its pixels without any local service");
    await call("Page.setInterceptFileChooserDialog", {enabled:false});
  }
  assert.deepEqual(exceptions, []);
  console.log("PASS: default lock, box/handle/edge/keypoint gestures, enabled editing, undo, controls, shortcuts, pending placement, desktop/mobile screenshots");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (ws) ws.close();
  if (browser) browser.kill();
  server.close();
  imageServer.close();
});
