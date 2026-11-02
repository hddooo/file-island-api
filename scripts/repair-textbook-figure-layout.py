"""Reviewed figure/caption layout corrections only; no quiz or asset changes.
Run against the c701ef2 source bundle once. Source spans are conserved exactly.
"""
import json, copy, collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'private-textbook-semantic-data/pages'
def union(boxes):
 boxes=[b for b in boxes if b]
 return [min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
def spans(v):
 if isinstance(v,dict):
  if 'sourceSpanId' in v:yield (v['sourceSpanId'],v['text'],tuple(v.get('sourceCharIds',[])))
  for x in v.values():yield from spans(x)
 elif isinstance(v,list):
  for x in v:yield from spans(x)
def save(p,d,before):
 assert before==collections.Counter(spans(d)),f'source text loss/duplication: {p}'
 p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
def gallery(d,tid,cols,entries):
 # entries: row, column, rowSpan, figure IDs, native caption block ID.
 lookup={b['id']:b for b in d['blocks']};rows=[dict(id=f'{tid}-r{r}',cells=[]) for r in range(max(e[0]+e[2] for e in entries))];figs=[];groups=[];remove=set()
 for ri,ci,rs,ids,cap in entries:
  caption=lookup[cap];members=[lookup[f'p{d["pdfPage"]:03}-figure-{i}'] for i in ids];cid=f'{tid}-r{ri}-c{ci}';aids=[f['assetId'] for f in members]
  cell=dict(id=cid,rowIndex=ri,columnIndex=ci,rowSpan=rs,colSpan=1,header=False,bbox=union([caption.get('bbox')]+[f['bbox'] for f in members]),lines=copy.deepcopy(caption['lines']),sourceAssociations=[dict(kind='source-figure-caption',startLine=0,endLineExclusive=len(caption['lines']),assetIds=aids,reviewStatus='verified')])
  rows[ri]['cells'].append(cell)
  for f in members:
   f.update(sourceRowIndices=list(range(ri,ri+rs)),sourceColumnIndex=ci,sourceCaptionCellId=cid,associationReviewStatus='source-render-checked')
   f.pop('captionBlockId',None);remove.add(f['id'])
  groups.append(dict(assetIds=aids,relationship='one-source-illustration' if len(ids)==1 else 'vertical-contiguous-fragments-of-one-source-illustration',captionCellId=cid,reviewStatus='verified'))
  figs+=members;remove.add(cap)
 for row in rows:row['cells'].sort(key=lambda c:c['columnIndex'])
 t=dict(id=tid,type='table',layoutRole='source-illustration-gallery',columnCount=cols,rows=rows,figures=figs,figureGroups=groups,bbox=union([c['bbox'] for r in rows for c in r['cells']]),reviewStatus='verified',verification=dict(scope='original figure row/column, native caption association and atomic fragments',method='enlarged original PDF source reviewed; source spans preserved',fullPageEquivalent=False))
 at=min(i for i,b in enumerate(d['blocks']) if b['id'] in remove);d['blocks']=[b for b in d['blocks'] if b['id'] not in remove];d['blocks'].insert(at,t);return t
CONFIG={
76:[(4,[(0,i-1,1,[i],f'p076-outside-48-caption-{i}') for i in range(1,5)])],
77:[(3,[(0,i-1,1,[i],f'p077-outside-31-caption-{i}') for i in range(1,4)]),(3,[(0,i-4,1,[i],f'p077-outside-35-caption-{i-3}') for i in range(4,7)]),(3,[(0,i-7,1,[i],f'p077-outside-39-caption-{i-6}') for i in range(7,10)])],
79:[(3,[(0,0,2,[1],'p079-outside-12-caption-1'),(0,1,1,[2],'p079-outside-10-caption-1'),(0,2,2,[3],'p079-outside-12-caption-3'),(1,1,1,[4],'p079-outside-12-caption-2')]),(3,[(0,0,1,[5],'p079-outside-19-caption-1'),(0,1,2,[6],'p079-outside-21-caption-2'),(0,2,2,[7,8,9,10],'p079-outside-21-caption-3'),(1,0,1,[11],'p079-outside-21-caption-1')]),(3,[(0,i-12,1,[i],f'p079-outside-25-caption-{i-11}') for i in range(12,15)])],
103:[(3,[(0,i-1,1,[i],f'p103-outside-4-caption-{i}') for i in range(1,4)]),(3,[(0,i-4,1,[i],f'p103-outside-8-caption-{i-3}') for i in range(4,7)]),(4,[(0,i-7,1,[i],f'p103-outside-13-caption-{i-6}') for i in range(7,11)])],
128:[(4,[(0,i-1,1,[i],f'p128-outside-37-caption-{i}') for i in range(1,5)])]
}
for n,gs in CONFIG.items():
 p=ROOT/f'page-{n:03}.json';d=json.loads(p.read_text());assert d['sourceSha256']=='35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442';before=collections.Counter(spans(d))
 if any(b['id']==f'p{n:03}-layout-gallery-1' for b in d['blocks']):continue
 for i,(cols,entries) in enumerate(gs,1):gallery(d,f'p{n:03}-layout-gallery-{i}',cols,entries)
 save(p,d,before)
# Add an explicit illustration column for source images sharing several text
# rows. This is a semantic envelope for an overlaid source picture, not a claim
# that the printed page draws a separate vertical table border.
CONFIG2={17:('p017-reviewed-main-table',[(2,3,[4]),(6,2,[3])]),20:('p020-table-1',[(1,2,[2]),(4,2,[1])]),31:('p031-table-1',[(1,6,[1,2]),(9,3,[4,5])]),124:('p124-reviewed-main-table',[(1,3,[5,6]),(4,4,[4])]),130:('p130-reviewed-main-table',[(3,2,[4]),(6,1,[3])])}
LABELS={124:{5:'p124-diagram-3-1',6:'p124-diagram-1-1',4:'p124-diagram-2-1'},130:{4:'p130-diagram-2-1',3:'p130-diagram-1-1'}}
for n,(tid,areas) in CONFIG2.items():
 p=ROOT/f'page-{n:03}.json';d=json.loads(p.read_text());assert d['sourceSha256']=='35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442';before=collections.Counter(spans(d));t=next(b for b in d['blocks'] if b['id']==tid)
 if t.get('layoutRole')=='source-illustrated-table':continue
 lookup={b['id']:b for b in d['blocks']};figs={int(f['assetId'].split('-')[-1]):f for f in t['figures']};oldcols=t['columnCount'];covered={r for start,count,_ in areas for r in range(start,start+count)}
 for ri,row in enumerate(t['rows']):
  if ri not in covered:
   last=row['cells'][-1]
   if last['columnIndex']+(last.get('colSpan') or 1)==oldcols:last['colSpan']=last.get('colSpan',1)+1
 for start,count,ids in areas:
  cid=f'{tid}-illustration-r{start}';members=[figs[i] for i in ids];bbox=union([f['bbox'] for f in members]);lines=[]
  cell=dict(id=cid,rowIndex=start,columnIndex=oldcols,rowSpan=count,colSpan=1,header=False,bbox=bbox,lines=[],sourceIllustrationCell=True,sourceFigureAssetIds=[f['assetId'] for f in members])
  t['rows'][start]['cells'].append(cell)
  for f in members:f.update(sourceRowIndices=list(range(start,start+count)),sourceContentCellId=cid,associationReviewStatus='source-render-checked')
  if n in LABELS:
   # Native label and corresponding photo become a small single-column table
   # inside their original side panel. No labels remain at the page bottom.
   gid=f'p{n:03}-source-side-gallery-r{start}';rows=[];groups=[]
   for ri,i in enumerate(ids):
    f=figs[i];label=lookup[LABELS[n][i]];ccid=f'{gid}-r{ri}-c0';aids=[f['assetId']]
    f.update(sourceRowIndices=[ri],sourceColumnIndex=0,sourceCaptionCellId=ccid);f.pop('sourceContentCellId',None)
    rows.append(dict(id=f'{gid}-r{ri}',cells=[dict(id=ccid,rowIndex=ri,columnIndex=0,rowSpan=1,colSpan=1,header=False,bbox=union([f['bbox'],label.get('bbox')]),sourceTranscriptBlockId=label['id'],lines=copy.deepcopy(label['lines']),sourceAssociations=[dict(kind='source-figure-caption',startLine=0,endLineExclusive=len(label['lines']),assetIds=aids,reviewStatus='verified')])]))
    groups.append(dict(assetIds=aids,relationship='one-source-illustration',captionCellId=ccid,reviewStatus='verified'))
   g=dict(id=gid,type='table',columnCount=1,rows=rows,figures=members,figureGroups=groups,layoutRole='source-illustration-gallery',bbox=bbox,reviewStatus='verified',sourceParentTableId=tid,sourceTargetCellId=cid)
   d['blocks']=[b for b in d['blocks'] if b['id'] not in [LABELS[n][i] for i in ids]];d['blocks'].append(g)
   t['figures']=[f for f in t['figures'] if f not in members];cell.pop('sourceFigureAssetIds')
  else:
   t['figureGroups']=[g for g in t.get('figureGroups',[]) if set(g['assetIds'])!=set(f['assetId'] for f in members)]
   t.setdefault('figureGroups',[]).append(dict(assetIds=[f['assetId'] for f in members],relationship='one-source-illustration' if len(ids)==1 else 'vertical-contiguous-fragments-of-one-source-map',reviewStatus='verified'))
 t['columnCount']=oldcols+1;t['layoutRole']='source-illustrated-table';t['sourceIllustrationColumn']=oldcols;t['geometryBasis']='source overlaid illustration side panel; semantic row envelope, not an extra printed border';t['figures'].sort(key=lambda f:(f['bbox'][1],f['bbox'][0]))
 if n==31:t['sourceColumnWidths']=[16,12,42,30]
 if n==17:
  t['headerRowCount']=1
  for c in t['rows'][0]['cells']:c.update(header=True,scope='colgroup' if c.get('colSpan',1)>1 else 'col',sourceShading='blue')
  label=lookup['p017-diagram-1-1'];label.update(sourceParentTableId=tid,sourceTargetCellId='p017-reviewed-r1-c0',sourcePlacement='after')
 save(p,d,before)
print('Repaired 10 pages; native spans conserved; no quiz/asset mutations')
