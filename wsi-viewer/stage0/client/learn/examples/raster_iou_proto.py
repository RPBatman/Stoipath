# Prototype of LEARN.md §6.3.3 raster IoU (reference numbers for the spec's worked examples; not product code).
import json, math, sys
mpp=0.243094
d=json.load(open('/home/user/Stoipath/wsi-viewer/stage0/data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson'))
F={f['id']:f for f in d['features']}
R1=F['f5049586-cbdd-54a7-a198-8aadd4f15d8a']['geometry']['coordinates']
holes=[f['geometry']['coordinates'] for f in d['features'] if f['properties']['classification']['name']=='Exclusion']
def polys(g):
    return [g] if isinstance(g[0][0][0],(int,float)) else g
def bbox_rings(rings):
    xs=[p[0] for r in rings for p in r]; ys=[p[1] for r in rings for p in r]
    return min(xs),min(ys),max(xs),max(ys)
def row_spans(poly_list, y):
    # even-odd per polygon (all its rings), union across polygons
    spans=[]
    for rings in poly_list:
        xs=[]
        for r in rings:
            for i in range(len(r)-1):
                (x1,y1),(x2,y2)=r[i],r[i+1]
                if (y1>y)!=(y2>y):
                    xs.append(x1+(y-y1)*(x2-x1)/(y2-y1))
        xs.sort()
        spans+= [(xs[i],xs[i+1]) for i in range(0,len(xs)-1,2)]
    spans.sort(); out=[]
    for a,b in spans:
        if out and a<=out[-1][1]: out[-1]=(out[-1][0],max(out[-1][1],b))
        else: out.append((a,b))
    return out
def minus(A,B):
    out=[]
    for a0,a1 in A:
        segs=[(a0,a1)]
        for b0,b1 in B:
            nxt=[]
            for s0,s1 in segs:
                if b1<=s0 or b0>=s1: nxt.append((s0,s1)); continue
                if b0>s0: nxt.append((s0,b0))
                if b1<s1: nxt.append((b1,s1))
            segs=nxt
        out+=segs
    return out
def inter(A,B):
    out=[];i=j=0
    while i<len(A) and j<len(B):
        lo=max(A[i][0],B[j][0]); hi=min(A[i][1],B[j][1])
        if lo<hi: out.append((lo,hi))
        if A[i][1]<B[j][1]: i+=1
        else: j+=1
    return out
def count(spans,x0,cell):
    n=0
    for a,b in spans:
        # centres x0+(k+.5)cell in [a,b)
        k0=math.ceil((a-x0)/cell-0.5); k1=math.ceil((b-x0)/cell-0.5)
        n+=max(0,k1-k0)
    return n
def iou(mark, include, subtract, maxCells=2048):
    allr=[r for p in mark for r in p]+[r for p in include for r in p]
    x0,y0,x1,y1=bbox_rings(allr)
    cell=max(max(x1-x0,y1-y0)/maxCells, 0.25)
    rows=math.ceil((y1-y0)/cell)
    a=b=i=0
    for r in range(rows):
        y=y0+(r+0.5)*cell
        M=row_spans(mark,y); K=minus(row_spans(include,y), row_spans(subtract,y))
        a+=count(M,x0,cell); b+=count(K,x0,cell); i+=count(inter(M,K),x0,cell)
    c2=cell*cell
    return i/(a+b-i) if a+b-i else 0, a*c2*mpp*mpp/1e6, b*c2*mpp*mpp/1e6, i*c2*mpp*mpp/1e6, cell
include=[R1]; subtract=[h for h in holes]
x0,y0,x1,y1=bbox_rings(R1)
rect=[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]
print('rect=bbox(R1):', iou([rect],include,subtract))
cx,cy=(x0+x1)/2,(y0+y1)/2; rx,ry=(x1-x0)/2,(y1-y0)/2
ell=[[[cx+rx*math.cos(2*math.pi*k/64), cy+ry*math.sin(2*math.pi*k/64)] for k in range(65)]]
print('ellipse inscribed in bbox:', iou([ell],include,subtract))
# small square 1 mm side inside the deposit centred on candidate C
s=1000/mpp/2; C=(7168,5120)
sq=[[[C[0]-s,C[1]-s],[C[0]+s,C[1]-s],[C[0]+s,C[1]+s],[C[0]-s,C[1]+s],[C[0]-s,C[1]-s]]]
print('1 mm square at C:', iou([sq],include,subtract))
# exact check: unit squares
A=[[[0,0],[100,0],[100,100],[0,100],[0,0]]]; B=[[[50,0],[150,0],[150,100],[50,100],[50,0]]]
mpp_save=mpp
print('squares half overlap expect 1/3:', iou([A],[B],[]))
