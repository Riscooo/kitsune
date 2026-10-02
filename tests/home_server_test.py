#!/usr/bin/env python3
"""Isolated functional tests for Kitsune's local home service."""

from __future__ import annotations

import concurrent.futures
import copy
import http.client
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "install/home-server.py"
spec = importlib.util.spec_from_file_location("kitsune_home_server", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HomeServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kitsune-home-test-")
        self.root = Path(self.temporary.name) / "start"
        self.root.mkdir()
        (self.root / "index.html").write_text("<!doctype html><title>Kitsune test</title>")
        (self.root / "app.bundle.js").write_text("console.info('fixture');")
        (self.root / "not-public.txt").write_text("Private fixture")
        self.state = Path(self.temporary.name) / "state/home.json"
        self.start()

    def start(self):
        self.server = module.create_server(self.root, self.state, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def tearDown(self):
        self.stop()
        self.temporary.cleanup()

    def request(self, method="GET", path="/api/settings", data=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        body = json.dumps(data).encode() if data is not None else raw
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            payload = response.read()
            response_headers = dict(response.getheaders())
            decoded = json.loads(payload) if payload and response_headers.get("Content-Type", "").startswith("application/json") else payload
            return response.status, decoded, response_headers
        finally:
            connection.close()

    def current(self):
        status, value, _ = self.request()
        self.assertEqual(status, 200)
        return value

    def auth(self, token=None):
        return {"Origin": self.origin, "Content-Type": "application/json", "X-Kitsune-Token": token or self.current()["token"]}

    def update(self, data, revision=0, headers=None):
        return self.request("PUT", data={"data": data, "revision": revision}, headers=headers or self.auth())

    def test_defaults_headers_and_allowlisted_static_files(self):
        status, value, headers = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(value["version"], 2)
        self.assertEqual(value["revision"], 0)
        self.assertEqual(value["data"], module.DEFAULT_DATA)
        self.assertGreaterEqual(len(value["token"]), 32)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(self.request(path="/?version=2")[0], 200)
        self.assertEqual(self.request(path="/app.bundle.js?cache=off")[0], 200)
        self.assertEqual(self.request("HEAD", "/index.html")[1], b"")

    def test_exact_host_origin_and_token_are_required_for_updates(self):
        base = self.auth()
        invalid = [
            {**base, "Host": "localhost:" + str(self.port)},
            {**base, "Host": "example.invalid"},
            {**base, "Origin": "https://example.invalid"},
            {**base, "Origin": "null"},
            {key: value for key, value in base.items() if key != "Origin"},
            {**base, "X-Kitsune-Token": "wrong-token"},
            {key: value for key, value in base.items() if key != "X-Kitsune-Token"},
        ]
        for headers in invalid:
            with self.subTest(headers=tuple(headers)):
                self.assertEqual(self.update(copy.deepcopy(module.DEFAULT_DATA), headers=headers)[0], 403)
        self.assertFalse(self.state.exists())
        self.assertEqual(self.request(headers={"Host": "example.invalid"})[0], 403)
        self.assertEqual(self.request(headers={"Origin": "https://example.invalid"})[0], 403)

    def test_unlisted_paths_traversal_and_symlinks_are_not_served(self):
        paths = ["/not-public.txt", "/../not-public.txt", "/%2e%2e/not-public.txt", "/start/", "/home.json", "/api/../index.html"]
        for path in paths:
            self.assertEqual(self.request(path=path)[0], 404, path)
        (self.root / "palette.css").symlink_to(self.root / "not-public.txt")
        status, body, _ = self.request(path="/palette.css")
        self.assertEqual(status, 503)
        self.assertNotIn("Private fixture", json.dumps(body))

    def test_updates_are_atomic_private_and_persist_across_service_restart(self):
        previous_token = self.current()["token"]
        data = copy.deepcopy(module.DEFAULT_DATA)
        data.update({"art": False, "focus": True, "accent": "pink"})
        data["links"].append({"id": "my-link", "name": "Café & anime", "url": "https://example.org/?q=caf%C3%A9", "color": "blue", "icon": ""})
        status, value, _ = self.update(data)
        self.assertEqual(status, 200)
        self.assertEqual(value["revision"], 1)
        stored = json.loads(self.state.read_text())
        self.assertEqual(stored, {"version": 2, "data": data, "revision": 1})
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)
        self.assertEqual(list(self.state.parent.glob(".home-*.tmp")), [])
        self.stop()
        self.start()
        current = self.current()
        self.assertEqual(current["data"], data)
        self.assertEqual(current["revision"], 1)
        self.assertNotEqual(current["token"], previous_token)
        self.assertEqual(self.update(data, revision=1, headers=self.auth(previous_token))[0], 403)

    def test_stale_revision_reports_current_state_without_overwriting(self):
        data = copy.deepcopy(module.DEFAULT_DATA)
        data["accent"] = "system"
        self.assertEqual(self.update(data)[0], 200)
        status, conflict, _ = self.update(copy.deepcopy(module.DEFAULT_DATA))
        self.assertEqual(status, 409)
        self.assertEqual(conflict["revision"], 1)
        self.assertEqual(conflict["data"]["accent"], "system")
        self.assertEqual(self.current()["data"], data)

    def test_concurrent_same_revision_writes_have_one_winner(self):
        headers = self.auth()
        first = copy.deepcopy(module.DEFAULT_DATA)
        second = copy.deepcopy(module.DEFAULT_DATA)
        first["accent"] = "pink"
        second["accent"] = "system"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda data: self.update(data, headers=headers)[0], (first, second)))
        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(self.current()["revision"], 1)

    def test_invalid_schema_credentials_limits_and_content_types_are_rejected(self):
        variants = []
        for key, value in [("art", "false"), ("accent", "red"), ("links", {})]:
            data = copy.deepcopy(module.DEFAULT_DATA)
            data[key] = value
            variants.append(data)
        data = copy.deepcopy(module.DEFAULT_DATA)
        data["links"] = [dict(data["links"][0], id=f"item-{i}") for i in range(13)]
        variants.append(data)
        for key, value in [("name", "x" * 37), ("id", "x" * 81), ("icon", "unknown"), ("color", "orange"), ("url", "https://user:pass@example.com/"), ("url", "file:///tmp/test"), ("url", "https://example.com:99999/")]:
            data = copy.deepcopy(module.DEFAULT_DATA)
            data["links"][0][key] = value
            variants.append(data)
        for data in variants:
            self.assertEqual(self.update(data)[0], 400)
        self.assertEqual(self.update(copy.deepcopy(module.DEFAULT_DATA), revision=True)[0], 400)
        headers = {**self.auth(), "Content-Type": "text/plain"}
        self.assertEqual(self.update(copy.deepcopy(module.DEFAULT_DATA), headers=headers)[0], 415)
        self.assertEqual(self.request("PUT", raw=b"not json", headers=self.auth())[0], 400)
        self.assertEqual(self.request("PUT", raw=b"x" * (module.MAX_BODY + 1), headers=self.auth())[0], 413)
        self.assertFalse(self.state.exists())

    def test_corrupt_existing_state_returns_503_and_is_preserved(self):
        self.stop()
        self.state.parent.mkdir()
        self.state.write_text("incomplete state fixture")
        self.start()
        self.assertEqual(self.request()[0], 503)
        headers = {"Origin": self.origin, "Content-Type": "application/json", "X-Kitsune-Token": self.server.token}
        self.assertEqual(self.update(copy.deepcopy(module.DEFAULT_DATA), headers=headers)[0], 503)
        self.assertEqual(self.state.read_text(), "incomplete state fixture")
        self.assertEqual(self.request(path="/")[0], 200)

    def test_failed_atomic_replace_preserves_memory_disk_and_revision(self):
        data = copy.deepcopy(module.DEFAULT_DATA)
        self.assertEqual(self.update(data)[0], 200)
        before = self.state.read_bytes()
        data["focus"] = True
        with mock.patch.object(module.os, "replace", side_effect=OSError("fixture disk failure")):
            self.assertEqual(self.update(data, revision=1)[0], 503)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(self.current()["revision"], 1)
        self.assertFalse(self.current()["data"]["focus"])
        self.assertEqual(list(self.state.parent.glob(".home-*.tmp")), [])

    def test_no_cors_preflight_or_unrequested_write_methods(self):
        for method in ("POST", "DELETE", "OPTIONS", "PATCH"):
            status, _, headers = self.request(method)
            self.assertEqual(status, 405)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
            self.assertNotIn("Access-Control-Allow-Methods", headers)
        self.assertFalse(self.state.exists())

    def test_notify_is_optional_and_supports_abstract_sockets(self):
        with mock.patch.dict(module.os.environ, {"NOTIFY_SOCKET": ""}):
            self.assertFalse(module.notify_ready(self.server))
        name = f"kitsune-notify-{os.getpid()}-{self.port}"
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as listener:
            listener.bind("\0" + name)
            listener.settimeout(3)
            with mock.patch.dict(module.os.environ, {"NOTIFY_SOCKET": "@" + name}):
                self.assertTrue(module.notify_ready(self.server))
            self.assertIn(b"READY=1", listener.recv(1024))

    def test_cli_notifies_only_after_http_socket_is_bound(self):
        notify_path = str(Path(self.temporary.name) / "notify.sock")
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as listener:
            listener.bind(notify_path)
            listener.settimeout(5)
            process = subprocess.Popen(
                [sys.executable, str(MODULE_PATH), "--root", str(self.root),
                 "--state", str(Path(self.temporary.name) / "notify-state/home.json"), "--port", "0"],
                env={**os.environ, "NOTIFY_SOCKET": notify_path},
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            try:
                notification = listener.recv(1024).decode("utf-8")
                self.assertIn("READY=1\n", notification)
                notified_port = int(notification.rsplit(":", 1)[1])
                connection = http.client.HTTPConnection("127.0.0.1", notified_port, timeout=3)
                try:
                    connection.request("GET", "/api/settings")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read())["version"], 2)
                finally:
                    connection.close()
            finally:
                process.terminate()
                _, errors = process.communicate(timeout=8)
            self.assertEqual(process.returncode, 0, errors.decode())


if __name__ == "__main__":
    unittest.main(verbosity=2)
