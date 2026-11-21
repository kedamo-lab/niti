#!/usr/bin/env python3
"""Extract exact Fallout2/Olympus2207 inventory artwork without altering game data.

Format reference: alexbatalov/fallout2-ce src/{dfile,proto,art,color}.cc.
DAT2 uses little-endian metadata; PRO and FRM use big-endian game data.
The transparent game palette index is 0. RGB values are 6bit shifted left 2,
matching the engine, not a guessed/chroma-key background removal.
"""
from __future__ import annotations
import argparse, dataclasses, hashlib, io, json, re, struct, zlib
from pathlib import Path, PurePosixPath
from typing import Iterable
from PIL import Image

class AssetError(ValueError): pass

def asset_key(name: str) -> str:
    value=name.replace('\\','/').strip('/').casefold()
    if not value or '\x00' in value or any(part in {'.','..'} for part in value.split('/')):
        raise AssetError('Unsafe asset path')
    return value

@dataclasses.dataclass(frozen=True)
class DatEntry:
    name: str
    compressed: bool
    unpacked: int
    packed: int
    offset: int

class Dat2:
    def __init__(self,path:Path|str):
        self.path=Path(path); self.entries={}; self.file_size=self.path.stat().st_size
        if self.file_size<12: raise AssetError('DAT footer missing')
        with self.path.open('rb') as f:
            f.seek(-8,2); tree_size,database_size=struct.unpack('<II',f.read(8))
            if tree_size<4 or tree_size>128*1024*1024 or tree_size+8>database_size or database_size>self.file_size:
                raise AssetError('Invalid DAT2 tree/footer')
            self.base=self.file_size-database_size
            self.tree_start=self.file_size-tree_size-8
            f.seek(self.tree_start); tree=f.read(tree_size)
        self.tree_sha256=hashlib.sha256(tree).hexdigest()
        self.database_size=database_size
        view=memoryview(tree); at=0
        def take(n):
            nonlocal at
            if n<0 or at+n>len(view):raise AssetError('Truncated DAT2 table')
            result=view[at:at+n];at+=n;return result
        count=struct.unpack('<I',take(4))[0]
        if count>1000000:raise AssetError('DAT entry count exceeds bound')
        for _ in range(count):
            size=struct.unpack('<I',take(4))[0]
            if size<1 or size>1024:raise AssetError('Invalid DAT path length')
            raw=bytes(take(size));name=asset_key(raw.decode('cp1252'))
            compressed,unpacked,packed,offset=struct.unpack('<BIII',take(13))
            if compressed not in (0,1) or self.base+offset+packed>self.tree_start:
                raise AssetError('DAT entry outside payload region')
            if not compressed and unpacked!=packed:raise AssetError('Uncompressed DAT size mismatch')
            if name in self.entries:raise AssetError('Duplicate DAT path '+name)
            self.entries[name]=DatEntry(name,bool(compressed),unpacked,packed,offset)
        if at!=len(view):raise AssetError('Trailing DAT2 table bytes')
    def read(self,name:str,max_size:int=32*1024*1024)->bytes:
        entry=self.entries[asset_key(name)]
        if entry.unpacked>max_size or entry.packed>max_size:raise AssetError('Requested DAT entry exceeds extraction bound')
        with self.path.open('rb')as f:
            f.seek(self.base+entry.offset);packed=f.read(entry.packed)
        if len(packed)!=entry.packed:raise AssetError('Truncated DAT entry')
        if not entry.compressed:return packed
        decoder=zlib.decompressobj();result=decoder.decompress(packed,entry.unpacked+1)
        if len(result)!=entry.unpacked or not decoder.eof or decoder.unconsumed_tail or decoder.unused_data:
            raise AssetError('DAT decompression length/stream mismatch')
        return result
    def contains(self,name:str):return asset_key(name)in self.entries

