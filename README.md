# DET Objects 可视化工具

打开 `index.html` 即可使用。

## 支持的数据格式

只支持图片条目下的 `det.objects`：

```json
{
  "image.jpg": {
    "det": {
      "objects": [
        {
          "labels": ["class_name"],
          "bbox": [10, 10, 100, 10, 100, 80, 10, 80],
          "attrs": {}
        }
      ]
    }
  }
}
```

`bbox` 必须是四个点、八个绝对坐标：`x1, y1, x2, y2, x3, y3, x4, y4`。

## 使用

1. 在“图片 prefix”输入图片目录，例如 `D:/dataset/images/`。
2. 粘贴 JSON，或选择 JSON 文件导入。
3. 点击“加载数据”。
4. 滚轮缩放图片，按住图片区域拖动视图，点击“复位”回到完整居中视图。
5. 点击“框颜色”切换 object 框的颜色覆盖，使用“框粗细”调整框线基础粗细。
6. 在右侧选择 object，可拖动四个点，也可以编辑 labels 和 bbox 数字。
7. 点击“导出 JSON”下载修改后的标注。
