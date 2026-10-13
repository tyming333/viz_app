const test = require("node:test");
const assert = require("node:assert/strict");
const { sourcePath, relativePath, createManager } = require("../local-image-directory.js");

const selected = path => ({ image: path, source: "file:///" + path.replace(/\\/g, "/") });
function directory(name, files) {
  return {
    name, permission: "granted",
    async queryPermission(options) { assert.equal(options.mode, "read"); return this.permission; },
    async requestPermission(options) { assert.equal(options.mode, "read"); return this.permission = "granted"; },
    async getDirectoryHandle(part) {
      const nested = Object.fromEntries(Object.entries(files).filter(([key]) => key.startsWith(part + "/")).map(([key, value]) => [key.slice(part.length + 1), value]));
      if (!Object.keys(nested).length) throw Object.assign(new Error(), { name: "NotFoundError" });
      return directory(part, nested);
    },
    async getFileHandle(part) {
      if (!(part in files)) throw Object.assign(new Error(), { name: "NotFoundError" });
      return { getFile: async () => files[part] };
    }
  };
}
function storage() { return { saved: [], async load() { return this.saved; }, async save(value) { this.saved = value; } }; }

test("local and remote source paths preserve complete subdirectories and reject traversal", () => {
  assert.equal(sourcePath({ source: "file:///D:/images/%E4%B8%AD%20%23100%25.png" }), "D:/images/中 #100%.png");
  assert.deepEqual(relativePath("d:/IMAGES/sub/a.png", "D:/images"), ["sub", "a.png"]);
  assert.deepEqual(relativePath("\\\\server\\share\\sub\\a.png", "//server/share"), ["sub", "a.png"]);
  for (const path of ["D:/images2/a.png", "D:/images/../a.png", "D:/images//a.png", "D:/images/./a.png"]) assert.equal(relativePath(path, "D:/images"), null);
  assert.equal(sourcePath({ source: "https://example.com/images/a%20b.png?q=1" }), "https://example.com/images/a b.png");
});

test("one root reads same-named images from their own subfolders and survives manager recreation", async () => {
  const saved = storage(), manager = createManager(saved);
  const handle = directory("images", { "a/same.png": "first", "b/same.png": "second" });
  await manager.register(handle, selected("D:/images/a/same.png"));
  assert.equal(await manager.read(selected("D:/images/b/same.png")), "second");
  const restored = createManager(saved);
  assert.equal(await restored.read(selected("D:/images/a/same.png")), "first");
  assert.equal(await restored.read(selected("D:/unrelated/a/same.png")), null);
  await assert.rejects(restored.read(selected("D:/images/c/same.png")), { code: "directory-file" });
});

test("ambiguous roots require explicit mapping; relocated or renamed roots work", async () => {
  const manager = createManager(storage());
  const ambiguous = directory("images", { "a/same.png": "nested", "same.png": "direct" });
  await assert.rejects(manager.register(ambiguous, selected("D:/images/a/same.png")), { code: "directory-map" });
  assert.equal(await manager.read(selected("D:/images/a/same.png")), null);
  await manager.register(ambiguous, selected("D:/images/a/same.png"), "D:/images");
  assert.equal(await manager.read(selected("D:/images/a/same.png")), "nested");
  await manager.register(directory("moved", { "a/same.png": "relocated" }), selected("D:/images/a/same.png"), "D:/images");
  assert.equal(await manager.read(selected("D:/images/a/same.png")), "relocated");
});

test("permission loss is explicit and can be renewed without choosing a different image", async () => {
  const manager = createManager(storage()), handle = directory("images", { "a.png": "image" });
  const image = selected("D:/images/a.png");
  await manager.register(handle, image);
  handle.permission = "prompt";
  await assert.rejects(manager.read(image), { code: "directory-permission" });
  assert.equal(await manager.requestAccess(image), true);
  assert.equal(await manager.read(image), "image");
});

test("failed validation leaves prior mapping intact; replacing Windows root ignores casing", async () => {
  const manager = createManager(storage()), image = selected("D:/images/a.png");
  await manager.register(directory("images", { "a.png": "old" }), image);
  await assert.rejects(manager.register(directory("images", { "a.png": "invalid" }), image, undefined, async () => { throw new Error("dimensions differ"); }), /dimensions differ/);
  assert.equal(await manager.read(image), "old");
  await manager.register(directory("images", { "a.png": "new" }), image, "d:/IMAGES");
  assert.equal(await manager.read(image), "new");
});

test("persistence failure retains the current authorization and is exposed to the UI", async () => {
  const manager = createManager({ load: async () => [], save: async () => { throw new Error("storage unavailable"); } });
  const image = selected("D:/images/a.png");
  await manager.register(directory("images", { "a.png": "image" }), image);
  assert.equal(await manager.read(image), "image");
  assert.match(manager.persistenceError().message, /storage unavailable/);
});
