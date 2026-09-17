const test = require("node:test");
const assert = require("node:assert/strict");

global.FieldDefectCore = require("../core.js");
require("../project-repository.js");
const Repo = global.FieldDefectRepository;

class MemoryFileHandle {
  constructor(name, bytes) {
    this.kind = "file";
    this.name = name;
    this.bytes = Buffer.from(bytes || "");
  }

  async getFile() { return new Blob([this.bytes]); }

  async createWritable() {
    return {
      write: async (blob) => { this.bytes = Buffer.from(await blob.arrayBuffer()); },
      close: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.children = new Map();
  }

  addDirectory(name) {
    const child = new MemoryDirectoryHandle(name);
    this.children.set(name, child);
    return child;
  }

  addFile(name, bytes) {
    const child = new MemoryFileHandle(name, bytes);
    this.children.set(name, child);
    return child;
  }

  async *values() { yield* this.children.values(); }

  async getDirectoryHandle(name, options) {
    const found = this.children.get(name);
    if (found && found.kind === "directory") return found;
    if (options && options.create) return this.addDirectory(name);
    throw Object.assign(new Error("not found"), { name: "NotFoundError" });
  }

  async getFileHandle(name, options) {
    const found = this.children.get(name);
    if (found && found.kind === "file") return found;
    if (options && options.create) return this.addFile(name, "");
    throw Object.assign(new Error("not found"), { name: "NotFoundError" });
  }

  async removeEntry(name, options) {
    const found = this.children.get(name);
    if (!found) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    if (found.kind === "directory" && found.children.size && !(options && options.recursive)) throw new Error("directory not empty");
    this.children.delete(name);
  }
}

test("copies nested files and preserves empty directories with progress", async () => {
  const source = new MemoryDirectoryHandle("source");
  source.addFile("root.txt", "root-content");
  source.addDirectory("nested").addFile("child.txt", "child-content");
  source.addDirectory("empty");
  const project = new MemoryDirectoryHandle("project");
  const progress = [];

  const result = await Repo.copyDirectory(source, project, "original-defects/source", (item) => progress.push(item));

  assert.equal(result.total, 2);
  assert.equal((await Repo.getDirectoryHandle(project, "original-defects/source/empty")).name, "empty");
  assert.equal(await (await Repo.readBlob(project, "original-defects/source/root.txt")).text(), "root-content");
  assert.equal(await (await Repo.readBlob(project, "original-defects/source/nested/child.txt")).text(), "child-content");
  assert.deepEqual(progress.filter((item) => item.phase === "copy").map((item) => item.current), [1, 2]);
});

test("removes the destination directory when a recursive copy fails", async () => {
  const source = new MemoryDirectoryHandle("source");
  source.addFile("ok.txt", "ok");
  const broken = source.addFile("broken.txt", "broken");
  broken.getFile = async () => { throw new Error("read failed"); };
  const project = new MemoryDirectoryHandle("project");

  await assert.rejects(Repo.copyDirectory(source, project, "original-defects/source"), /read failed/);
  await assert.rejects(Repo.getDirectoryHandle(project, "original-defects/source"), { name: "NotFoundError" });
});

test("creates a new project with the default defect catalog", async () => {
  const root = new MemoryDirectoryHandle("new-project");

  const created = await Repo.createProject(root, "测试工程");

  assert.equal(created.project.defects.length, 69);
  assert.equal(new Set(created.project.defects.map((item) => item.name)).size, 69);
  assert.ok(created.project.defects.every((item) => item.disabled === false));
});
