#!/usr/bin/env python3
"""Bundle the current dist/index.html into its downloadable offline notebook."""
from __future__ import annotations

import base64
import html
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


class Tag(HTMLParser):
    def __init__(self, markup: str):
        super().__init__(convert_charrefs=True)
        self.attrs: dict[str, str | None] = {}
        self.feed(markup)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.attrs = dict(attrs)


def local_file(url: str, parent: Path) -> Path | None:
    parts = urlsplit(html.unescape(url))
    if parts.scheme or parts.netloc or not parts.path or url.startswith(("#", "${")):
        return None
    path = (DIST / unquote(parts.path).lstrip("/")) if parts.path.startswith("/") else (parent / unquote(parts.path))
    path = path.resolve()
    if not path.is_relative_to(DIST.resolve()):
        raise ValueError(f"Resource is outside dist: {url}")
    return path


def data_uri(path: Path) -> str:
    mime = {".woff2": "font/woff2", ".svg": "image/svg+xml", ".webp": "image/webp"}.get(path.suffix)
    mime = mime or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def embed_css(css: str, parent: Path) -> str:
    def resource(match: re.Match[str]) -> str:
        value = match[1].strip().strip("\"'")
        path = local_file(value, parent)
        return f'url("{data_uri(path)}")' if path else match[0]

    if re.search(r"@import\b", css, flags=re.I):
        raise ValueError("Move imported styles into index.html before bundling")
    return re.sub(r"url\(\s*(.*?)\s*\)", resource, css, flags=re.I)


def embed_markup_assets(source: str, parent: Path) -> str:
    # This also reaches image attributes in JavaScript HTML template strings.
    def resource(match: re.Match[str]) -> str:
        value = match[3]
        if "${" in value or value.startswith("#"):
            return match[0]
        path = local_file(value, parent)
        if path and path.is_file() and path.suffix.lower() in {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2"}:
            return match[1] + match[2] + data_uri(path) + match[2]
        return match[0]

    return re.sub(r"(\b(?:src|href)\s*=\s*)([\"'])(.*?)(?:\2)", resource, source, flags=re.I)


def build() -> Path:
    source = (DIST / "index.html").read_text(encoding="utf-8")

    def link(match: re.Match[str]) -> str:
        attrs = Tag(match[0]).attrs
        rel = (attrs.get("rel") or "").lower().split()
        if "preload" in rel and attrs.get("as") == "font":
            return ""
        if "stylesheet" not in rel:
            return match[0]
        path = local_file(attrs.get("href") or "", DIST)
        if path is None:
            raise ValueError("Offline stylesheets must be local files")
        css = embed_css(path.read_text(encoding="utf-8"), path.parent)
        return '<style data-source="' + html.escape(path.relative_to(DIST).as_posix(), quote=True) + '">' + css + "</style>"

    source = re.sub(r"<link\b[^>]*>", link, source, flags=re.I)

    def script(match: re.Match[str]) -> str:
        attrs = Tag(match[1]).attrs
        if not attrs.get("src"):
            return match[0]
        path = local_file(attrs["src"], DIST)
        if path is None:
            raise ValueError("Offline scripts must be local files")
        js = embed_markup_assets(path.read_text(encoding="utf-8"), path.parent)
        js = re.sub(r"</script", lambda _: r"<\/script", js, flags=re.I)
        extra = "".join(" " + name + ("" if value is None else '="' + html.escape(value, quote=True) + '"') for name, value in attrs.items() if name != "src")
        return '<script data-source="' + html.escape(path.relative_to(DIST).as_posix(), quote=True) + '"' + extra + '>' + js + "</script>"

    source = re.sub(r"(<script\b[^>]*>).*?</script\s*>", script, source, flags=re.I | re.S)
    source = re.sub(r'<a\b(?=[^>]*\bhref=[\"\']niti-offline\.html[\"\'])[^>]*>.*?</a\s*>', "", source, flags=re.I | re.S)
    source = embed_markup_assets(source, DIST)
    licenses = {"fonts/OFL-Oswald.txt": (DIST / "fonts/OFL-Oswald.txt").read_text(encoding="utf-8")}
    metadata = json.dumps(licenses, ensure_ascii=False).replace("</", "<\\/")
    source = source.replace("</body>", '<script id="niti-asset-licenses" type="application/json">' + metadata + "</script>\n</body>")
    output = DIST / "niti-offline.html"
    output.write_text(source, encoding="utf-8")
    return output


if __name__ == "__main__":
    output = build()
    print(f"Built {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes)")
