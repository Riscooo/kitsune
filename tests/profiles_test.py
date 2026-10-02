#!/usr/bin/env python3
"""Local profile tests: clean initialization, isolated state and API contracts."""

import concurrent.futures
import copy
import http.client
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest import mock


INSTALL = Path(__file__).resolve().parents[1] / "install"
spec = importlib.util.spec_from_file_location("kitsune_profile_home_test", INSTALL / "home-server.py")
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)
profiles = home.profiles_module


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kitsune-profiles-test-")
        self.root = Path(self.temporary.name)
        self.browser = self.root / "browser"
        self.state = self.root / "state"
        templates = self.browser / "templates"
        (templates / "chrome/assets").mkdir(parents=True)
        (templates / "user.js").write_text('user_pref("xpinstall.signatures.required", true);\nuser_pref("privacy.sanitize.sanitizeOnShutdown", true);\n')
        (templates / "chrome/userChrome.css").write_text("/* Kitsune fixture */")
        (templates / "chrome/assets/icon.svg").write_text("<svg/>")
        (templates / "default-search.json.mozlz4").write_bytes(b"clean-search-seed")
        (self.browser / "profile").mkdir()
        (self.browser / "profile/cookies.sqlite").write_bytes(b"original-private-session")
        (self.browser / "profile/user.js").write_text("// original preferences")
        self.launches = []
        self.manager = profiles.ProfileManager(self.browser, self.state, launch=lambda *args: self.launches.append(args))

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, manager=None, revision=None, name="Trabajo", email="hola@example.org", color="violet"):
        manager = manager or self.manager
        if revision is None:
            revision = manager.snapshot()["revision"]
        return manager.create(name, email, color, revision)

    def test_legacy_profile_path_data_and_private_registry_are_preserved(self):
        snapshot = self.manager.snapshot()
        self.assertEqual(snapshot["currentId"], "default")
        self.assertEqual(snapshot["defaultId"], "default")
        self.assertEqual(snapshot["revision"], 0)
        resolved = self.manager.resolve()
        self.assertEqual(resolved["profile"], self.browser / "profile")
        self.assertEqual(resolved["state"], self.state / "home.json")
        self.assertEqual(resolved["port"], 49721)
        self.assertEqual(resolved["remoting"], "kitsune-browser")
        self.assertEqual((self.browser / "profile/user.js").read_text(), "// original preferences")
        self.assertEqual((self.browser / "profile/cookies.sqlite").read_bytes(), b"original-private-session")
        self.assertEqual(stat.S_IMODE(self.manager.registry.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)

    def test_created_profiles_have_clean_templates_unique_paths_ports_and_remoting(self):
        one = self.create()
        first = self.manager.resolve(one["createdId"])
        two = self.create(name="Personal 2", email="", color="blue")
        second = self.manager.resolve(two["createdId"])
        self.assertNotEqual(first["profile"], second["profile"])
        self.assertNotEqual(first["port"], second["port"])
        self.assertNotEqual(first["home"], second["home"])
        self.assertNotEqual(first["remoting"], second["remoting"])
        self.assertEqual(first["profile"].name, "profile")
        self.assertEqual(first["profile"], self.browser / "profiles" / one["createdId"] / "profile")
        self.assertFalse((first["profile"] / "cookies.sqlite").exists())
        self.assertFalse((first["profile"] / "places.sqlite").exists())
        self.assertFalse((first["profile"] / "logins.json").exists())
        self.assertEqual((first["profile"] / "search.json.mozlz4").read_bytes(), b"clean-search-seed")
        prefs = (first["profile"] / "user.js").read_text()
        self.assertIn(first["home"], prefs)
        self.assertIn('"xpinstall.signatures.required", true', prefs)
        self.assertIn('"privacy.sanitize.sanitizeOnShutdown", true', prefs)
        self.assertNotIn("identity.fxaccounts", prefs)
        self.assertEqual(stat.S_IMODE(first["profile"].stat().st_mode), 0o700)

    def test_edit_default_and_actions_do_not_merge_or_delete_user_data(self):
        result = self.create()
        identifier = result["createdId"]
        result = self.manager.edit(identifier, "Estudio", "otro@example.com", "pink", result["revision"])
        result = self.manager.set_default(identifier, result["revision"])
        self.assertEqual(self.manager.resolve()["id"], identifier)
        self.assertEqual(result["profiles"][1]["email"], "otro@example.com")
        for action in profiles.ACTIONS:
            result = self.manager.open(identifier, action)
            self.assertEqual(result["openedId"], identifier)
            self.assertTrue(result["launchRequested"])
        self.assertEqual(self.launches, [(identifier, action) for action in profiles.ACTIONS])
        self.assertEqual((self.browser / "profile/cookies.sqlite").read_bytes(), b"original-private-session")
        self.assertEqual(profiles.ACTIONS["sync"], "about:preferences#librewolf")
        self.assertEqual(profiles.ACTIONS["sync-settings"], "about:preferences#sync")

    def test_bad_inputs_missing_ids_and_unknown_actions_are_rejected(self):
        for changes in ({"name": ""}, {"name": " "}, {"name": "x" * 49}, {"name": "a\x7fb"}, {"email": "no-email"}, {"email": "a@b.com\n"}, {"color": "orange"}, {"revision": True}):
            values = {"name": "Normal", "email": "", "color": "blue", "revision": 0, **changes}
            with self.assertRaises(profiles.InvalidProfile):
                self.manager.create(**values)
        for identifier in ("../profile", "p-zzzzzzzzzzzzzzzz", "--profile", "x", None):
            with self.assertRaises(profiles.InvalidProfile):
                self.manager.open(identifier)
        with self.assertRaises(profiles.ProfileNotFound):
            self.manager.resolve("p-0123456789abcdef")
        with self.assertRaises(profiles.InvalidProfile):
            self.manager.open("default", "https://example.org/")
        self.assertEqual(self.launches, [])

    def test_cross_instance_concurrent_revision_writes_have_one_winner(self):
        before = self.manager.snapshot()
        other = profiles.ProfileManager(self.browser, self.state, launch=lambda *_: None)
        def edit(manager, name):
            try:
                manager.edit("default", name, "", "blue", before["revision"])
                return 200
            except profiles.ProfileConflict:
                return 409
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = [pool.submit(edit, self.manager, "Primero"), pool.submit(edit, other, "Segundo")]
            self.assertEqual(sorted(item.result() for item in results), [200, 409])
        self.assertEqual(self.manager.snapshot()["revision"], 1)
        self.assertEqual(self.manager.snapshot(), other.snapshot())

    def test_stale_revision_returns_current_snapshot_and_no_side_effects(self):
        current = self.create()
        with self.assertRaises(profiles.ProfileConflict) as caught:
            self.manager.edit("default", "New name", "", "red", 0)
        self.assertEqual(caught.exception.snapshot["revision"], current["revision"])
        self.assertEqual(self.manager.snapshot()["profiles"][0]["name"], "Personal")

    def test_corrupt_registry_and_symlink_are_preserved_not_replaced(self):
        self.manager.snapshot()
        self.manager.registry.write_text("broken original registry")
        with self.assertRaises(profiles.ProfilesUnavailable):
            self.manager.snapshot()
        self.assertEqual(self.manager.registry.read_text(), "broken original registry")
        self.manager.registry.unlink()
        target = self.root / "sensitive.txt"
        target.write_text("preserve me")
        self.manager.registry.symlink_to(target)
        with self.assertRaises(profiles.ProfilesUnavailable):
            self.manager.snapshot()
        self.assertEqual(target.read_text(), "preserve me")

    def test_failed_registry_commit_keeps_previous_state_and_revision(self):
        self.manager.snapshot()
        before = self.manager.registry.read_bytes()
        with mock.patch.object(profiles.os, "replace", side_effect=OSError("disk full fixture")):
            with self.assertRaises(profiles.ProfilesUnavailable):
                self.manager.edit("default", "Not saved", "", "blue", 0)
        self.assertEqual(self.manager.registry.read_bytes(), before)
        self.assertEqual(self.manager.snapshot()["revision"], 0)
        self.assertFalse(list(self.state.glob(".kitsune-*.tmp")))

    def test_launch_spawn_failure_rolls_back_last_used_revision(self):
        self.manager.snapshot()
        before = self.manager.registry.read_bytes()
        self.manager.launch = mock.Mock(side_effect=OSError("spawn fixture"))
        with self.assertRaises(profiles.ProfilesUnavailable):
            self.manager.open("default", "home")
        self.assertEqual(self.manager.registry.read_bytes(), before)

    def test_missing_template_fails_without_publishing_profile(self):
        self.manager.snapshot()
        (self.browser / "templates/user.js").unlink()
        with self.assertRaises(profiles.ProfilesUnavailable):
            self.create()
        self.assertEqual(len(self.manager.snapshot()["profiles"]), 1)

    def test_gui_environment_only_refreshes_allowlisted_values(self):
        fixture = mock.Mock(stdout="WAYLAND_DISPLAY=wayland-new\nDISPLAY=:3\nSECRET_KEY=do-not-import\nPATH=/tmp/not-trusted\n")
        with mock.patch.object(profiles.subprocess, "run", return_value=fixture), mock.patch.dict(os.environ, {"PATH": "/original/path"}):
            result = profiles.desktop_environment()
        self.assertEqual(result["WAYLAND_DISPLAY"], "wayland-new")
        self.assertEqual(result["DISPLAY"], ":3")
        self.assertEqual(result["PATH"], "/original/path")
        self.assertNotIn("SECRET_KEY", result)

    def test_browser_dispatch_uses_independent_user_unit_and_enumerated_argv(self):
        manager = profiles.ProfileManager(self.browser, self.state, launcher=self.root / "installed launcher")
        with mock.patch.object(profiles, "desktop_environment", return_value={"WAYLAND_DISPLAY": "wayland-1", "DISPLAY": ":2", "SECRET": "not-forwarded"}), mock.patch.object(profiles.subprocess, "run") as run:
            manager._launch("default", "google")
        command = run.call_args.args[0]
        self.assertEqual(command[:5], ["systemd-run", "--user", "--collect", "--quiet", "--property=Type=exec"])
        self.assertIn("--setenv=WAYLAND_DISPLAY=wayland-1", command)
        self.assertNotIn("--setenv=SECRET=not-forwarded", command)
        self.assertEqual(command[-6:], ["--", str(self.root / "installed launcher"), "--kitsune-profile", "default", "--kitsune-action", "google"])
        self.assertTrue(run.call_args.kwargs["check"])


class ProfileAPITests(ProfileTests):
    def setUp(self):
        super().setUp()
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
        super().tearDown()

    def request(self, method="GET", path="/api/profiles", value=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        auth = {"Origin": self.server.origin, "Content-Type": "application/json", "X-Kitsune-Token": self.server.token}
        try:
            connection.request(method, path, body=json.dumps(value).encode() if value is not None else None,
                               headers=auth if headers is None else headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_profile_http_contract_create_edit_default_open_and_conflict(self):
        status, snapshot = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["token"], self.server.token)
        self.assertNotIn("port", snapshot["profiles"][0])
        values = {"name": "Trabajo", "email": "correo@example.com", "color": "teal", "revision": 0}
        status, result = self.request("POST", value=values)
        self.assertEqual(status, 200)
        identifier = result["createdId"]
        status, result = self.request("PATCH", "/api/profiles/" + identifier, {**values, "name": "Estudio", "revision": result["revision"]})
        self.assertEqual(status, 200)
        status, result = self.request("POST", f"/api/profiles/{identifier}/default", {"revision": result["revision"]})
        self.assertEqual(status, 200)
        self.assertEqual(result["defaultId"], identifier)
        status, result = self.request("POST", f"/api/profiles/{identifier}/open", {"action": "google"})
        self.assertEqual(status, 200)
        self.assertTrue(result["launchRequested"])
        self.assertEqual(self.launches, [(identifier, "google")])
        status, conflict = self.request("POST", value=values)
        self.assertEqual(status, 409)
        self.assertEqual(conflict["revision"], result["revision"])
        self.assertEqual(conflict["token"], self.server.token)

    def test_profile_mutations_enforce_same_origin_token_schema_and_actions(self):
        self.request()
        values = {"name": "Trabajo", "email": "", "color": "blue", "revision": 0}
        for headers in ({}, {"Origin": "https://example.org", "Content-Type": "application/json", "X-Kitsune-Token": self.server.token}, {"Origin": self.server.origin, "Content-Type": "application/json", "X-Kitsune-Token": "bad"}):
            self.assertEqual(self.request("POST", value=values, headers=headers)[0], 403)
        self.assertEqual(self.request("POST", value={**values, "command": "ignored"})[0], 400)
        self.assertEqual(self.request("POST", "/api/profiles/default/open", {"action": "unknown"})[0], 400)
        self.assertEqual(self.request("POST", "/api/profiles/default/open", {"action": "home", "url": "https://example.org"})[0], 400)
        self.assertEqual(self.request("DELETE", "/api/profiles/default")[0], 405)
        self.assertEqual(self.launches, [])

    def test_two_home_servers_expose_current_profile_and_independent_settings(self):
        created = self.create()
        identifier = created["createdId"]
        resolved = self.manager.resolve(identifier)
        other = home.create_server(self.start, resolved["state"], port=0, profiles=self.manager, current_id=identifier)
        thread = threading.Thread(target=other.serve_forever, kwargs={"poll_interval": 0.02})
        thread.start()
        try:
            self.assertNotEqual(other.origin, self.server.origin)
            self.assertNotEqual(other.token, self.server.token)
            original = copy.deepcopy(home.DEFAULT_DATA)
            original["accent"] = "pink"
            self.server.store.update(original, 0)
            self.assertEqual(other.store.snapshot()["data"]["accent"], "blue")
            connection = http.client.HTTPConnection(*other.server_address, timeout=5)
            try:
                connection.request("GET", "/api/profiles")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())["currentId"], identifier)
            finally:
                connection.close()
        finally:
            other.shutdown()
            other.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
