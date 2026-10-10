#!/usr/bin/env python3
"""Home background (0.7): normalized upload, private serving, theme and clean-up."""

import copy
import io
import json
import stat
import unittest

from PIL import Image

import backend_v04_test as backend

home = backend.home


class BackgroundTests(backend.BackendV04Tests):
    def setUp(self):
        super().setUp()
        self.manager.snapshot()
        self.server.appearance = home.make_appearance(self.browser, self.state, "default")
        self.server.refresh_appearance()
        self.chrome = self.browser / "profile/chrome"

    def upload(self, image):
        return self.request("POST", "/api/background", {"imageData": image})

    def control(self):
        return json.loads((self.chrome / "kitsune-appearance.json").read_text())

    def test_upload_stores_a_clean_bounded_jpeg_and_the_browser_gets_its_hash(self):
        status, value, _ = self.upload(backend.photo("teal", "PNG", size=(4000, 1000), metadata=True))
        self.assertEqual(status, 200, value)
        digest = value["data"]["background"]
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        self.assertEqual(self.control()["background"], digest)
        stored = self.chrome / f"kitsune-background-{digest}.jpg"
        self.assertEqual(stat.S_IMODE(stored.stat().st_mode), 0o600)
        status, body, headers = self.request(path=f"/api/background/{digest}.jpg")
        self.assertEqual((status, headers["Content-Type"]), (200, "image/jpeg"))
        self.assertEqual(body, stored.read_bytes())
        with Image.open(io.BytesIO(body)) as image:
            self.assertEqual((image.format, image.size), ("JPEG", (2560, 640)))
            self.assertNotIn("Comment", image.info)
            self.assertEqual(len(image.getexif()), 0)

    def test_new_upload_replaces_the_old_file_and_removal_deletes_it(self):
        first = self.upload(backend.photo("red"))[1]["data"]["background"]
        second = self.upload(backend.photo("blue", "JPEG", metadata=True))[1]["data"]["background"]
        self.assertNotEqual(first, second)
        self.assertEqual([p.name for p in self.chrome.glob("kitsune-background-*.jpg")], [f"kitsune-background-{second}.jpg"])
        self.assertEqual(self.request(path=f"/api/background/{first}.jpg")[0], 404)
        snapshot = self.server.store.snapshot()
        data = copy.deepcopy(snapshot["data"])
        data["background"] = None
        status, value, _ = self.request("PUT", "/api/settings", {"data": data, "revision": snapshot["revision"]})
        self.assertEqual(status, 200, value)
        self.assertEqual(list(self.chrome.glob("kitsune-background-*.jpg")), [])
        self.assertIsNone(self.control()["background"])
        self.assertEqual(self.request(path=f"/api/background/{second}.jpg")[0], 404)

    def test_settings_cannot_point_the_background_at_an_arbitrary_hash(self):
        snapshot = self.server.store.snapshot()
        data = copy.deepcopy(snapshot["data"])
        for value in ("ab" * 32, "../../etc/passwd", 7):
            data["background"] = value
            status, _, _ = self.request("PUT", "/api/settings", {"data": data, "revision": snapshot["revision"]})
            self.assertEqual(status, 400, value)
        self.assertIsNone(self.server.store.snapshot()["data"]["background"])

    def test_dark_theme_reaches_the_browser_control(self):
        snapshot = self.server.store.snapshot()
        data = copy.deepcopy(snapshot["data"])
        data["theme"] = "oscuro"
        status, value, _ = self.request("PUT", "/api/settings", {"data": data, "revision": snapshot["revision"]})
        self.assertEqual(status, 200, value)
        self.assertEqual(value["appearance"]["theme"], "oscuro")
        self.assertEqual(self.control()["palette"]["bg"], "#161a19")
        data["theme"] = "nightfall"
        self.assertEqual(self.request("PUT", "/api/settings", {"data": data, "revision": snapshot["revision"] + 1})[0], 400)

    def test_home_page_arrives_already_dark(self):
        (self.start / "index.html").write_text('<html lang="es"><meta name="theme-color" content="#f6f5f1">')
        self.assertNotIn(b"data-theme", self.request(path="/")[1])
        snapshot = self.server.store.snapshot()
        data = copy.deepcopy(snapshot["data"])
        data["theme"] = "oscuro"
        self.assertEqual(self.request("PUT", "/api/settings", {"data": data, "revision": snapshot["revision"]})[0], 200)
        body = self.request(path="/")[1]
        self.assertIn(b'<html lang="es" data-theme="oscuro">', body)
        self.assertIn(b'content="#161a19"', body)

    def test_rejected_uploads_change_nothing(self):
        for image in ("data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,bm90IGFuIGltYWdl", "x" * 64):
            status, _, _ = self.upload(image)
            self.assertEqual(status, 400, image[:30])
        self.assertEqual(self.request("POST", "/api/background", {"imageData": backend.photo(), "extra": 1})[0], 400)
        headers = {"Origin": self.server.origin, "Content-Type": "application/json", "X-Kitsune-Token": "wrong"}
        self.assertEqual(self.request("POST", "/api/background", {"imageData": backend.photo()}, headers=headers)[0], 403)
        self.assertEqual(list(self.chrome.glob("kitsune-background-*")), [])
        self.assertEqual(list(self.chrome.glob(".background-*")), [])
        self.assertIsNone(self.server.store.snapshot()["data"]["background"])


# Only the background tests run from this module, not the inherited backend ones.
for name in [name for name in vars(backend.BackendV04Tests) if name.startswith("test_")]:
    setattr(BackgroundTests, name, None)

if __name__ == "__main__":
    unittest.main()
