"""Serve public/ for local testing, telling the browser not to cache.

Without this, a browser can keep an old index.html next to a new app.js after an update,
and the page loads with no data. Usage: npm run serve (or python3 scripts/serve.py [port]).
"""
import functools
import http.server
import pathlib
import sys

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCache, directory=str(PUBLIC))
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {PUBLIC} at http://localhost:{port} (no browser cache)")
        httpd.serve_forever()
