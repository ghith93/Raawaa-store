#!/usr/bin/env python3
"""Local static test server with Cloudflare Pages-style clean URL redirects."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parent.parent
CLEAN_ROUTES = {
    "/serum": "/serum.html",
    "/campaign": "/campaign.html",
    "/privacy": "/privacy.html",
}


class PagesLikeHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        request = urlsplit(self.path)
        if request.path == "/index.html":
            self.send_response(301)
            self.send_header("Location", urlunsplit(("", "", "/", request.query, "")))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        target = CLEAN_ROUTES.get(request.path)
        if target:
            self.path = urlunsplit(("", "", target, request.query, ""))
        return super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--directory", type=Path, default=ROOT)
    args = parser.parse_args()
    handler = partial(PagesLikeHandler, directory=str(args.directory.resolve()))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Pages-like test server on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
