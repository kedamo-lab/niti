from pathlib import Path
import json, shutil, subprocess

root = Path(__file__).resolve().parent.parent
subprocess.run(['python3', str(root/'build-offline.py')], cwd=root, check=True)
files = [
    'index.html', 'player-app.js', 'player-session.js', 'player-session.css',
    'player.css', 'style.css', 'fallout.css', 'palette.css', 'terminal.js',
    'dice.js', 'dice.css', 'vault-art.svg', 'niti-player-offline.html',
]
types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml'}
assets = {name: {'type': types[Path(name).suffix]+'; charset=utf-8', 'body': (root/'web'/name).read_text()} for name in files}
asset_module = 'const assets = '+json.dumps(assets, ensure_ascii=False, separators=(',',':'))+';\n'
(root/'worker/assets.js').write_text('export '+asset_module)
api = (root/'worker/api.js').read_text().replace('export async function handleApi(', 'async function handleApi(')
entry = (root/'worker/index.js').read_text()
entry = entry.replace("import { handleApi } from './api.js';\n", '').replace("import { assets } from './assets.js';\n", '')
dist = root/'dist'
if dist.exists(): shutil.rmtree(dist)
(dist/'server').mkdir(parents=True)
(dist/'.openai').mkdir()
shutil.copy2(root/'.openai/hosting.json', dist/'.openai/hosting.json')
(dist/'server/index.js').write_text(api+'\n'+asset_module+'\n'+entry)
print('Built isolated player Worker with '+str(len(files))+' whitelisted assets.')
