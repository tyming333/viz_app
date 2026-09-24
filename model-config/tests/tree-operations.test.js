const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
const n = (name, children = []) => ({current_model:name, last_output:"07", lable_name:name, code:"00001", num:"0", confidence:"0.5", non_defect:"false", childlist:children});
const data = {camera_config:[],line_name:[],model_route:[n("A",[n("B",[n("D"),n("E",[n("F")])]),n("C")]),n("X",[n("Y")])]};
const source = JSON.stringify(data, null, 2).replace(/\n/g,"\r\n").replace('"code": "00001"', '"large": 9007199254740993123, "escaped":"\\u4e2d", "code": "00001"');
const open = () => C.createDocument(new TextEncoder().encode(source),"source.json");
const a = ["model_route",0], b = [...a,"childlist",0], c = [...a,"childlist",1], x = ["model_route",1];
const names = nodes => nodes.map(n=>n.current_model);
function roundtrip(doc) {
  const after = doc.text;
  doc.undo(); assert.equal(doc.text,source); assert.equal(doc.canUndo,false);
  doc.redo(); assert.equal(doc.text,after);
  const exported=C.createDocument(doc.exportBytes(),"copy.json");
  assert.equal(exported.format.bom.length,0); assert.equal(exported.format.newline,"\r\n");
  assert.deepEqual(exported.data,doc.data);
}

