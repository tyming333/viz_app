(function (root) {
  "use strict";
  const DB_NAME = "field-defect-history";
  const STORE_NAME = "projects";

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持工程历史记录"));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开工程历史记录"));
    });
  }

  async function transaction(mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = action(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("工程历史记录操作失败"));
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error || new Error("工程历史记录事务失败"));
    });
  }

  root.FieldDefectStore = {
    async list() {
      const records = await transaction("readonly", (store) => store.getAll());
      return records || [];
    },
    save(record) { return transaction("readwrite", (store) => store.put(record)); },
    remove(id) { return transaction("readwrite", (store) => store.delete(id)); },
    async get(id) { return transaction("readonly", (store) => store.get(id)); }
  };
})(globalThis);
