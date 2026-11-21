#!/usr/bin/env python3
"""Rebuild the embedded, source-backed perk catalog without changing rule logic."""
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
source = json.loads((root / 'character-perks-source.json').read_text())
keys = ['id', 'name', 'description', 'level', 'requirements', 'ranks', 'effects']
catalog = [{key: entry[key] for key in keys} for entry in source]
assert len(catalog) == 83 and len({entry['id'] for entry in catalog}) == 83
path = root / 'web' / 'rules-character.js'
contents = path.read_text()
replacement = '  const PERKS = ' + json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '; // PERKS_SOURCE_INSERT'
contents, count = re.subn(r'^  const PERKS = .*; // PERKS_SOURCE_INSERT$', lambda _: replacement, contents, count=1, flags=re.MULTILINE)
assert count == 1, 'Perk insertion marker missing'
path.write_text(contents)
print(f'Embedded {len(catalog)} source perks.')