test("deleting a branching node promotes children in-place and preserves every descendant",()=>{
  const doc=open(); const result=doc.deleteNode(b);
  assert.deepEqual(result,b);
  assert.deepEqual(names(doc.data.model_route[0].childlist),["D","E","C"]);
  assert.equal(doc.data.model_route[0].childlist[1].childlist[0].current_model,"F");
  assert.equal(C.routes(doc.data).length,C.routes(data).length-1);
  assert.match(doc.text,/9007199254740993123/); assert.match(doc.text,/\\u4e2d/);
  roundtrip(doc);
});
test("deleting root promotes multiple roots, leaf deletion and only-node deletion work",()=>{
  const doc=open(); doc.deleteNode(a);
  assert.deepEqual(names(doc.data.model_route),["B","C","X"]); roundtrip(doc);
  const leaf=open(); leaf.deleteNode(c); assert.deepEqual(names(leaf.data.model_route[0].childlist),["B"]); roundtrip(leaf);
  const empty=C.createDocument(new TextEncoder().encode(JSON.stringify({camera_config:[],line_name:[],model_route:[n("only")]})),"one.json");
  assert.equal(empty.deleteNode(["model_route",0]),null); assert.deepEqual(empty.data.model_route,[]); empty.undo(); assert.equal(empty.data.model_route.length,1);
});
test("single-node clipboard preserves numeric lexemes and extensions but excludes descendants",()=>{
  const doc=open(), raw=doc.copyNode(a);
  assert.deepEqual(JSON.parse(raw).childlist,[]);
  assert.match(raw,/9007199254740993123/); assert.match(raw,/\\u4e2d/);
  assert.equal(doc.canUndo,false);
  assert.deepEqual(doc.pasteNode(raw,x,"child"),[...x,"childlist",1]);
  assert.equal(doc.data.model_route[1].childlist[1].current_model,"A");
  assert.deepEqual(doc.data.model_route[1].childlist[1].childlist,[]);
  roundtrip(doc);
});
for (const [position,expected] of [["before",["B","B","C"]],["after",["B","C","B"]]]) {
  test(`paste ${position} creates exactly one independent node`,()=>{
    const doc=open(); doc.pasteNode(doc.copyNode(b),c,position);
    assert.deepEqual(names(doc.data.model_route[0].childlist),expected);
    assert.equal(C.routes(doc.data).length,C.routes(data).length+1); roundtrip(doc);
  });
}
test("paste as parent inserts into a chain and preserves target subtree, all in one undo",()=>{
  const doc=open(); doc.pasteNode(doc.copyNode(x),b,"parent");
  assert.deepEqual(names(doc.data.model_route[0].childlist),["X","C"]);
  assert.deepEqual(doc.data.model_route[0].childlist[0].childlist[0],data.model_route[0].childlist[0]);
  roundtrip(doc);
});
test("root paste supports empty documents and normalizes clipboard line endings to destination",()=>{
  const origin=open(), raw=origin.copyNode(a);
  const blank='{"camera_config":[],"line_name":[],"model_route":[]}';
  const dest=C.createDocument(new TextEncoder().encode(blank),"empty.json");
  assert.deepEqual(dest.pasteNode(raw,null,"root"),["model_route",0]);
  assert.ok(!dest.text.includes("\r")); assert.match(dest.text,/9007199254740993123/);
  dest.undo(); assert.equal(dest.text,blank);
});
test("indent and outdent carry all descendants and are single history entries",()=>{
  const doc=open(); assert.deepEqual(doc.indentNode(c),[...b,"childlist",2]);
  assert.deepEqual(names(doc.data.model_route[0].childlist),["B"]);
  assert.deepEqual(names(doc.data.model_route[0].childlist[0].childlist),["D","E","C"]); roundtrip(doc);
  const out=open(); assert.deepEqual(out.outdentNode(b),["model_route",1]);
  assert.deepEqual(names(out.data.model_route),["A","B","X"]);
  assert.deepEqual(out.data.model_route[1],data.model_route[0].childlist[0]); roundtrip(out);
});
test("move into a later root accounts for source removal shifting destination path",()=>{
  const doc=open(); const at=doc.moveNode(a,[...x,"childlist",0],"after");
  assert.deepEqual(at,["model_route",0,"childlist",1]);
  assert.deepEqual(names(doc.data.model_route),["X"]);
  assert.deepEqual(names(doc.data.model_route[0].childlist),["Y","A"]);
  assert.equal(C.routes(doc.data).length,C.routes(data).length); roundtrip(doc);
});
test("cross-parent relocation, same-list relocation and root relocation preserve order",()=>{
  const doc=open(); doc.moveNode(b,x,"before");
  assert.deepEqual(names(doc.data.model_route),["A","B","X"]); roundtrip(doc);
  const same=open(); same.moveNode(b,c,"after"); assert.deepEqual(names(same.data.model_route[0].childlist),["C","B"]); roundtrip(same);
  const root=open(); root.moveNode(b,null,"root"); assert.deepEqual(names(root.data.model_route),["A","X","B"]); roundtrip(root);
});
test("illegal moves or failed staged changes leave text and history untouched",()=>{
  const doc=open();
  for(const action of [()=>doc.moveNode(a,b,"child"),()=>doc.moveNode(b,b,"after"),()=>doc.indentNode(b),()=>doc.outdentNode(a),()=>doc.moveNode(b,["model_route",99],"child"),()=>doc.pasteNode(doc.copyNode(a,true),x,"parent")]) {
    assert.throws(action); assert.equal(doc.text,source); assert.equal(doc.canUndo,false);
  }
  doc.set([...a,"confidence"],"0.7"); doc.undo(); assert.equal(doc.canRedo,true);
  assert.throws(()=>doc.moveNode(a,b,"child")); assert.equal(doc.canRedo,true);
});

for (const encoding of ["utf-8","utf-16le","utf-16be"]) for (const hasBom of [false,true]) {
  test(`structural transactions keep ${encoding}, BOM=${hasBom} and exact undo bytes`,()=>{
    const boms={"utf-8":[239,187,191],"utf-16le":[255,254],"utf-16be":[254,255]};
    const format={encoding,bom:new Uint8Array(hasBom?boms[encoding]:[])};
    const bytes=C.encode(source,format), doc=C.createDocument(bytes,"config.json");
    doc.outdentNode(b);
    doc.deleteNode(["model_route",1]);
    doc.pasteNode(doc.copyNode(["model_route",0]),["model_route",1],"parent");
    const result=C.createDocument(doc.exportBytes(),"copy.json");
    assert.equal(result.format.encoding,encoding); assert.deepEqual(result.format.bom,format.bom);
    assert.equal(result.format.newline,"\r\n"); assert.match(result.text,/9007199254740993123/);
    assert.deepEqual(result.data,doc.data);
    for(let i=0;i<3;i++)doc.undo();
    assert.deepEqual(doc.exportBytes(),bytes);
  });
}
