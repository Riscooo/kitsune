#!/usr/bin/env python3
"""Regression checks for appearance, private avatars and Google persistence flags."""

import base64
import contextlib
import copy
import http.client
import io
import json
from pathlib import Path
import stat
import threading
import time
import unittest
from unittest import mock

from PIL import Image, PngImagePlugin
import profiles_test as fixtures

home = fixtures.home
profiles = fixtures.profiles


def photo(color="red", format="PNG", size=(600, 320), metadata=False):
    source = Image.new("RGB", size, color)
    output = io.BytesIO()
    options = {}
    if metadata:
        if format == "PNG":
            info = PngImagePlugin.PngInfo()
            info.add_text("Comment", "private fixture camera metadata")
            options["pnginfo"] = info
        else:
            exif = Image.Exif()
            exif[270] = "private fixture camera metadata"
            options["exif"] = exif
    source.save(output, format=format, **options)
    mime = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[format]
    return "data:image/" + mime + ";base64," + base64.b64encode(output.getvalue()).decode()


class AppearanceFixture:
    def __init__(self):
        self.seen = []
        self.fail = False

    def refresh(self, settings):
        if self.fail:
            raise OSError("fixture appearance failure")
        self.seen.append(copy.deepcopy(settings))
        return {"wallpaper": settings["wallpaper"], "themeSync": settings["themeSync"], "fingerprint": str(len(self.seen))}


