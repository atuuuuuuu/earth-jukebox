"""Serve public/ for local testing, telling the browser not to cache.

Without this, a browser can keep an old index.html next to a new app.js after an update,
and the page loads with no data. Usage: npm run serve (or python3 scripts/serve.py [port]).
"""
import functools
import http.server
import pathlib
import re
import sys

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"


class NoCache(http.server.SimpleHTTPRequestHandler):
    """No browser cache, and byte ranges: Safari will not play a video from a server without them."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self.range_left = None   # the handler is reused across keep-alive requests
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        path = pathlib.Path(self.translate_path(self.path))
        if not m or not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        start = int(m[1]) if m[1] else max(0, size - int(m[2] or 0))
        end = min(size - 1, int(m[2])) if m[1] and m[2] else size - 1
        if start >= size or start > end:
            self.send_error(416, "Range not satisfiable")
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(65536, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCache, directory=str(PUBLIC))
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {PUBLIC} at http://localhost:{port} (no browser cache)")
        httpd.serve_forever()
