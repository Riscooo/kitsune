#!/usr/bin/env python3
"""Preset backgrounds: catalog from the engine, hash-checked downloads, no Firefox art."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kitsune_wallpapers", ROOT / "install/wallpapers.py")
wallpapers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wallpapers)


def png(color, size=(800, 500)):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format="PNG")
    return output.getvalue()


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class WallpaperTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kitsune-wallpapers-test-")
        self.root = Path(self.temporary.name)
        self.engine = self.root / "engine"
        (self.engine / "browser").mkdir(parents=True)
        self.library = self.root / "wallpapers"
        self.photo, self.bad = png("teal"), png("red")
        self.served = {"main-workspace/w/photo.png": self.photo, "main-workspace/w/bad.png": self.bad,
                       "main-workspace/w/brand.png": png("orange")}
        self.requests = []
        entry = lambda i, category, **extra: {"id": f"{i:08d}-0000-4000-8000-000000000000", "category": category, "title": str(i), **extra}
        attachment = lambda name, body, digest=None: {"attachment": {"location": f"main-workspace/w/{name}", "size": len(body),
                                                                    "hash": digest or hashlib.sha256(body).hexdigest(), "mimetype": "image/png"}}
        catalog = [entry(1, "photographs", attribution={"name": {"string": "Ana"}}, **attachment("photo.png", self.photo)),
                   entry(2, "solid-colors", solid_color="#76C1FF"),
                   entry(3, "abstracts", **attachment("bad.png", self.bad, "0" * 64)),
                   entry(4, "firefox", **attachment("brand.png", self.served["main-workspace/w/brand.png"])),
                   entry(5, "abstracts", attachment={"location": "../escape", "size": 1, "hash": "0" * 64, "mimetype": "image/png"}),
                   entry(6, "celestial", visible=False, solid_color="#000000")]
        with zipfile.ZipFile(self.engine / "browser/omni.ja", "w") as omni:
            omni.writestr(wallpapers.CATALOG, json.dumps({"data": catalog}))

    def tearDown(self):
        self.temporary.cleanup()

    def opener(self, request, timeout):
        self.requests.append(request.full_url)
        return Response(self.served[request.full_url.removeprefix(wallpapers.CDN)])

    def sync(self):
        return wallpapers.sync(self.library, self.engine, opener=self.opener, log=lambda *_: None)

    def test_only_checked_images_and_colors_without_firefox_art_are_prepared(self):
        index = self.sync()
        self.assertEqual([c["id"] for c in index["categories"]], ["photographs", "solid-colors"])
        photo, color = index["categories"][0]["items"][0], index["categories"][1]["items"][0]
        self.assertEqual(photo["credit"], "Foto: Ana · Unsplash")
        self.assertEqual(color["color"], "#76c1ff")
        self.assertEqual(sorted(self.requests), [wallpapers.CDN + "main-workspace/w/bad.png", wallpapers.CDN + "main-workspace/w/photo.png"])
        full = (self.library / f"{photo['id']}.jpg").read_bytes()
        self.assertEqual(hashlib.sha256(full).hexdigest(), photo["sha256"])
        with Image.open(self.library / f"{photo['id']}-thumb.jpg") as thumb:
            self.assertEqual((thumb.format, thumb.size), ("JPEG", wallpapers.THUMBNAIL))
        self.assertEqual(sorted(p.name for p in self.library.iterdir()),
                         sorted(["index.json"] + [f"{i}{s}.jpg" for i in (photo["id"], color["id"]) for s in ("", "-thumb")]))

    def test_a_second_sync_downloads_nothing_and_drops_stale_files(self):
        self.sync()
        (self.library / "stale.jpg").write_bytes(b"old")
        self.requests.clear()
        self.sync()
        self.assertEqual(self.requests, [wallpapers.CDN + "main-workspace/w/bad.png"])
        self.assertFalse((self.library / "stale.jpg").exists())


if __name__ == "__main__":
    unittest.main()