class LooseFiles:
    def __init__(self,path:Path|str):
        self.path=Path(path);self.entries={asset_key(str(p.relative_to(self.path))):p for p in self.path.rglob('*')if p.is_file()}
    def read(self,name:str,max_size:int=32*1024*1024)->bytes:
        p=self.entries[asset_key(name)]
        if p.stat().st_size>max_size:raise AssetError('Loose asset exceeds extraction bound')
        return p.read_bytes()
    def contains(self,name:str):return asset_key(name)in self.entries

class ResourceSet:
    """Providers highest precedence first: loosepatches, latest DATpatch, master DAT."""
    def __init__(self,providers:Iterable[Dat2|LooseFiles]):self.providers=list(providers)
    def read(self,name:str,max_size:int=32*1024*1024)->bytes:
        for provider in self.providers:
            if provider.contains(name):return provider.read(name,max_size)
        raise KeyError(name)
    def origin(self,name:str):
        for provider in self.providers:
            if provider.contains(name):return str(provider.path)
        raise KeyError(name)
    def contains(self,name:str):return any(provider.contains(name)for provider in self.providers)

def game_list(raw:bytes)->list[str]:
    # Engine indexes physical lines; comma introduces additional per-file fields.
    lines=raw.decode('cp1251').splitlines()
    return [line.split(',',1)[0].split(';',1)[0].strip().lower()for line in lines]

def read_item_proto(raw:bytes)->dict:
    if len(raw)<57:raise AssetError('Truncated item PRO header')
    values=struct.unpack('>14i',raw[:56])
    pid,message_id,map_fid,light_distance,light_intensity,flags,extended_flags,sid,item_type,material,size,weight,cost,inventory_fid=values
    if (pid>>24)&255:raise AssetError('PRO is not an item')
    return {'pid':pid,'messageId':message_id,'mapFid':map_fid,'itemType':item_type,'weight':weight,'cost':cost,'inventoryFid':inventory_fid,'inventoryIndex':inventory_fid&0xFFF,'artType':(inventory_fid>>24)&0xF}

def read_palette(raw:bytes)->list[tuple[int,int,int,int]]:
    if len(raw)<768:raise AssetError('Truncated game palette')
    palette=[]
    for index in range(256):
        values=raw[3*index:3*index+3]
        # The original loader marks out-of-six-bit-range entries as black.
        rgb=tuple(value*4 for value in values)if max(values)<=63 else (0,0,0)
        palette.append((*rgb,0 if index==0 else 255))
    return palette

def decode_frm(raw:bytes,palette:list[tuple[int,int,int,int]],frame:int=0,direction:int=0)->tuple[Image.Image,dict]:
    if len(raw)<62:raise AssetError('Truncated FRM header')
    version,fps,action,count=struct.unpack('>IHHH',raw[:10]);x_offsets=struct.unpack('>6h',raw[10:22]);y_offsets=struct.unpack('>6h',raw[22:34]);offsets=struct.unpack('>6I',raw[34:58]);data_size=struct.unpack('>I',raw[58:62])[0]
    if version!=4 or count<1 or count>10000 or not 0<=frame<count or not 0<=direction<6:
        raise AssetError('Unsupported FRM header/frame selection')
    if data_size and data_size>len(raw)-62:raise AssetError('FRM declares data beyond file')
    at=62+offsets[direction]
    for i in range(frame+1):
        if at+12>len(raw):raise AssetError('Truncated FRM frame header')
        width,height,size,x,y=struct.unpack('>HHIhh',raw[at:at+12]);at+=12
        if not width or not height or width>4096 or height>4096 or size!=width*height or at+size>len(raw):
            raise AssetError('Invalid FRM image dimensions/payload')
        pixels=raw[at:at+size];at+=size
    rgba=bytearray()
    for value in pixels:rgba.extend(palette[value])
    image=Image.frombytes('RGBA',(width,height),bytes(rgba))
    return image,{'version':version,'fps':fps,'actionFrame':action,'frames':count,'frame':frame,'direction':direction,'width':width,'height':height,'offsetX':x,'offsetY':y,'directionOffsetX':x_offsets[direction],'directionOffsetY':y_offsets[direction],'transparentIndex':0}

