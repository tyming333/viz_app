import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "update_classification_json.py"


def load_script_module():
    spec = importlib.util.spec_from_file_location("update_classification_json", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class UpdateClassificationJsonTest(unittest.TestCase):
    def test_matches_by_filename_updates_keys_and_labels_and_drops_missing(self):
        module = load_script_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_root = root / "imgs"
            category_a = image_root / "类别A"
            category_b = image_root / "类别B"
            category_a.mkdir(parents=True)
            category_b.mkdir(parents=True)
            (category_a / "a.jpg").touch()
            (category_b / "b.png").touch()
            (category_b / "Thumbs.db").touch()

            source = {
                "//old/旧类别/a.jpg": {
                    "width": 10,
                    "det": {"objects": [{"labels": ["旧标签"], "bbox": [0] * 8, "attrs": {}}]},
                },
                "//old/旧类别/b.png": {
                    "width": 20,
                    "det": {"objects": []},
                },
                "//old/旧类别/missing.jpg": {
                    "width": 30,
                    "det": {"objects": [{"labels": ["旧标签"], "bbox": [1] * 8, "attrs": {}}]},
                },
            }

            updated, stats = module.update_records(source, image_root)

            expected_a_key = (category_a / "a.jpg").resolve().as_posix()
            expected_b_key = (category_b / "b.png").resolve().as_posix()
            self.assertEqual(list(updated), [expected_a_key, expected_b_key])
            self.assertEqual(updated[expected_a_key]["det"]["objects"][0]["labels"], ["类别A"])
            self.assertEqual(updated[expected_b_key]["det"]["objects"], [])
            self.assertEqual(updated[expected_a_key]["width"], 10)
            self.assertEqual(stats.matched, 2)
            self.assertEqual(stats.removed, 1)
            self.assertEqual(stats.objects_relabelled, 1)
            self.assertEqual(stats.empty_object_records, 1)

    def test_rejects_duplicate_image_filenames_across_categories(self):
        module = load_script_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            image_root = Path(temp_dir) / "imgs"
            (image_root / "类别A").mkdir(parents=True)
            (image_root / "类别B").mkdir(parents=True)
            (image_root / "类别A" / "same.jpg").touch()
            (image_root / "类别B" / "same.jpg").touch()

            with self.assertRaisesRegex(ValueError, "same.jpg"):
                module.update_records({}, image_root)

    def test_write_json_keeps_literal_chinese(self):
        module = load_script_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.json"
            module.write_json_atomic(output_path, {"C:/图片.jpg": {"det": {"objects": []}}})

            text = output_path.read_text(encoding="utf-8")
            self.assertIn("图片.jpg", text)
            self.assertNotIn("\\u56fe", text)
            self.assertEqual(json.loads(text)["C:/图片.jpg"]["det"]["objects"], [])


if __name__ == "__main__":
    unittest.main()
