from pathlib import Path
import re
root=Path(__file__).resolve().parent/'dist'
html=(root/'index.html').read_text()
css=re.sub(r"@import\s+url\([^)]*\)\s*;\s*",'',(root/'style.css').read_text(),count=1)
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
html=html.replace('<link rel="stylesheet" href="module.css">','<style>'+(root/'module.css').read_text()+'</style>')
for name in ['module-data.js','module-ui.js','prompts.js','app.js']:
    js=(root/name).read_text().replace('</script','<\\/script')
    html=html.replace('<script src="'+name+'"></script>','<script>'+js+'</script>')
html=html.replace('<a class="text-button" href="niti-offline.html" download>↙ Забрать пульт с собой</a>','')
(root/'niti-offline.html').write_text(html)
print('Offline notebook built.')
