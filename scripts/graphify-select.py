#!/usr/bin/env python3
"""Build a safe, deterministic snapshot for Graphify, never scanning credentials."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import re
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
if len(sys.argv) != 2:
    raise SystemExit('usage: graphify-select.py OUTPUT_DIRECTORY')
out = Path(sys.argv[1]).resolve()
if not out.is_dir() or any(out.iterdir()):
    raise SystemExit('output must be an empty directory')
tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).split(b'\0')
allowed = {'.js', '.mjs', '.py', '.sh', '.sql', '.md', '.yml', '.yaml', '.json', '.html', '.css'}
asset_types = {'.avif', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.woff2'}
inventory_types = {'.txt', '.xml', '.webmanifest', '.lock'}
inventory_names = {'_headers', '_redirects'}
excluded_dirs = {'.git', '.config', '.local', '.wrangler', '.cache', 'node_modules', 'dist', '__pycache__', 'vendor'}
files, inventory, ui_sections = 0, [], []


def safe_link(value):
    # Retain only local paths; strip query and fragment (which may hold private data).
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return None
    if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith('/') or '..' in Path(parsed.path).parts:
        return None
    if not re.fullmatch(r'[A-Za-z0-9_./-]{1,180}', parsed.path):
        return None
    return parsed.path


class Structure(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.classes, self.links = set(), set(), set()

    def handle_starttag(self, _tag, attrs):
        for key, value in attrs:
            if not value:
                continue
            if key == 'id' and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
                self.ids.add(value)
            elif key == 'class':
                self.classes.update(x for x in value.split() if re.fullmatch(r'[A-Za-z0-9_-]{1,80}', x))
            elif key in {'src', 'href'}:
                link = safe_link(value)
                if link:
                    self.links.add(link)

for raw in tracked:
    if not raw:
        continue
    name = raw.decode('utf-8')
    relative = Path(name)
    if relative.is_absolute() or any(part in excluded_dirs or part in ('..', '') for part in relative.parts):
        continue
    # Never include hidden files/directories other than known repository workflows.
    if any(part.startswith('.') for part in relative.parts) and relative.parts[0] != '.github':
        continue
    if relative.name.startswith('.') or relative.suffix.lower() not in allowed | asset_types | inventory_types and relative.name not in inventory_names:
        continue
    path = root / relative
    if path.is_symlink() or not path.is_file():
        continue
    suffix = relative.suffix.lower()
    if suffix in asset_types | inventory_types or relative.name in inventory_names:
        inventory.append(relative.as_posix())  # names only; no binary or non-structural content
        continue
    if suffix in {'.html', '.css'}:
        # Derive structure locally without copying page content or query parameters.
        text = path.read_text(encoding='utf-8')
        parser = Structure()
        if suffix == '.html':
            parser.feed(text)
        else:
            for url in re.findall(r'url\(\s*[\"\']?([^\)\"\']+)', text, flags=re.I):
                link = safe_link(url)
                if link:
                    parser.links.add(link)
        heading = '## ' + relative.as_posix()
        refs = [f'- [local resource]({link})' for link in sorted(parser.links)[:200]]
        ids = ', '.join(sorted(parser.ids)[:200])
        classes = ', '.join(sorted(parser.classes)[:200])
        ui_sections.append('\n'.join([heading, f'- Element IDs: {ids}', f'- Classes: {classes}', *refs]))
        inventory.append(relative.as_posix())
        continue
    dest = out / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dest)
    files += 1
(out / 'project-ui-structure.md').write_text('# Local UI structure\n\n' + '\n\n'.join(ui_sections) + '\n', encoding='utf-8')
inventory_path = out / 'project-file-inventory.md'
inventory_path.write_text('# Project file inventory\n\n' + '\n'.join('- `' + name + '`' for name in sorted(inventory)) + '\n', encoding='utf-8')
print(f'Graphify input: {files} structural files; {len(inventory)} UI, asset or other file names inventoried; UI IDs/classes/local links extracted.')
