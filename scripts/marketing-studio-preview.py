#!/usr/bin/env python3
"""Serve only the local-only RAWAA marketing desk and explicitly whitelisted assets."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {
    "/docs/marketing-studio/": "docs/marketing-studio/index.html",
    "/docs/marketing-studio/index.html": "docs/marketing-studio/index.html",
    "/docs/marketing-studio/app.css": "docs/marketing-studio/app.css",
    "/docs/marketing-studio/app.js": "docs/marketing-studio/app.js",
    "/docs/order-flow-prototype/": "docs/order-flow-prototype/index.html",
    "/docs/order-flow-prototype/index.html": "docs/order-flow-prototype/index.html",
    "/docs/order-flow-prototype/app.css": "docs/order-flow-prototype/app.css",
    "/docs/order-flow-prototype/app.js": "docs/order-flow-prototype/app.js",
    "/docs/ORGANIC-TEST-KIT-AR.md": "docs/ORGANIC-TEST-KIT-AR.md",
    "/docs/PRIVACY-ORDER-COLLECTION-DRAFT-AR.md": "docs/PRIVACY-ORDER-COLLECTION-DRAFT-AR.md",
    "/js/config.js": "js/config.js",
    "/js/offers.js": "js/offers.js",
    "/order-system/order-pricing.js": "order-system/order-pricing.js",
    "/docs/visual-drafts/rawaa-flow-concept-01-1080x1350.jpg": "docs/visual-drafts/rawaa-flow-concept-01-1080x1350.jpg",
    "/docs/visual-drafts/size-guide-ar-1080x1350.svg": "docs/visual-drafts/size-guide-ar-1080x1350.svg",
    "/assets/img/campaign/quiet-finish-editorial-v1-720.webp": "assets/img/campaign/quiet-finish-editorial-v1-720.webp",
    "/assets/img/products/trio-v6-1080.jpg": "assets/img/products/trio-v6-1080.jpg",
    "/assets/fonts/plexar-400.subset.woff2": "assets/fonts/plexar-400.subset.woff2",
    "/assets/fonts/plexar-700.subset.woff2": "assets/fonts/plexar-700.subset.woff2",
}


class MarketingStudioHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/docs/marketing-studio/")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        relative = ALLOWED.get(path)
        if relative is None:
            self.send_error(404)
            return
        file_path = (ROOT / relative).resolve()
        if ROOT not in file_path.parents or not file_path.is_file():
            self.send_error(404)
            return
        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        if file_path.suffix == ".svg":
            content_type = "image/svg+xml"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Keep the local preview logs free from query values and user-entered data.
        print("marketing-studio-preview request")


if __name__ == "__main__":
    print("Local marketing desk preview on 0.0.0.0:4173; all non-whitelisted paths return 404.")
    ThreadingHTTPServer(("0.0.0.0", 4173), MarketingStudioHandler).serve_forever()
