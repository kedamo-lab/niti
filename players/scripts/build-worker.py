from pathlib import Path
import json, shutil, subprocess, re, base64, sys

root = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(root/'build-offline.py')], cwd=root, check=True)
files = [
    'player-ticker.js','player-squad.js','player-squad.css','storydesk-design.css','storydesk-design.js','brand-mark.svg','equipment-rules.js',
    'index.html', 'player-app.js', 'player-session.js', 'player-session.css',
    'player-audio.js', 'player-audio.css', 'navigation-motion.js', 'navigation-motion.css', 'equipment-art.js',
    'rules-character.js', 'player-sheet.js', 'player-sheet.css', 'player-inventory.js', 'player-inventory.css',
    'player.css', 'style.css', 'fallout.css', 'palette.css', 'terminal.js',
    'dice.js', 'dice.css', 'vault-art.svg', 'niti-player-offline.html',
    'crimson.css', 'player-editorial.css', 'assets/power-armor-crimson.webp', 'assets/wasteland-seal.svg',
    'fonts/oswald-cyrillic.woff2', 'fonts/oswald-latin.woff2', 'fonts/OFL-Oswald.txt',
]
types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.txt':'text/plain', '.webp':'image/webp', '.woff2':'font/woff2'}
assets = {}
for name in files:
    path = root/'web'/name
    if path.suffix in ['.webp', '.woff2']:
        assets[name] = {'type':types[path.suffix], 'body':base64.b64encode(path.read_bytes()).decode(), 'encoding':'base64'}
    else:
        assets[name] = {'type':types[path.suffix]+'; charset=utf-8', 'body':path.read_text()}
asset_module = 'const assets = '+json.dumps(assets, ensure_ascii=False, separators=(',',':'))+';\n'
(root/'worker/assets.js').write_text('export '+asset_module)
modules = []
for name in ['equipment-rules.js','item-catalog.js', 'legacy-item-stats.js', 'inventory.js', 'api.js']:
    module = (root/'worker'/name).read_text()
    module = re.sub(r"(?m)^import[\s\S]*?from ['\"][^'\"]+['\"];?\n", '', module)
    modules.append(module)
api = '\n'.join(modules)
entry = (root/'worker/index.js').read_text()
entry = entry.replace("import { handleApi } from './api.js';\n", '').replace("import { assets } from './assets.js';\n", '')
dist = root/'dist'
if dist.exists(): shutil.rmtree(dist)
(dist/'server').mkdir(parents=True)
(dist/'.openai').mkdir()
shutil.copy2(root/'.openai/hosting.json', dist/'.openai/hosting.json')
(dist/'server/index.js').write_text(api+'\n'+asset_module+'\n'+entry)
print('Built isolated player Worker with '+str(len(files))+' whitelisted assets.')
