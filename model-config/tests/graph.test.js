const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
const { buildTree } = require("../graph.js");
const leaf = name => ({current_model: name, last_output: "0", childlist: []});
const config = { model_route: [{ ...leaf("root"), childlist: [{ ...leaf("same.onnx"), childlist: [leaf("target"), leaf("second")] }, leaf("same.onnx")] }, leaf("other-root")] };
test("label_name participates in recursive search without changing incoming indexes or hierarchy", () => {
  const roots = [{...leaf("parent"),childlist:[{...leaf("child"),last_output:"07",label_name:"双螺母正常"}]}];
  const result = buildTree(roots, new Set(), "双螺母");
  assert.equal(result[0].children[0].value.last_output, "07");
  assert.equal(result[0].children[0].title, "双螺母正常 · child");
  assert.deepEqual(result[0].children[0].path, ["model_route",0,"childlist",0]);
});
test("search and title use lable_name from the real configuration spelling", () => {
  const tree = buildTree([{...leaf("dw_ls_2.onnx"), last_output:"0", lable_name:"安装底座"}], new Set(), "安装底座");
  assert.equal(tree[0].title, "安装底座 · dw_ls_2.onnx");
  assert.equal(tree[0].match, true);
});
test("childlist recursively defines parents, sibling order and distinct repeated models", () => {
  const tree = buildTree(config.model_route);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].descendants, 4);
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[0].children[0].title, "target");
  assert.equal(tree[0].children[0].title, tree[0].children[1].title);
  assert.notEqual(tree[0].children[0].key, tree[0].children[1].key);
  assert.deepEqual(tree[0].children[0].children[1].path, ["model_route",0,"childlist",0,"childlist",1]);
  assert.deepEqual(tree[0].children[0].children[1].indices, [1,1,2]);
});
test("folding a node hides only its descendants; searching keeps the recursive ancestor chain", () => {
  const collapsed = new Set([JSON.stringify(["model_route",0,"childlist",0])]);
  const tree = buildTree(config.model_route, collapsed);
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[0].children.length, 0);
  assert.equal(tree[0].children[0].descendants, 2);
  assert.equal(tree[0].children[1].title, "same.onnx");
  const found = buildTree(config.model_route, collapsed, "target");
  assert.equal(found.length, 1);
  assert.equal(found[0].children.length, 1);
  assert.equal(found[0].children[0].children[0].match, true);
  assert.equal(found[0].children[0].children.length, 1);
  assert.equal(buildTree(config.model_route, collapsed, "missing").length, 0);
});
test("deep trees, empty trees and multiple roots retain every occurrence", () => {
  let node = leaf("end");
  for (let i = 0; i < 30; i++) node = {...leaf("same"), childlist:[node]};
  const tree = buildTree([node]);
  assert.equal(tree[0].descendants, 30);
  let nested = tree[0];
  for (let i = 0; i < 30; i++) nested = nested.children[0];
  assert.equal(nested.depth, 30);
  assert.equal(nested.title, "end");
  assert.deepEqual(buildTree([]), []);
});
test("editing, copying, moving and removing a nested subtree preserves unrelated siblings", () => {
  const original = JSON.stringify({...config, camera_config:[], line_name:[]});
  const doc = C.createDocument(new TextEncoder().encode(original), "tree.json");
  const branch = ["model_route",0,"childlist",0];
  doc.set([...branch,"childlist",1,"current_model"], "edited");
  assert.equal(doc.data.model_route[0].childlist[1].current_model,"same.onnx");
  doc.insert(branch.slice(0,-1),1,doc.raw(branch));
  assert.equal(doc.data.model_route[0].childlist[1].childlist[1].current_model,"edited");
  doc.move([...branch.slice(0,-1),1],1);
  assert.equal(doc.data.model_route[0].childlist[1].childlist.length,0);
  doc.remove([...branch.slice(0,-1),2]);
  assert.equal(doc.data.model_route[0].childlist.length,2);
  for(let i=0;i<4;i++) doc.undo();
  assert.equal(doc.text,original);
});
