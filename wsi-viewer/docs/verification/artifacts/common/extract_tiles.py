"""Extract 24 real tissue tiles (512^2) from CAMELYON16 tumor_014.tif level 1 (20x-equivalent), decode the vendor
JPEG, and re-encode with libjpeg-turbo at q75 4:2:0 (moving tier), q85 4:4:4 and q90 4:4:4 (settle tiers).
Tiles are chosen so that the q85 4:4:4 size is close to the plan's ~80 KB/tile assumption (tissue, not glass).
Outputs: tiles/t{NN}_q75_420.jpg, t{NN}_q85_444.jpg, t{NN}_q90_444.jpg, t{NN}_rgb.bin (raw 512x512x3) and manifest.json"""
import json, os, sys, time, numpy as np, tifffile, imagecodecs
ROOT='/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan'
OUT=f'{ROOT}/verify/artifacts/common/tiles'
N=24
with tifffile.TiffFile(f'{ROOT}/stage0-dl/full/tumor_014.tif') as tf:
    page=tf.series[0].levels[1].pages[0]
    tables=page.jpegtables
    counts=np.array(page.databytecounts); offs=np.array(page.dataoffsets)
    # candidate tiles: vendor bytes in the 70th-95th percentile of non-empty tiles (dense tissue)
    nz=counts[counts>2000]
    lo,hi=np.percentile(nz,70),np.percentile(nz,95)
    idx=np.where((counts>=lo)&(counts<=hi))[0]
    rng=np.random.default_rng(14); pick=rng.choice(idx,size=N*3,replace=False)
    fh=tf.filehandle
    man=[]
    for i in pick:
        fh.seek(int(offs[i])); data=fh.read(int(counts[i]))
        rgb=imagecodecs.jpeg8_decode(data, tables=tables)
        if rgb.shape!=(512,512,3): continue
        b85=imagecodecs.jpeg8_encode(rgb, level=85, subsampling='444')
        b90=imagecodecs.jpeg8_encode(rgb, level=90, subsampling='444')
        b75=imagecodecs.jpeg8_encode(rgb, level=75, subsampling='420')
        man.append({"tile_index":int(i),"vendor_bytes":int(counts[i]),"q75_420":len(b75),"q85_444":len(b85),"q90_444":len(b90),"std":float(rgb.astype(np.float32).std()),"_b":(b75,b85,b90,rgb)})
    # take the N tiles whose q85 size is closest to 80 KB
    man.sort(key=lambda m: abs(m["q85_444"]-80000)); man=man[:N]
    for k,m in enumerate(man):
        b75,b85,b90,rgb=m.pop("_b")
        open(f'{OUT}/t{k:02d}_q75_420.jpg','wb').write(b75); open(f'{OUT}/t{k:02d}_q85_444.jpg','wb').write(b85); open(f'{OUT}/t{k:02d}_q90_444.jpg','wb').write(b90)
        rgb.tofile(f'{OUT}/t{k:02d}_rgb.bin'); m["id"]=f't{k:02d}'
    tot={q:sum(m[q] for m in man[:20]) for q in ("vendor_bytes","q75_420","q85_444","q90_444")}
    tot9={q:sum(m[q] for m in man[:9]) for q in ("q75_420","q85_444","q90_444")}
    json.dump({"tiles":man,"sum_first20":tot,"sum_first9":tot9,"level":1,"level_shape":list(tf.series[0].levels[1].shape)}, open(f'{OUT}/manifest.json','w'), indent=1)
    print("20-tile sums (bytes):",tot); print("9-tile sums:",tot9)
    print("per-tile q85_444 KB:",[round(m["q85_444"]/1e3,1) for m in man[:20]])
