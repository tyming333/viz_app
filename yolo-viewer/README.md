# YOLO 数据可视化

直接打开 `index.html`，或在现有工具顶部选择“YOLO 数据可视化”。代码、样式和绘图核心由现有可视化工具复制而来，独立维护；只有应用切换菜单使用 `../shared/`。

## 数据导入

选择数据文件夹和标签映射，点击“加载数据”。图片和检测 TXT 必须位于同一目录且文件名相同，允许子目录。相同文件名的不同扩展名图片会作为歧义数据跳过。

```text
dataset/
  data.yaml
  001.jpg
  001.txt
  sub/
    001.png
    001.txt
```

每个 TXT 一行一个目标，格式为 `class_id x_center y_center width height`。坐标归一化到 0~1；只支持检测矩形，不支持分割、旋转框和关键点。

自动识别根目录的 `data.yaml`、`dataset.yaml`、`data.yml`、`classes.json`、`labels.json`、`label_map.json`、`classes.txt` 或 `obj.names`，按上述顺序优先选择；也可手动指定文件。映射格式支持：

- JSON 的 ID 到名称对象、名称到数字 ID 对象、名称数组，或包含 `names` 的对象。
- YAML 的 `names` 对象或数组。
- TXT / names 每行一个名称，行号从 0 开始作为类别 ID。

类别 ID 和名称必须唯一。编辑时从映射中选择类别，新增框默认使用映射中第一个类别。类别颜色由完整映射确定，筛选或增删框不会改变其颜色。

空 TXT 是负样本。缺少 TXT 默认跳过，也可勾选“缺少 TXT 作为负样本”。损坏图片、未知 ID 和非法标注会列入问题清单；非法 TXT 对应图片整张跳过，避免部分标注丢失。

图片和标注由浏览器在本地读取，不上传；读取尺寸最多并发 4 张，完成后保留 File 引用供预览和导出。

## 编辑和导出

默认关闭编辑。原工具的筛选、批量预览、包含框、标签缩放、样式调整和撤销功能沿用。

“导出 YOLO”导出全部成功加载的数据；“选择导出”只导出列表勾选的数据。ZIP 包含原图、编辑后的同名 TXT，以及完整的 `labels.json` 映射。相对目录和原始类别 ID 保留，源文件不被覆盖。

ZIP 导出需要把所选图片和最终压缩包放入内存；大型数据集建议分批勾选导出。

## 验证

```powershell
node --test tests/*.test.js yolo-viewer/tests/*.test.js
node yolo-viewer/tests/browser-smoke.cjs <artifact-directory>
```

浏览器测试使用 Edge，通过实际文件夹导入验证配对、坐标转换、筛选、编辑、错误清单、负样本、ZIP 导出及桌面/窄屏截图。

格式参考：[Ultralytics 检测数据格式](https://docs.ultralytics.com/datasets/detect/)。

## 本地依赖

依赖固定版本并随页面保存，离线使用无需 CDN：

- [js-yaml 4.1.1](https://github.com/nodeca/js-yaml)，MIT，解析 YAML。
- [fflate 0.8.2](https://github.com/101arrowz/fflate)，MIT，生成 ZIP。

许可证位于 `vendor/`。
