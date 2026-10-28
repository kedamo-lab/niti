"""Extend the retained equipment catalog with bundled Fallout 2 ammunition."""
from pathlib import Path
import copy
import json


def extend_catalog(items, root):
    source = json.loads((root / 'fallout2-ammo-source.json').read_text())
    extra_ids = {entry['item']['id'] for entry in source['items']}
    result = [copy.deepcopy(item) for item in items if item['id'] not in extra_ids]
    known_ids = {item['id'] for item in result}
    for entry in source['items']:
        item = entry['item']
        assert item['id'] not in known_ids, item['id']
        assert item['image'].startswith(('data:image/png;base64,', 'data:image/webp;base64,')), item['name']
        result.append(copy.deepcopy(item))
        known_ids.add(item['id'])
    caps = source['bottleCaps']
    cap_item = next(item for item in result if item['id'] == caps['id'])
    for key in ['category', 'categoryLabel', 'consumable', 'image']:
        cap_item[key] = caps[key]
    cap_item['description'] = 'Крышки от бутылок: валюта кампании и материал для рецептов. Курс обмена определяет мастер.'
    cap_item['rulesVersion'] = 3
    cap_item['source'] = {**cap_item.get('source', {}), 'label': 'Правила игры / Fallout 2', 'url': caps['reference']['sourceUrl']}
    return result


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    catalog_path = root / 'worker/item-catalog.js'
    prefix = 'export const ITEM_CATALOG = '
    separator = ';\nexport const REWARD_ALIASES = '
    raw, aliases = catalog_path.read_text()[len(prefix):].split(separator, 1)
    from equipment_art import apply_equipment_art
    items = apply_equipment_art(extend_catalog(json.loads(raw), root), root)
    from olympus_catalog import extend_catalog as extend_olympus_catalog
    items = extend_olympus_catalog(items, root)
    encoded = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
    catalog_path.write_text(prefix + encoded + separator + aliases)
    gm = root.parent / 'niti-storydesk/dist/item-catalog.js'
    gm.write_text('window.NITI_ITEM_CATALOG = ' + encoded + ';\n')
    print(json.dumps({'catalog': len(items), 'ammo': sum(item['category'] == 'ammo' for item in items), 'caps': 'book-afb8a1f7ce1a'}))
