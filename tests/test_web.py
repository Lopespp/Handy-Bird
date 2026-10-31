"""Runs web/tests.js in a headless browser; skipped when Playwright is missing."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from threading import Thread
import unittest

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


WEB_DIRECTORY = Path(__file__).resolve().parent.parent / "web"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *arguments: object) -> None:
        pass


@unittest.skipIf(sync_playwright is None, "Instale requirements-dev.txt para rodar os testes web.")
class WebTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        handler = partial(QuietHandler, directory=str(WEB_DIRECTORY))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def run_page(self, viewport: dict[str, int]) -> tuple[dict, list[str]]:
        # HANDY_BIRD_BROWSER=msedge usa o Edge instalado, sem baixar o Chromium.
        channel = os.environ.get("HANDY_BIRD_BROWSER") or None
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(channel=channel)
            except Exception as error:
                if "Executable doesn't exist" not in str(error):
                    raise
                self.skipTest("Rode `python -m playwright install chromium` ou defina HANDY_BIRD_BROWSER=msedge.")
            try:
                page = browser.new_page(viewport=viewport)
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(self.url)
                # Os testes importam app.js pela mesma URL do index.html (um modulo so).
                entry = page.evaluate("document.querySelector('script[type=module]').src")
                # Espera a cena do Phaser ficar pronta (evaluate aguarda a Promise de verdade).
                ready = page.evaluate(
                    """async (entry) => {
                      const { state } = await import(entry);
                      const deadline = performance.now() + 30000;
                      while (!state.ready && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
                      return state.ready && !!state.scene;
                    }""",
                    entry,
                )
                self.assertTrue(ready, "A cena do jogo nao ficou pronta em 30 s.")
                tests = entry.replace("/app.js", "/tests.js")
                result = page.evaluate(f"import('{tests}').then(module => module.runTests())")
                return result, errors
            finally:
                browser.close()

    def test_rules_and_interface_on_desktop(self):
        result, errors = self.run_page({"width": 1280, "height": 800})
        self.assertGreater(result["count"], 60)
        self.assertEqual(errors, [])

    def test_rules_and_interface_on_phone(self):
        result, errors = self.run_page({"width": 375, "height": 812})
        self.assertGreater(result["count"], 60)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
