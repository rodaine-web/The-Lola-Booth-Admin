"""Offline transport fault tests; no database, credentials or Azure calls."""
import ast
import base64
import contextlib
import hashlib
import http.client
import io
import json
from pathlib import Path
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch
import xml.etree.ElementTree as ET

source = ast.parse(Path(__file__).with_name('daily-production-backup.py').read_text())
selected = []
for node in source.body:
    if isinstance(node, ast.Import) and all(not item.name.startswith(('psycopg2', 'cryptography')) for item in node.names):
        selected.append(node)
    elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('PREFIX', 'TRANSFER_BLOCK_BYTES', 'TRANSFER_ATTEMPTS') for t in node.targets):
        selected.append(node)
    elif isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ('transfer_retry', 'Azure'):
        selected.append(node)
namespace = {}
exec(compile(ast.Module(body=selected, type_ignores=[]), '<backup transport>', 'exec'), namespace)
Azure = namespace['Azure']
PREFIX = namespace['PREFIX']
BLOCK = namespace['TRANSFER_BLOCK_BYTES']

class Response:
    def __init__(self, status=201, data=b'', read_error=None):
        self.status, self.data, self.read_error = status, data, read_error
        self.headers = {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self):
        if self.read_error: raise self.read_error
        return self.data

class Store:
    def __init__(self):
        self.objects, self.blocks, self.requests = {}, {}, []
        self.fail_block_once = False
        self.lose_commit_response = False
        self.lose_read_once = False
        self.forbidden = False
    def __call__(self, req, timeout):
        parsed = urllib.parse.urlsplit(req.full_url)
        path, query = parsed.path, urllib.parse.parse_qs(parsed.query)
        method = req.get_method()
        headers = {k.lower(): v for k, v in req.header_items()}
        self.requests.append((method, path, query, headers))
        if self.forbidden:
            raise urllib.error.HTTPError(req.full_url, 403, 'provider body secret', {}, None)
        if method == 'GET':
            if path not in self.objects: raise urllib.error.HTTPError(req.full_url, 404, 'missing', {}, None)
            if self.lose_read_once:
                self.lose_read_once = False
                return Response(200, read_error=http.client.IncompleteRead(b'partial'))
            return Response(200, self.objects[path])
        if query.get('comp') == ['block']:
            if self.fail_block_once:
                self.fail_block_once = False
                raise urllib.error.URLError(TimeoutError('secret URL must not be logged'))
            assert len(req.data) <= BLOCK
            assert headers['content-md5'] == base64.b64encode(hashlib.md5(req.data).digest()).decode()
            self.blocks.setdefault(path, {})[query['blockid'][0]] = req.data
            return Response()
        assert headers['if-none-match'] == '*'
        if path in self.objects: raise urllib.error.HTTPError(req.full_url, 412, 'exists', {}, None)
        if query.get('comp') == ['blocklist']:
            ids = [n.text for n in ET.fromstring(req.data)]
            self.objects[path] = b''.join(self.blocks[path][key] for key in ids)
            if self.lose_commit_response:
                self.lose_commit_response = False
                raise urllib.error.URLError(TimeoutError('lost commit response'))
        else:
            self.objects[path] = req.data
        return Response()

