"""Bundle verified original inventory sprites; never choose representative art.

Reproduce extraction with extract-olympus-sprites.py from the public Olympus1.2
resources identified by this manifest's installer checksums, then import here.
"""
from pathlib import Path
import argparse,base64,hashlib,json


def import_art(manifest_path,provenance_path,root):
    manifest_path=Path(manifest_path);manifest=json.loads(manifest_path.read_text())
    source=json.loads(Path(provenance_path).read_text())
    included=json.loads((root/'olympus-catalog-source.json').read_text())['included']
    expected={x['pid'] for x in included}
    if manifest.get('errors') or manifest['converted']!=len(expected):raise ValueError('Incomplete native sprites')
    entries=manifest['items']
    if {x['pid'] for x in entries}!=expected or len(entries)!=len(expected):raise ValueError('Native PID mapping mismatch')
    images={}
    for item in entries:
        raw=(manifest_path.parent/item['image']).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=item['imageSha256']:raise ValueError('Sprite checksum mismatch')
        if item['artType']!=7 or not item['frmPath'].startswith('art/inven/'):raise ValueError('Not inventory artwork')
        metadata={k:item[k] for k in ['pid','inventoryFid','inventoryIndex','protoPath','frmPath','frmSha256','protoSha256','imageSha256','frame','nativeBlank']}
        metadata['resourceArchive']=Path(item['resourceArchive']).name
        metadata['protoArchive']=Path(item['protoArchive']).name
        images[item['catalogId']]={'image':'data:image/png;base64,'+base64.b64encode(raw).decode(),'metadata':metadata}
    archive={k:source[k] for k in ['game','version','filename','sourceUrl','sourceAuthor','retrievedAt','bytes','md5','sha256']}
    result={'version':1,'game':'Olympus 2207','source':archive,'conversion':manifest['conversion'],'palettePath':manifest['palettePath'],'paletteSha256':manifest['paletteSha256'],'images':images}
    (root/'olympus-art-source.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'nativeImages':len(images),'uniquePngs':len({x['metadata']['imageSha256'] for x in images.values()}),'pngBytes':sum(len(base64.b64decode(x['image'].split(',')[1]))for x in images.values())}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',required=True);parser.add_argument('--provenance',required=True);args=parser.parse_args()
    import_art(args.manifest,args.provenance,Path(__file__).resolve().parent.parent)
