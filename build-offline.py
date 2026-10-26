from pathlib import Path
import re,base64
root=Path(__file__).resolve().parent/'dist'
html=(root/'index.html').read_text()
css=re.sub(r"@import\s+url\([^)]*\)\s*;\s*",'',(root/'style.css').read_text(),count=1)
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
html=html.replace('<link rel="stylesheet" href="module.css">','<style>'+(root/'module.css').read_text()+'</style>')
html=html.replace('<link rel="stylesheet" href="fallout.css">','<style>'+(root/'fallout.css').read_text()+'</style>')
for sheet in ['palette.css','dice.css']:
    html=html.replace('<link rel="stylesheet" href="'+sheet+'">','<style>'+(root/sheet).read_text()+'</style>')
for name in ['dice.js','terminal.js','module-data.js','module-ui.js','prompts.js','app.js']:
    js=(root/name).read_text().replace('</script','<\\/script')
    html=html.replace('<script src="'+name+'"></script>','<script>'+js+'</script>')
html=html.replace('<a class="text-button" href="niti-offline.html" download>↙ Забрать пульт с собой</a>','')
html=html.replace('src="vault-art.svg"', 'src="data:image/svg+xml;base64,'+base64.b64encode((root/'vault-art.svg').read_bytes()).decode()+'"')
(root/'niti-offline.html').write_text(html)
print('Offline notebook built.')
