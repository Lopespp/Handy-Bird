"""Checks on the site files that do not need a browser."""

from pathlib import Path
import re
import unittest

WEB_DIRECTORY = Path(__file__).resolve().parent.parent / "web"


class SiteTests(unittest.TestCase):
    def test_no_version_query_strings(self):
        # O cache e resolvido pelos cabecalhos; ?v= manual voltaria a exigir trocar
        # o numero em varios arquivos a cada mudanca.
        for path in WEB_DIRECTORY.rglob("*"):
            if path.suffix in {".html", ".js", ".css"}:
                with self.subTest(path=path.name):
                    self.assertIsNone(re.search(r"\?v=\d", path.read_text(encoding="utf-8")))

    def test_every_file_is_revalidated(self):
        headers = (WEB_DIRECTORY / "_headers").read_text(encoding="utf-8")
        self.assertIn("Cache-Control: public, max-age=0, must-revalidate", headers)
        self.assertNotRegex(headers, r"max-age=[1-9]")

    def test_both_languages_have_the_same_texts(self):
        source = (WEB_DIRECTORY / "js" / "i18n.js").read_text(encoding="utf-8")
        english = re.search(r"en: \{(.*?)\n  \},", source, re.S).group(1)
        portuguese = re.search(r"pt: \{(.*?)\n  \},", source, re.S).group(1)
        keys = lambda block: re.findall(r'^\s+"?([\w.-]+)"?:', block, re.M)
        self.assertEqual(keys(english), keys(portuguese))
        markup = (WEB_DIRECTORY / "index.html").read_text(encoding="utf-8")
        for key in re.findall(r'data-i18n(?:-[\w-]+)?="([\w.-]+)"', markup):
            with self.subTest(key=key):
                self.assertIn(key, keys(english))


if __name__ == "__main__":
    unittest.main()
