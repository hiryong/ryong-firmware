"""Pack a browser-only runtime preview. USB/BLE transports are disabled in this build."""
from pathlib import Path
import base64
import mimetypes
import re
import sys

root = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2])
html = (root / "index.html").read_text()

def resource(url, parent=root):
    if url.startswith(("data:", "http:", "https:", "#")):
        return None
    clean = url.split("?")[0].split("#")[0]
    path = (root / clean.lstrip("/")) if clean.startswith("/") else (parent / clean).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Resource escaped preview directory")
    return path if path.is_file() else None

def data_url(path):
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return "data:" + mime + ";base64," + base64.b64encode(path.read_bytes()).decode()

def css(text, parent):
    def replace(match):
        url = match.group(1).strip().strip("\"'")
        path = resource(url, parent)
        return 'url("' + data_url(path) + '")' if path else match.group(0)
    return re.sub(r"url\\(([^)]+)\\)", replace, text)

def style_link(match):
    tag = match.group(0)
    href = re.search(r'href=["\\\']([^"\\\']+)["\\\']', tag)
    if not href: return tag
    path = resource(href.group(1))
    if not path: raise ValueError("Missing stylesheet: " + href.group(1))
    return "<style>" + css(path.read_text(), path.parent) + "</style>"

html = re.sub(r'<link\\b[^>]*rel=["\\\']stylesheet["\\\'][^>]*>', style_link, html)
def script_tag(match):
    path = resource(match.group(1))
    if not path: raise ValueError("Missing script: " + match.group(1))
    text = path.read_text()
    # Vite already inlines source imports; inline remaining public asset literals.
    def public_asset(m):
        file = resource(m.group(2))
        return m.group(1) + data_url(file) + m.group(1) if file else m.group(0)
    text = re.sub(r'(["\\\'])(/[^"\\\']+\\.(?:woff2|png|webp|svg))\\1', public_asset, text)
    text = text.replace("</script", "<\\\\/script")
    return '<script type="module">' + text + "</script>"
html = re.sub(r'<script\\b[^>]*src=["\\\']([^"\\\']+)["\\\'][^>]*>\\s*</script>', script_tag, html)
html = re.sub(r'<style>([\\s\\S]*?)</style>', lambda m: "<style>" + css(m.group(1), root) + "</style>", html)
html = re.sub(r'<link\\b[^>]*rel=["\\\'](?:modulepreload|preload)["\\\'][^>]*>', "", html)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(html)
print(f"Offline preview: {output.stat().st_size} bytes")
