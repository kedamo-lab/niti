"""Apply the retained transparent inventory art without changing item mechanics."""
from pathlib import Path
import copy
import json


def apply_equipment_art(items, root):
    source = json.loads((root / 'equipment-art-source.json').read_text())
    images = source['images']
    result = copy.deepcopy(items)
    for item in result:
        if item['id'] in images:
            image = images[item['id']]
            if not image.startswith(('data:image/png;base64,', 'data:image/webp;base64,')):
                raise ValueError('Unsupported equipment image: ' + item['id'])
            item['image'] = image
    return result


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    target = root / 'worker/item-catalog.js'
    prefix = 'export const ITEM_CATALOG = '
    separator = ';\nexport const REWARD_ALIASES = '
    raw, aliases = target.read_text()[len(prefix):].split(separator, 1)
    items = apply_equipment_art(json.loads(raw), root)
    encoded = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
    target.write_text(prefix + encoded + separator + aliases)
    (root.parent / 'niti-storydesk/dist/item-catalog.js').write_text('window.NITI_ITEM_CATALOG = ' + encoded + ';\n')
    print(json.dumps({'catalog': len(items), 'images': sum(bool(item.get('image')) for item in items)}))
