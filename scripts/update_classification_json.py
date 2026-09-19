"""按分类图片目录更新标准 DET JSON 的 key 和 labels。"""

from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path


# ============================== 配置区 ==============================
# 原始 JSON：脚本会原地更新该文件。
JSON_PATH = Path(
    r"C:\Users\MSI\Desktop\20260911-苏州8缺陷标注_角钢上方螺母分类"
    r"\20260911-苏州8缺陷标注_角钢上方螺母分类.json"
)

# 分类图片根目录：其直接子文件夹名会作为对应图片的新 labels。
IMAGE_ROOT = Path(
    r"C:\Users\MSI\Desktop\20260911-苏州8缺陷标注_角钢上方螺母分类\imgs"
)

# True：更新前在 JSON 同目录生成带时间戳的备份；False：不生成备份。
CREATE_BACKUP = True

# 可参与匹配的图片扩展名；比较时忽略扩展名大小写。
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
# ===================================================================


class UpdateStats:
    def __init__(
        self,
        matched: int,
        removed: int,
        objects_relabelled: int,
        empty_object_records: int,
    ) -> None:
        self.matched = matched
        self.removed = removed
        self.objects_relabelled = objects_relabelled
        self.empty_object_records = empty_object_records


def build_image_index(image_root: Path) -> dict[str, Path]:
    """以文件名建立索引；重名时终止，防止图片被错误归类。"""
    if not image_root.is_dir():
        raise FileNotFoundError(f"图片目录不存在：{image_root}")

    index: dict[str, Path] = {}
    duplicates: list[str] = []
    for image_path in sorted(image_root.rglob("*")):
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if image_path.name in index:
            duplicates.append(image_path.name)
            continue
        index[image_path.name] = image_path.resolve()

    if duplicates:
        names = "、".join(sorted(set(duplicates)))
        raise ValueError(f"分类目录中存在重名图片，无法唯一匹配：{names}")
    return index


def update_records(
    source: dict[str, object],
    image_root: Path,
    progress_callback=None,
) -> tuple[dict[str, object], UpdateStats]:
    """按 basename 匹配图片，删除未匹配记录并更新 key 与对象 labels。"""
    if not isinstance(source, dict):
        raise ValueError("JSON 根节点必须是对象")

    image_index = build_image_index(image_root)
    updated: dict[str, object] = {}
    removed = 0
    objects_relabelled = 0
    empty_object_records = 0
    total = len(source)

    for current, (old_key, original_entry) in enumerate(source.items(), start=1):
        filename = str(old_key).replace("\\", "/").rsplit("/", 1)[-1]
        image_path = image_index.get(filename)
        if image_path is None:
            removed += 1
        else:
            entry = copy.deepcopy(original_entry)
            if not isinstance(entry, dict):
                raise ValueError(f"记录不是对象：{old_key}")
            objects = entry.get("det", {}).get("objects")
            if not isinstance(objects, list):
                raise ValueError(f"记录缺少 det.objects 数组：{old_key}")

            # 直接父目录就是人工分类类别；每个已有对象均使用同一类别。
            category = image_path.parent.name
            if not objects:
                empty_object_records += 1
            for obj in objects:
                if not isinstance(obj, dict):
                    raise ValueError(f"det.objects 中存在非对象内容：{old_key}")
                obj["labels"] = [category]
                objects_relabelled += 1

            # 使用正斜杠保存绝对路径，兼容浏览器和 Windows 路径解析。
            new_key = image_path.as_posix()
            updated[new_key] = entry

        if progress_callback is not None:
            progress_callback(current, total)

    stats = UpdateStats(
        matched=len(updated),
        removed=removed,
        objects_relabelled=objects_relabelled,
        empty_object_records=empty_object_records,
    )
    return updated, stats


def write_json_atomic(output_path: Path, data: dict[str, object]) -> None:
    """先写同目录临时文件，成功后再替换目标，避免产生半截 JSON。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            suffix=".tmp",
            prefix=output_path.stem + "_",
            dir=output_path.parent,
            delete=False,
        ) as temp_file:
            temp_name = temp_file.name
            json.dump(data, temp_file, ensure_ascii=False, indent=2)
            temp_file.write("\n")
        os.replace(temp_name, output_path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def print_progress(current: int, total: int) -> None:
    """在同一行显示处理进度，数据量较大时也能看到当前状态。"""
    width = 30
    ratio = 1.0 if total == 0 else current / total
    completed = round(width * ratio)
    bar = "#" * completed + "-" * (width - completed)
    print(f"\r处理进度 [{bar}] {current}/{total} ({ratio:6.2%})", end="", flush=True)
    if current == total:
        print()


def main() -> None:
    if not JSON_PATH.is_file():
        raise FileNotFoundError(f"JSON 文件不存在：{JSON_PATH}")

    with JSON_PATH.open("r", encoding="utf-8") as source_file:
        source = json.load(source_file)

    updated, stats = update_records(source, IMAGE_ROOT, print_progress)

    backup_path = None
    if CREATE_BACKUP:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = JSON_PATH.with_name(f"{JSON_PATH.stem}.backup_{timestamp}{JSON_PATH.suffix}")
        shutil.copy2(JSON_PATH, backup_path)

    write_json_atomic(JSON_PATH, updated)

    print(f"更新完成：保留 {stats.matched} 条，删除 {stats.removed} 条。")
    print(f"已更新 labels 的对象：{stats.objects_relabelled} 个。")
    print(f"保留 objects 为空的记录：{stats.empty_object_records} 条。")
    if backup_path is not None:
        print(f"原文件备份：{backup_path}")


if __name__ == "__main__":
    main()
