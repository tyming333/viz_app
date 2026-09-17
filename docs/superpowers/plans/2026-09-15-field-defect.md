# 现场缺陷展示 Implementation Plan

> **For agentic workers:** This plan is executed inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有静态查看器旁新增隔离的现场缺陷展示应用，支持工程目录、递归图片、缺陷配置、图片预览和 Excel 内嵌图片导入。

**Architecture:** 共享入口只负责应用切换；`field-defect/` 内的 core、store、zip 图片提取和 UI 分离。文件系统使用 File System Access API，历史工程使用 IndexedDB，工程配置写入工程根目录。

**Tech Stack:** 原生 HTML/CSS/JavaScript、File System Access API、IndexedDB、浏览器 `DecompressionStream`、Web Crypto SHA-256。

**Spec:** `docs/superpowers/specs/2026-09-15-field-defect-design.md`

## Global Constraints

- 不引入前端框架或后端服务。
- Excel 只处理文件内部的 `xl/media` 图片资源。
- 支持 JPG/JPEG、PNG、BMP、WEBP；递归扫描工程子目录。
- 去重同时覆盖当前 Excel、本次导入和工程已有图片。
- 现有 `app.js` 的数据查看、标注和导出逻辑保持不变。

---

### Task 1: Core contracts and extraction helpers

**Files:**
- Create: `field-defect/core.js`
- Test: `field-defect/tests/core.test.js`

- [x] Write failing tests for image filtering, project normalization, duplicate selection and ZIP entry filtering.
- [x] Run the tests and confirm they fail because `core.js` is absent.
- [x] Implement the pure helpers and browser-safe ZIP entry metadata parser.
- [x] Run the tests again and confirm all pass.

### Task 2: Independent app shell and shared switcher

**Files:**
- Create: `shared/app-switcher.js`
- Create: `shared/app-switcher.css`
- Create: `field-defect/index.html`
- Create: `field-defect/styles.css`
- Modify: `index.html`
- Modify: `styles.css`

- [x] Add a two-option application select to both pages.
- [x] Add the field-defect shell with project rail, toolbar, image table and modal.
- [x] Keep existing viewer DOM IDs untouched.

### Task 3: Project persistence and recursive scanning

**Files:**
- Create: `field-defect/project-store.js`
- Create: `field-defect/project-repository.js`
- Create: `field-defect/app.js`

- [x] Implement directory permission checks, recursive supported-image scanning, progress callbacks and `field-defect-project.json` read/write.
- [x] Implement IndexedDB history of directory handles.
- [x] Connect create/open/rescan flows and render the empty state.

### Task 4: Defect catalog and image workflow

**Files:**
- Modify: `field-defect/app.js`
- Modify: `field-defect/styles.css`

- [x] Add catalog management, multi-select image defects and auto-save.
- [x] Add image modal with zoom, pan, previous/next and Escape handling.
- [x] Add progress and error states for permission loss and malformed config.

### Task 5: Embedded Excel image import

**Files:**
- Modify: `field-defect/core.js`
- Modify: `field-defect/app.js`

- [x] Parse ZIP central directory entries using browser-native decompression.
- [x] Extract only `xl/media/*`, infer MIME types, hash bytes and compare against existing project hashes.
- [x] Write new images under `images/imports/<Excel stem>/` and update project records without reading workbook text.
- [x] Show added, duplicate-existing, duplicate-in-file and failed counts with a progress bar.

### Task 6: Verification

**Files:**
- Test: `field-defect/tests/core.test.js`

- [x] Run Node syntax checks for all scripts.
- [x] Run the core test suite.
- [x] Run a static reference audit for missing script/style paths.
- [x] Run Edge desktop/mobile UI smoke checks and browser-native raw-deflate extraction.
- [ ] Manually select a real project directory and import a real production `.xlsx`; report this user-gesture boundary explicitly.
