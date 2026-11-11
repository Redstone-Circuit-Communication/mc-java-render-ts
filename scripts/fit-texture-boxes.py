"""Recover cuboid sizes and texture offsets from an entity texture.

A Minecraft cuboid (w, h, d at texOffs u, v) unwraps into six face rectangles forming one fixed
cross, so the opaque pixels of a texture can be covered exactly by such crosses. This searches for
that cover and prints every solution, fewest boxes first. Faces with transparent holes (translucent
or porous textures) do not cover exactly; use the opaque bounding box instead (2(w+d) x (h+d)).

It recovers sizes and UV offsets only. Where a box sits is not in the texture.

Run: python3 scripts/fit-texture-boxes.py <texture.png> [seconds]
Needs: pillow, numpy
Used for: cushion (one 16x4x16 box), sulfur_cube, copper_golem (nine boxes, unique cover).
"""
import sys, time
import numpy as np
from PIL import Image

def faces(w,h,d,u,v):
    return {"top":(u+d,v,u+d+w,v+d), "bottom":(u+d+w,v,u+d+2*w,v+d),
            "left":(u,v+d,u+d,v+d+h), "front":(u+d,v+d,u+d+w,v+d+h),
            "right":(u+d+w,v+d,u+2*d+w,v+d+h), "back":(u+2*d+w,v+d,u+2*d+2*w,v+d+h)}

def footprint_mask(shape, w,h,d,u,v):
    m = np.zeros(shape, bool)
    for (x0,y0,x1,y1) in faces(w,h,d,u,v).values():
        if x1>x0 and y1>y0: m[y0:y1, x0:x1] = True
    return m

def inside(shape, w,h,d,u,v):
    H,W = shape
    return u>=0 and v>=0 and u+2*d+2*w<=W and v+d+h<=H

def solve(A, limit_s=20, max_sol=6, min_dim=1):
    H,W = A.shape
    sols=[]; t0=time.time(); nodes=[0]
    def integral(M):
        return np.pad(M.astype(np.int32).cumsum(0).cumsum(1),((1,0),(1,0)))
    def full(I, x0,y0,x1,y1):
        if x1<=x0 or y1<=y0: return True
        if x0<0 or y0<0 or x1>W or y1>H: return False
        return I[y1,x1]-I[y0,x1]-I[y1,x0]+I[y0,x0] == (x1-x0)*(y1-y0)
    def rec(R, boxes):
        if len(sols)>=max_sol or time.time()-t0>limit_s: return
        nodes[0]+=1
        ys,xs = np.nonzero(R)
        if len(xs)==0: sols.append(list(boxes)); return
        order = np.lexsort((xs,ys)); y=int(ys[order[0]]); x=int(xs[order[0]])
        I = integral(R)
        # run length of remaining opaque on this row
        run=0
        while x+run<W and R[y,x+run]: run+=1
        cands=[]
        for d in range(1,min(17,x+1)):
            u=x-d; v=y
            for w in range(min(run,32),0,-1):
                # top face fully remaining?
                if not full(I,x,y,x+w,y+d): continue
                # bottom face (u+d+w ..) must also fit in remaining opaque
                if not full(I,x+w,y,x+2*w,y+d): continue
                for h in range(1,48):
                    if v+d+h>H: break
                    f = faces(w,h,d,u,v)
                    if all(full(I,*r) for r in f.values()):
                        cands.append((w,h,d,u,v))
                    else:
                        # larger h can only fail more on side faces
                        if h>1: break
        # prefer larger footprints first
        cands.sort(key=lambda c: -int(footprint_mask(A.shape,*c).sum()))
        for c in cands:
            fm = footprint_mask(A.shape,*c)
            R2 = R & ~fm
            rec(R2, boxes+[c])
    rec(A.copy(), [])
    sols.sort(key=len)
    return sols, nodes[0], time.time()-t0

def load(p):
    return np.array(Image.open(p).convert("RGBA"))[...,3]>0

if __name__=="__main__":
    p=sys.argv[1]; A=load(p); print(p, A.shape, "opaque", int(A.sum()))
    sols,n,t = solve(A, limit_s=float(sys.argv[2]) if len(sys.argv)>2 else 20)
    print(f"{len(sols)} exact cover(s), {n} nodes, {t:.1f}s")
    for i,s in enumerate(sols[:4]):
        print(f" solution {i}: {len(s)} boxes  (w,h,d,u,v)")
        for c in s: print("    ", c)
