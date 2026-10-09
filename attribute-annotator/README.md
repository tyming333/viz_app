# 属性标注工具

从应用菜单选择“属性标注工具”，或直接打开本目录的 `index.html`。这里独立复制了标准 JSON 可视化工具的代码、样式和 Worker；原工具只通过公共应用菜单增加入口。

首次进入先配置属性选择表。每个属性组填写一个组名和若干可选属性名，每行一个；同组只允许选择一个，所有组的属性名不能重复。配置可以单独导出为 `attrs-selection-table.json`，下次通过“导入配置”重新使用。导入、导出、应用配置本身不会修改标注 JSON。

配置示例：

```json
{
  "version": 1,
  "groups": [
    {"name": "外观状态", "options": ["正常", "松动", "缺失"]},
    {"name": "遮挡状态", "options": ["无遮挡", "遮挡"]}
  ]
}
```

按原工具的方式导入标准 JSON 并设置图片 prefix。中间工作区左侧看图、右侧点击属性状态；切图时自动选中第一个符合标签筛选的框，多框图片可通过“当前标注框”、图上点击或 Objects 列表切换。选择属性不需要开启框编辑，移动或修改框仍需要“编辑”按钮。

状态直接保存为 object 内的 `score_attrs` 属性名数组，与 `attrs` 平级。组名不写入标注文件，也不写入分数：

```json
{
  "example.jpg": {
    "width": 640,
    "height": 182,
    "det": {
      "objects": [
        {
          "labels": ["正常无遮挡螺母"],
          "bbox": [56, 102, 90, 102, 90, 174, 56, 174],
          "attrs": {},
          "score_attrs": ["正常", "无遮挡"]
        }
      ]
    }
  }
}
```

选择新状态会替换该组旧状态；“清空该组”只清除本组，配置之外的已有属性保留。未标注的框不自动增加字段。已有 `score_attrs` 若不是属性名数组，会显示提示并停止该框的属性写入。属性修改可点击“撤销上一步”或按 Ctrl+Z 撤销；切图保留配置和各框的选择结果。批量预览期间停止属性写入。

点击顶部“导出 JSON”保存全部修改；“选择导出”沿用原工具导出勾选图片和标准 JSON 的功能。属性配置单独导出，不混入标注文件。

验证：

```powershell
node --test tests/*.test.js yolo-viewer/tests/*.test.js attribute-annotator/tests/*.test.js
node attribute-annotator/tests/browser-smoke.cjs <截图输出目录>
```

浏览器测试支持设置 `ATTRS_TEST_FILE_URL=1` 验证直接打开 HTML 的工作方式，默认通过本地 HTTP 验证 Worker 导入流程。
