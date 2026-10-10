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

    def library(self):
        """Two prepared presets, as wallpapers.py leaves them."""
        library = self.browser / "wallpapers"
        library.mkdir()
        items = []
        for identifier, color in (("11111111-2222-4333-8444-555555555555", "#76c1ff"), ("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "#3c1d00")):
            png = io.BytesIO()
            Image.new("RGB", (64, 40), color).save(png, format="PNG")
            digest, jpeg, thumb = home.profiles_module.media.background_from_bytes(png.getvalue(), "PNG", thumbnail=(320, 200))
            (library / f"{identifier}.jpg").write_bytes(jpeg)
            (library / f"{identifier}-thumb.jpg").write_bytes(thumb)
            items.append({"id": identifier, "sha256": digest, "source": "color:" + color, "credit": None, "color": color})
        (library / "index.json").write_text(json.dumps({"version": 1, "categories": [{"id": "solid-colors", "name": "Colores", "items": items}]}))
        return library, items

    def test_presets_are_listed_previewed_and_chosen_like_an_upload(self):
        self.assertEqual(self.request(path="/api/wallpapers")[1], {"categories": []})
        library, items = self.library()
        status, value, _ = self.request(path="/api/wallpapers")
        self.assertEqual(status, 200)
        self.assertEqual([i["id"] for i in value["categories"][0]["items"]], [i["id"] for i in items])
        self.assertNotIn("library", value)
        status, body, headers = self.request(path=f"/api/wallpapers/{items[0]['id']}.jpg")
        self.assertEqual((status, headers["Content-Type"]), (200, "image/jpeg"))
        with Image.open(io.BytesIO(body)) as thumb:
            self.assertEqual(thumb.size, (320, 200))
        status, value, _ = self.request("POST", "/api/background", {"preset": items[1]["id"]})
        self.assertEqual(status, 200, value)
        self.assertEqual(value["data"]["background"], items[1]["sha256"])
        self.assertEqual(self.control()["background"], items[1]["sha256"])
        self.assertEqual((self.chrome / f"kitsune-background-{items[1]['sha256']}.jpg").read_bytes(), (library / f"{items[1]['id']}.jpg").read_bytes())
        self.assertEqual(self.request("POST", "/api/background", {"preset": "00000000-0000-4000-8000-000000000000"})[0], 400)
        self.assertEqual(self.request(path="/api/wallpapers/00000000-0000-4000-8000-000000000000.jpg")[0], 404)
        (library / f"{items[0]['id']}.jpg").write_bytes(b"tampered")
        self.assertEqual(self.request("POST", "/api/background", {"preset": items[0]["id"]})[0], 503)
        self.assertEqual(self.server.store.snapshot()["data"]["background"], items[1]["sha256"])

    def test_help_links_land_on_kitsune_help(self):
        (self.start / "ayuda.html").write_text('<html lang="es"><title>Kitsune · Ayuda</title>')
        for path in ("/ayuda/", "/ayuda/enhanced-tracking-protection", "/ayuda/password-manager-remember-delete-edit-logins"):
            status, body, headers = self.request(path=path)
            self.assertEqual((status, headers["Content-Type"]), (200, "text/html; charset=utf-8"), path)
            self.assertIn("Kitsune · Ayuda".encode(), body)
        for path in ("/ayuda/../index.html", "/ayuda/a/b", "/ayuda/%2e%2e"):
            self.assertEqual(self.request(path=path)[0], 404, path)

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
