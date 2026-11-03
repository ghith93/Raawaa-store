#!/usr/bin/env python3
"""خادم معاينة بسيط لأداة حاسبة الربح — يخدمها في جذر المعاينة.

الاستخدام:
    python3 tools/serve.py 8080

ملاحظة: هذا الملف للمعاينة المحلية فقط، وليس جزءًا من موقع المتجر المنشور.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.path = "/tools/profit-calculator.html"
        return super().do_GET()

    def do_HEAD(self):
        if self.path in ("/", "/index.html"):
            self.path = "/tools/profit-calculator.html"
        return super().do_HEAD()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"RAWAA profit calculator → http://0.0.0.0:{PORT}/")
    server.serve_forever()
