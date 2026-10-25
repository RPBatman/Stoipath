// C05: createImageBitmap decode of 20 real 512^2 JPEG tiles (q85 4:4:4), 20-way parallel, 7 trials, plus serial per-tile; headless Chromium x86.
import { chromium } from 'playwright'; import fs from 'node:fs'; import { execSync } from 'node:child_process';
const ROOT='/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan';
const man=JSON.parse(fs.readFileSync(`${ROOT}/verify/artifacts/common/tiles/manifest.json`));
const tiles=man.tiles.slice(0,20).map(t=>fs.readFileSync(`${ROOT}/verify/artifacts/common/tiles/${t.id}_q85_444.jpg`).toString('base64'));
const env=()=>({uptime:execSync('uptime').toString().trim(),nproc:execSync('nproc').toString().trim()});
const browser=await chromium.launch({headless:true,channel:'chromium',args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage(); await page.setContent('<!doctype html><body>x');
const r=await page.evaluate(async (tiles)=>{
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
  const blobs=tiles.map(b64=>new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/jpeg'}));
  const par=[],ser=[];
  for(let t=0;t<7;t++){const a=performance.now();const bms=await Promise.all(blobs.map(b=>createImageBitmap(b,{colorSpaceConversion:'none',premultiplyAlpha:'none'})));par.push(performance.now()-a);bms.forEach(b=>b.close());}
  for(let t=0;t<7;t++){let tot=0;for(const b of blobs){const a=performance.now();const bm=await createImageBitmap(b,{colorSpaceConversion:'none',premultiplyAlpha:'none'});tot+=performance.now()-a;bm.close();}ser.push(tot);}
  return {parallel20_ms:par,parallel20_ms_median:med(par),serial20_sum_ms:ser,serial20_sum_ms_median:med(ser),hw:navigator.hardwareConcurrency,bytes:blobs.reduce((a,b)=>a+b.size,0)};
},tiles);
const out={env:env(),...r}; await browser.close(); fs.writeFileSync('decode_recheck.json',JSON.stringify(out,null,1)); console.log(JSON.stringify(out));