class BackendV04Tests(unittest.TestCase):
    def setUp(self):
        fixtures.ProfileTests.setUp(self)
        self.start = self.browser / "start"
        self.start.mkdir()
        (self.start / "index.html").write_text("<title>Kitsune fixture</title>")
        self.server = home.create_server(self.start, self.state / "home.json", port=0, profiles=self.manager)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        fixtures.ProfileTests.tearDown(self)

    def request(self, method="GET", path="/api/profiles", value=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        auth = {"Origin": self.server.origin, "Content-Type": "application/json", "X-Kitsune-Token": self.server.token}
        try:
            connection.request(method, path, body=json.dumps(value).encode() if value is not None else None,
                               headers=auth if headers is None else headers)
            response = connection.getresponse()
            body = response.read()
            response_headers = dict(response.getheaders())
            result = json.loads(body) if response_headers.get("Content-Type", "").startswith("application/json") else body
            return response.status, result, response_headers
        finally:
            connection.close()

    def edit(self, **extra):
        revision = self.manager.snapshot()["revision"]
        return self.manager.edit("default", "Personal", "mail@example.invalid", "blue", revision, **extra)

    def test_legacy_settings_read_adds_defaults_without_overwriting_original(self):
        legacy = {key: copy.deepcopy(value) for key, value in home.DEFAULT_DATA.items() if key in home.LEGACY_SETTINGS_KEYS}
        legacy["accent"] = "pink"
        path = self.root / "legacy-home.json"
        original = json.dumps({"version": 2, "revision": 7, "data": legacy}).encode()
        path.write_bytes(original)
        store = home.SettingsStore(path)
        snapshot = store.snapshot()
        self.assertEqual(snapshot["revision"], 7)
        self.assertEqual(snapshot["data"]["accent"], "pink")
        self.assertEqual(snapshot["data"]["wallpaper"], "night")
        self.assertFalse(snapshot["data"]["themeSync"])
        self.assertEqual(snapshot["data"]["modules"], {"clock": True, "shortcuts": True})
        self.assertEqual(path.read_bytes(), original)

    def test_old_client_save_preserves_new_preferences_and_conflict_is_atomic(self):
        data = copy.deepcopy(home.DEFAULT_DATA)
        data.update(wallpaper="ember", themeSync=True, modules={"clock": False, "shortcuts": True})
        self.server.store.update(data, 0)
        old_client = {key: copy.deepcopy(data[key]) for key in home.LEGACY_SETTINGS_KEYS}
        old_client["focus"] = True
        status, result, _ = self.request("PUT", "/api/settings", {"data": old_client, "revision": 1})
        self.assertEqual(status, 200)
        self.assertEqual(result["data"]["wallpaper"], "ember")
        self.assertTrue(result["data"]["themeSync"])
        self.assertFalse(result["data"]["modules"]["clock"])
        self.assertTrue(result["data"]["focus"])
        self.assertEqual(self.request("PUT", "/api/settings", {"data": old_client, "revision": 1})[0], 409)

    def test_new_settings_enums_booleans_and_modules_are_validated(self):
        for key, value in (("wallpaper", "unrecognized"), ("themeSync", 1), ("modules", {"clock": True}), ("modules", {"clock": "true", "shortcuts": True})):
            data = copy.deepcopy(home.DEFAULT_DATA)
            data[key] = value
            self.assertEqual(self.request("PUT", "/api/settings", {"data": data, "revision": 0})[0], 400)
        self.assertEqual(self.server.store.snapshot()["revision"], 0)

    def test_avatar_formats_are_square_png_with_metadata_removed(self):
        for format in ("PNG", "JPEG", "WEBP"):
            with self.subTest(format=format):
                digest, png = profiles.media.normalize_avatar(photo(format=format, metadata=True))
                self.assertEqual(len(digest), 64)
                self.assertNotIn(b"private fixture camera metadata", png)
                with Image.open(io.BytesIO(png)) as result:
                    self.assertEqual(result.format, "PNG")
                    self.assertEqual(result.size, (256, 256))
                    self.assertFalse(result.info)
                    self.assertFalse(result.getexif())

    def test_invalid_avatars_and_animation_are_rejected_before_registry_mutation(self):
        original = self.manager.snapshot()
        animated = io.BytesIO()
        Image.new("RGB", (4, 4), "red").save(animated, format="PNG", save_all=True,
                                             append_images=[Image.new("RGB", (4, 4), "blue")], duration=100)
        invalid = ["data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,!!!!", "https://example.invalid/photo.png",
                   "data:image/png;base64," + base64.b64encode(b"not an image").decode(),
                   photo(format="PNG").replace("image/png", "image/jpeg"),
                   "data:image/png;base64," + base64.b64encode(animated.getvalue()).decode()]
        for avatar in invalid:
            with self.assertRaises(profiles.InvalidProfile):
                self.edit(avatarData=avatar)
        with mock.patch.object(profiles.media, "MAX_AVATAR_PIXELS", 10):
            with self.assertRaises(profiles.InvalidProfile):
                self.edit(avatarData=photo(size=(4, 4)))
        self.assertEqual(self.manager.snapshot(), original)

    def test_avatar_storage_is_private_and_omit_replace_remove_have_exact_semantics(self):
        created = self.edit(avatarData=photo(), rememberGoogle=True)
        public = created["profiles"][0]
        first_url = public["avatar"]
        digest = Path(first_url).stem
        file = self.state / "avatars/default" / (digest + ".png")
        self.assertTrue(public["rememberGoogle"])
        self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(file.parent.stat().st_mode), 0o700)
        record = json.loads(self.manager.registry.read_text())
        self.assertEqual(record["version"], 2)
        self.assertNotIn("data:image", self.manager.registry.read_text())
        self.assertNotIn("avatarHash", public)
        omitted = self.edit()["profiles"][0]
        self.assertEqual(omitted["avatar"], first_url)
        self.assertTrue(omitted["rememberGoogle"])
        replaced = self.edit(avatarData=photo(color="blue"))["profiles"][0]
        self.assertNotEqual(replaced["avatar"], first_url)
        self.assertFalse(file.exists())
        with self.assertRaises(profiles.ProfileNotFound):
            self.manager.avatar("default", digest)
        removed = self.edit(avatarData=None, rememberGoogle=False)["profiles"][0]
        self.assertIsNone(removed["avatar"])
        self.assertFalse(removed["rememberGoogle"])
        self.assertEqual(list(file.parent.glob("*.png")), [])

    def test_failed_avatar_registry_commit_preserves_original_photo_and_revision(self):
        first = self.edit(avatarData=photo())
        original_record = self.manager.registry.read_bytes()
        old_hash = Path(first["profiles"][0]["avatar"]).stem
        old_photo = self.manager.avatar("default", old_hash)
        with mock.patch.object(self.manager, "_write", side_effect=OSError("disk fixture failure")):
            with self.assertRaises(profiles.ProfilesUnavailable):
                self.edit(avatarData=photo(color="blue"), rememberGoogle=True)
        self.assertEqual(self.manager.registry.read_bytes(), original_record)
        self.assertEqual(self.manager.avatar("default", old_hash), old_photo)
        self.assertEqual(len(list((self.state / "avatars/default").glob("*.png"))), 1)

    def test_avatar_http_content_origin_hash_and_removal(self):
        values = {"name": "Personal", "email": "", "color": "blue", "revision": 0,
                  "avatarData": photo(), "rememberGoogle": True}
        status, snapshot, _ = self.request("PATCH", "/api/profiles/default", values)
        self.assertEqual(status, 200)
        url = snapshot["profiles"][0]["avatar"]
        status, png, headers = self.request(path=url)
        self.assertEqual(status, 200)
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Cross-Origin-Resource-Policy"], "same-origin")
        self.assertEqual(self.request(path=url, headers={"Origin": "https://example.invalid"})[0], 403)
        self.assertEqual(self.request(path=url.replace("default", "p-0123456789abcdef"))[0], 404)
        self.assertEqual(self.request(path="/api/profile-avatars/default/../profiles.json")[0], 404)
        self.assertEqual(self.request(path=url.replace(Path(url).stem, "0" * 64))[0], 404)
        self.edit(avatarData=None)
        self.assertEqual(self.request(path=url)[0], 404)

    def test_avatar_large_body_limit_does_not_relax_settings_limit(self):
        self.manager.snapshot()
        values = {"name": "Personal", "email": "", "color": "blue", "revision": 0,
                  "avatarData": "x" * (home.MAX_BODY + 10)}
        # Profile parser admits the body, then validates its photo format.
        self.assertEqual(self.request("PATCH", "/api/profiles/default", values)[0], 400)
        def oversized_headers(method, path, length):
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
            try:
                connection.putrequest(method, path)
                connection.putheader("Origin", self.server.origin)
                connection.putheader("Content-Type", "application/json")
                connection.putheader("X-Kitsune-Token", self.server.token)
                connection.putheader("Content-Length", str(length))
                connection.endheaders()
                # The server rejects the declared size before reading a body.
                # Sending megabytes here races its intentional early close.
                response = connection.getresponse()
                response.read()
                return response.status
            finally:
                connection.close()
        self.assertEqual(oversized_headers("PATCH", "/api/profiles/default", home.MAX_PROFILE_BODY + 1), 413)
        self.assertEqual(oversized_headers("PUT", "/api/settings", home.MAX_BODY + 1), 413)

    def test_v1_registry_migration_remember_flag_and_old_clients_preserve_choices(self):
        self.manager.snapshot()
        record = json.loads(self.manager.registry.read_text())
        record["version"] = 1
        for profile in record["profiles"]:
            del profile["avatarHash"]
            del profile["rememberGoogle"]
        original = json.dumps(record).encode()
        self.manager.registry.write_bytes(original)
        snapshot = self.manager.snapshot()
        self.assertFalse(snapshot["profiles"][0]["rememberGoogle"])
        self.assertIsNone(snapshot["profiles"][0]["avatar"])
        self.assertEqual(self.manager.registry.read_bytes(), original)
        self.edit(rememberGoogle=True)
        self.edit()
        self.assertTrue(self.manager.snapshot()["profiles"][0]["rememberGoogle"])
        self.assertEqual(json.loads(self.manager.registry.read_text())["version"], 2)
        with self.assertRaises(profiles.InvalidProfile):
            self.edit(rememberGoogle="yes")

    def test_appearance_get_put_and_saved_warning_on_native_failure(self):
        appearance = AppearanceFixture()
        self.server.appearance = appearance
        status, value, _ = self.request(path="/api/appearance")
        self.assertEqual(status, 200)
        self.assertEqual(value["wallpaper"], "night")
        data = copy.deepcopy(home.DEFAULT_DATA)
        data.update(wallpaper="dusk", themeSync=True)
        status, value, _ = self.request("PUT", "/api/settings", {"data": data, "revision": 0})
        self.assertEqual(status, 200)
        self.assertEqual(value["appearance"]["wallpaper"], "dusk")
        appearance.fail = True
        data["wallpaper"] = "ember"
        status, value, _ = self.request("PUT", "/api/settings", {"data": data, "revision": 1})
        self.assertEqual(status, 200)
        self.assertIn("warning", value)
        self.assertEqual(self.server.store.snapshot()["data"]["wallpaper"], "ember")
        self.assertEqual(self.request(path="/api/appearance")[0], 503)

    def test_profile_remember_changes_refresh_only_target_control_and_preserve_home(self):
        self.manager.snapshot()
        self.server.appearance = home.make_appearance(self.browser, self.state, "default")
        default_control = self.browser / "profile/chrome/kitsune-appearance.json"
        self.server.refresh_appearance()
        self.assertFalse(json.loads(default_control.read_text())["googleRemember"])
        current = self.manager.snapshot()
        values = {"name": "Second", "email": "", "color": "teal", "revision": current["revision"], "rememberGoogle": True}
        status, result, _ = self.request("POST", value=values)
        self.assertEqual(status, 200)
        identifier = result["createdId"]
        resolved = self.manager.resolve(identifier)
        target_control = resolved["profile"] / "chrome/kitsune-appearance.json"
        self.assertTrue(json.loads(target_control.read_text())["googleRemember"])
        self.assertFalse(json.loads(default_control.read_text())["googleRemember"])
        self.assertFalse(resolved["state"].exists())
        values.update(revision=result["revision"], rememberGoogle=False)
        status, _, _ = self.request("PATCH", "/api/profiles/" + identifier, values)
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(target_control.read_text())["googleRemember"])
        self.assertFalse(resolved["state"].exists())

    def test_avatar_missing_processor_or_mismatched_file_reports_clear_failure(self):
        with mock.patch.object(profiles.media, "normalize_avatar", side_effect=profiles.media.AvatarUnavailable("Componente de fotos no disponible.")):
            with self.assertRaises(profiles.ProfilesUnavailable):
                self.edit(avatarData=photo())
        current = self.edit(avatarData=photo())
        url = current["profiles"][0]["avatar"]
        digest = Path(url).stem
        path = self.state / "avatars/default" / (digest + ".png")
        path.write_bytes(b"not the registered PNG")
        self.assertEqual(self.request(path=url)[0], 503)

    def test_appearance_owned_background_thread_updates_and_stops(self):
        appearance = AppearanceFixture()
        server = home.create_server(self.start, self.root / "appearance-home.json", port=0, appearance=appearance)
        try:
            self.assertEqual(len(appearance.seen), 1)
            data = copy.deepcopy(home.DEFAULT_DATA)
            data["wallpaper"] = "dusk"
            server.store.update(data, 0)
            deadline = time.monotonic() + 3.5
            while len(appearance.seen) < 2 and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertGreaterEqual(len(appearance.seen), 2)
            self.assertEqual(appearance.seen[-1]["wallpaper"], "dusk")
        finally:
            server.server_close()
        self.assertFalse(server.appearance_thread.is_alive())

    def test_structured_logs_contain_no_identifiers_email_avatar_token_or_query(self):
        logs = io.StringIO()
        with contextlib.redirect_stderr(logs):
            values = {"name": "Secret label", "email": "private@example.invalid", "color": "blue", "revision": 0,
                      "avatarData": photo(), "rememberGoogle": True}
            self.assertEqual(self.request("PATCH", "/api/profiles/default?secret=query", values)[0], 200)
        recorded = [json.loads(line) for line in logs.getvalue().splitlines()]
        self.assertTrue(recorded)
        self.assertTrue(all(set(item) == {"event", "route", "status"} for item in recorded))
        for value in ("Secret label", "private@example.invalid", "data:image", self.server.token, "secret=query"):
            self.assertNotIn(value, logs.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
