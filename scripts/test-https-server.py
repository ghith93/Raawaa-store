#!/usr/bin/env python3
"""Local-only HTTPS static server for browser CI; never used in production."""
import http.server
import ssl
import sys

if len(sys.argv) != 3:
    sys.exit('Usage: test-https-server.py CERT KEY')

server = http.server.ThreadingHTTPServer(('127.0.0.1', 8443), http.server.SimpleHTTPRequestHandler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(sys.argv[1], sys.argv[2])
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
