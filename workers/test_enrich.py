"""Testes offline do worker: python3 workers/test_enrich.py"""
import asyncio
import os
import sys
import unittest
from unittest import mock

import httpx

sys.path.insert(0, os.path.dirname(__file__))
import enrich

RESULT = '''<div class="result results_links results_links_deep web-result">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="{href}">{title}</a></h2>
<a class="result__snippet" href="{href}">{snippet}</a>
</div>'''


def page(*results):
    return "<html><body>" + "".join(RESULT.format(href=h, title=t, snippet=s) for h, t, s in results) + "</body></html>"


AURORA = page(
    ("//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Fstudioaurora%2F&amp;rut=x", "Studio Aurora (@studioaurora)", "1.234 seguidores. WhatsApp (51) 99123-4567"),
    ("https://outraempresa.com.br/", "Clínica Vizinha", "contato@vizinha.com.br (51) 98888-7777"),
    ("https://guia.com.br/studio-aurora", "Studio Aurora em Porto Alegre", "E-mail: aurora@gmail.com"),
)


class Parser(unittest.TestCase):
    def test_redirect_links_are_decoded(self):
        self.assertEqual(enrich._parse_ddg(AURORA)[0].url, "https://www.instagram.com/studioaurora/")

    def test_block_page_raises(self):
        for html in ('<div class="anomaly-modal__title">bots</div>', "<html>algo mudou</html>"):
            with self.assertRaises(enrich.SearchBlocked):
                enrich._parse_ddg(html)

    def test_real_empty_page_is_not_a_block(self):
        self.assertEqual(enrich._parse_ddg('<div class="no-results">No results.</div>'), [])

    def test_only_results_about_the_lead_count(self):
        relevant = enrich._about_lead(enrich._parse_ddg(AURORA), "Studio Aurora")
        self.assertEqual(len(relevant), 2)
        self.assertNotIn("vizinha", " ".join(r.text for r in relevant))

    def test_brave_shape(self):
        results = enrich._parse_brave({"web": {"results": [{"url": "https://a.com", "title": "<b>A</b>", "description": "d", "extra_snippets": ["e"]}, {"title": "sem url"}]}})
        self.assertEqual([(r.url, r.title, r.text) for r in results], [("https://a.com", "A", "d e")])


def fake_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class Enrich(unittest.TestCase):
    def run_with(self, handler, lead=None):
        original = httpx.AsyncClient
        with mock.patch.object(enrich.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler))):
            return enrich.enrich_sync(lead or {"name": "Studio Aurora", "city": "Porto Alegre", "phone": None})

    def test_contacts_come_from_the_lead_only(self):
        out = self.run_with(lambda req: httpx.Response(200, text=AURORA))
        self.assertEqual(out["email"], "aurora@gmail.com")
        self.assertEqual(out["mobilePhone"], "(51) 99123-4567")
        self.assertEqual(out["instagram"], "https://www.instagram.com/studioaurora")
        self.assertEqual(out["igFollowers"], 1234)
        self.assertFalse(out["partial"])

    def test_http_202_block_is_partial_not_empty_success(self):
        out = self.run_with(lambda req: httpx.Response(202, text="<html></html>"))
        self.assertTrue(out["partial"])
        self.assertIsNone(out["email"])

    def test_brave_key_uses_the_official_api(self):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json={"web": {"results": [
                {"url": "https://www.facebook.com/studioaurora", "title": "Studio Aurora", "description": "Celular (51) 99123-4567"},
            ]}})

        with mock.patch.dict(os.environ, {"BRAVE_API_KEY": "chave-de-teste"}):
            out = self.run_with(handler)
        self.assertEqual(seen[0].url.host, "api.search.brave.com")
        self.assertEqual(seen[0].headers["x-subscription-token"], "chave-de-teste")
        self.assertEqual(out["facebook"], "https://www.facebook.com/studioaurora")
        self.assertEqual(out["mobilePhone"], "(51) 99123-4567")


if __name__ == "__main__":
    unittest.main()