def extract_inventory(resources:ResourceSet,pids:Iterable[int],output:Path,palette_path:str='color.pal')->dict:
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    pro_list=game_list(resources.read('proto/items/items.lst'))
    inven_list=game_list(resources.read('art/inven/inven.lst'))
    palette_bytes=resources.read(palette_path);palette=read_palette(palette_bytes)
    items=[];errors=[]
    for pid in pids:
        try:
            if not 1<=pid<=len(pro_list)or not pro_list[pid-1]:raise AssetError('PID absent in PRO list')
            pro_path='proto/items/'+pro_list[pid-1];pro_bytes=resources.read(pro_path);proto=read_item_proto(pro_bytes)
            if proto['pid']!=pid:raise AssetError(f'PID does not match PRO: {pid} != {proto["pid"]}')
            if proto['inventoryFid']<0 or proto['artType']!=7:raise AssetError('Item lacks inventory artwork FID')
            index=proto['inventoryIndex']
            if index>=len(inven_list)or not inven_list[index]:raise AssetError('FID absent in inventory list')
            frm_path='art/inven/'+inven_list[index];frm_bytes=resources.read(frm_path);image,frame=decode_frm(frm_bytes,palette)
            # Original uncropped resolution is retained. Index0 becomes transparent.
            target=output/f'olympus-{pid}.png';image.save(target,optimize=True)
            frame['visiblePixels']=sum(bool(pixel) for pixel in image.getchannel('A').tobytes())
            native_blank=frm_path.rsplit('/',1)[-1].casefold()=='blank.frm'
            frame['nativeBlank']=native_blank
            items.append({'pid':pid,'catalogId':f'olympus-{pid}','image':target.name,**proto,'protoPath':pro_path,'frmPath':frm_path,'resourceArchive':resources.origin(frm_path),'protoArchive':resources.origin(pro_path),'frmSha256':hashlib.sha256(frm_bytes).hexdigest(),'protoSha256':hashlib.sha256(pro_bytes).hexdigest(),'nativeBlank':native_blank,'imageSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'frame':frame})
        except (AssetError,KeyError,OSError)as e:errors.append({'pid':pid,'error':str(e)})
    report={'formatVersion':1,'game':'Olympus 2207','conversion':'Exact original FRM first frame with original game palette; palette index 0 transparent. No replacement art, recoloring, or generated imagery.','palettePath':palette_path,'paletteSha256':hashlib.sha256(palette_bytes).hexdigest(),'requested':len(items)+len(errors),'converted':len(items),'items':items,'errors':errors}
    (output/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dat',action='append',default=[],help='DAT archives in ascending precedence: master first, latest patch last');p.add_argument('--data',action='append',default=[],help='Loose data directories in ascending precedence');p.add_argument('--pids',required=True,help='comma-separated PIDs, or JSON source catalog with included[].pid');p.add_argument('--output',required=True);p.add_argument('--palette',default='color.pal');a=p.parse_args()
    providers=[LooseFiles(path)for path in reversed(a.data)]+[Dat2(path)for path in reversed(a.dat)]
    if Path(a.pids).exists():
        source=json.loads(Path(a.pids).read_text());source=source.get('included',source)if isinstance(source,dict)else source;pids=[int(x['pid']if isinstance(x,dict)else x)for x in source]
    else:pids=[int(x)for x in a.pids.split(',')]
    report=extract_inventory(ResourceSet(providers),pids,Path(a.output),a.palette)
    print(json.dumps({key:report[key]for key in ['game','requested','converted','errors']},ensure_ascii=False))
    if report['errors']:raise SystemExit(1)
if __name__=='__main__':main()
