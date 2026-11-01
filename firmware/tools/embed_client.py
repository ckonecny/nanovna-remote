# Generates src/client_assets.cpp from the built web client (../client/dist): every file gzip-compressed
# into a const byte array plus a lookup table. Runs before every build; without a dist/ the table is empty.
Import("env")  # noqa: F821
import gzip
import re
from pathlib import Path

project = Path(env["PROJECT_DIR"])  # noqa: F821
dist = project.parent / "client" / "dist"
dst = project / "src" / "client_assets.cpp"

TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
    ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon",
}
SKIP = {"sw.js", "registerSW.js", "manifest.webmanifest"}  # a service worker needs https, useless here

files = []
if dist.is_dir():
    for p in sorted(dist.rglob("*")):
        rel = p.relative_to(dist).as_posix()
        if not p.is_file() or p.name in SKIP or p.name.startswith("workbox-"):
            continue
        data = p.read_bytes()
        if rel == "index.html":
            text = data.decode("utf-8")
            text = re.sub(r"<script[^>]*registerSW[^>]*></script>", "", text)
            text = re.sub(r"<link[^>]*manifest[^>]*>", "", text)
            data = text.encode("utf-8")
        files.append((rel, TYPES.get(p.suffix, "application/octet-stream"), gzip.compress(data, 9, mtime=0)))

out = ["// generated from ../client/dist by tools/embed_client.py - do not edit",
       '#include "client_assets.h"', ""]
for i, (_, _, blob) in enumerate(files):
    out.append(f"static const unsigned char a{i}[] = {{" + ",".join(str(b) for b in blob) + "};")
out.append("const ClientAsset CLIENT_ASSETS[] = {")
for i, (rel, ctype, blob) in enumerate(files):
    out.append(f'    {{"/{rel}", "{ctype}", a{i}, {len(blob)}}},')
out.append("};")
out.append(f"const unsigned CLIENT_ASSET_COUNT = {len(files)};")
text = "\n".join(out) + "\n"
if not dst.exists() or dst.read_text() != text:
    dst.write_text(text)
