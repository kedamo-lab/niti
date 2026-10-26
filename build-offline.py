from pathlib import Path
import base64
root=Path(__file__).resolve().parent/'web'
html=(root/'index.html').read_text().replace('<html lang="ru">','<html lang="ru" data-offline="true">')
for filename in ['style.css','fallout.css','palette.css','dice.css','player.css','player-session.css','player-sheet.css','player-inventory.css']:
    html=html.replace('<link rel="stylesheet" href="'+filename+'">','<style>'+(root/filename).read_text()+'</style>')
for filename in ['terminal.js','dice.js','player-session.js','player-sheet.js','player-inventory.js','player-app.js']:
    js=(root/filename).read_text().replace('</script','<\\/script')
    html=html.replace('<script src="'+filename+'"></script>','<script>'+js+'</script>')
html=html.replace('src="vault-art.svg"','src="data:image/svg+xml;base64,'+base64.b64encode((root/'vault-art.svg').read_bytes()).decode()+'"')
html=html.replace('<a class="text-button" href="niti-player-offline.html" download>↙ Терминал без интернета</a>','')
html=html.replace('<a href="niti-player-offline.html" download class="button ghost">↙ Скачать офлайн-версию</a>','')
(root/'niti-player-offline.html').write_text(html)
print('Standalone player terminal built.')