class TransferTests(unittest.TestCase):
    def setUp(self):
        self.client = Azure.__new__(Azure)
        self.client.url = 'https://test.blob.core.windows.net/private'
        self.client.headers = {'Authorization': 'Bearer secret-token', 'x-ms-version': '2023-11-03'}
        self.name = PREFIX + 'qa.dump.gcm'
        self.store = Store()
        self.open_patch = patch('urllib.request.urlopen', self.store)
        self.sleep_patch = patch.object(namespace['time'], 'sleep')
        self.open_patch.start(); self.sleep = self.sleep_patch.start()
        self.addCleanup(self.open_patch.stop); self.addCleanup(self.sleep_patch.stop)
    def test_chunked_upload_and_exact_readback(self):
        data = b'encrypted' * (BLOCK // 9 + 20)
        self.client.put(self.name, data)
        self.assertEqual(self.client.get(self.name), data)
        self.assertEqual(sum(q.get('comp') == ['block'] for _, _, q, _ in self.store.requests), 2)
    def test_transient_chunk_failure_retries_same_bytes(self):
        data = b'x' * (BLOCK + 7)
        self.store.fail_block_once = True
        self.client.put(self.name, data)
        self.assertEqual(self.client.get(self.name), data)
        self.assertEqual(self.sleep.call_count, 1)
    def test_lost_commit_response_is_reconciled_without_overwrite(self):
        data = b'x' * (BLOCK + 7)
        self.store.lose_commit_response = True
        self.client.put(self.name, data)
        self.assertEqual(self.client.get(self.name), data)
    def test_existing_different_blob_is_never_overwritten(self):
        path = '/private/' + self.name
        self.store.objects[path] = b'previous backup'
        with self.assertRaisesRegex(AssertionError, 'overwrite refused'):
            self.client.put(self.name, b'replacement')
        self.assertEqual(self.store.objects[path], b'previous backup')
    def test_permanent_permission_failure_is_not_retried(self):
        self.store.forbidden = True
        with self.assertRaises(urllib.error.HTTPError): self.client.put(self.name, b'data')
        self.assertEqual(len(self.store.requests), 1)
        self.sleep.assert_not_called()
    def test_exhausted_network_failure_is_bounded_and_redacted(self):
        failure = urllib.error.URLError(TimeoutError('https://secret-token@example.invalid/private'))
        with patch('urllib.request.urlopen', side_effect=failure) as call, contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(urllib.error.URLError): self.client.put(self.name, b'data')
        # Four upload attempts followed by four read-only reconciliation attempts.
        self.assertEqual(call.call_count, 8)
        self.assertNotIn('secret-token', output.getvalue())
        self.assertNotIn('example.invalid', output.getvalue())
        self.assertIn('TIMEOUT', output.getvalue())
    def test_interrupted_readback_is_retried(self):
        self.client.put(self.name, b'encrypted')
        self.store.lose_read_once = True
        self.assertEqual(self.client.get(self.name), b'encrypted')
        self.assertEqual(self.sleep.call_count, 1)
    def test_retryable_http_statuses(self):
        for code in (408, 429, 500, 502, 503, 504):
            with self.subTest(code=code):
                error = urllib.error.HTTPError('https://test.invalid', code, 'redacted', {}, None)
                with patch('urllib.request.urlopen', side_effect=[error, Response(200, b'ok')]) as call:
                    self.assertEqual(self.client.get(self.name), b'ok')
                    self.assertEqual(call.call_count, 2)
    def test_tls_failure_is_not_retried(self):
        error = urllib.error.URLError(namespace['ssl'].SSLCertVerificationError('redacted'))
        with patch('urllib.request.urlopen', side_effect=error) as call:
            with self.assertRaises(urllib.error.URLError): self.client.get(self.name)
            self.assertEqual(call.call_count, 1)
            self.sleep.assert_not_called()
    def test_chunked_collision_preserves_existing_backup(self):
        path = '/private/' + self.name
        self.store.objects[path] = b'previous encrypted backup'
        with self.assertRaisesRegex(AssertionError, 'overwrite refused'):
            self.client.put(self.name, b'x' * (BLOCK + 7))
        self.assertEqual(self.store.objects[path], b'previous encrypted backup')
    def test_small_key_and_manifest_remain_conditional_creates(self):
        for extension in ('key.rsa', 'manifest.json'):
            name = PREFIX + 'qa.' + extension
            self.client.put(name, b'private companion object')
            self.assertEqual(self.client.get(name), b'private companion object')
        self.assertFalse(any(q.get('comp') == ['block'] for _, _, q, _ in self.store.requests))

if __name__ == '__main__': unittest.main()
