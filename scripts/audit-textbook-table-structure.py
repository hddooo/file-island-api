import json,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
known={'구분','내용','특징','시대','시기','등급','관등명','공복','골품','진골','6두품','5두품','4두품','페이지','사진','출처'}
def txt(c):return ''.join(s.get('renderText',s['text']) if s.get('mappingAudit',{}).get('verified') else s['text'] for l in c['lines'] for s in l['spans']).strip()
records=[];candidates=[]
for p in sorted((ROOT/'private-textbook-semantic-data/pages').glob('*.json')):
 d=json.load(open(p))
 for b in d['blocks']:
  if b['type']!='table':continue
  late=[];noheader=[];ys=[]
  for ri,row in enumerate(b['rows']):
   for c in row['cells']:
    t=''.join(txt(c).split())
    if ri>1 and t in known and (c.get('header') or b.get('layoutRole')=='source-rank-chart'):late.append({'row':ri,'text':txt(c),'column':c['columnIndex']})
   boxes=[c['bbox'] for c in row['cells'] if c.get('bbox') and not c.get('sourceIllustrationCell')]
   if boxes:ys.append((ri,min(x[1] for x in boxes)))
  nonempty=[c for c in b['rows'][0]['cells'] if txt(c)]
  if nonempty and len(nonempty)>=2 and all(''.join(txt(c).split()) in known for c in nonempty):
   noheader=[c['id'] for c in nonempty if not c.get('header')]
  reversedRows=[{'previousRow':ys[i-1][0],'row':ys[i][0],'previousY':ys[i-1][1],'y':ys[i][1]} for i in range(1,len(ys)) if ys[i][1]+1<ys[i-1][1]]
  r=dict(pdfPage=d['pdfPage'],blockId=b['id'],role=b.get('layoutRole','native-table'),rows=len(b['rows']),columns=b['columnCount'],lateGenericHeaders=late,missingColumnHeaderFlags=noheader,reversedNativeRowCoordinates=reversedRows,rangeBarCount=sum(bool(c.get('sourceRangeBar')) for row in b['rows'] for c in row['cells']))
  records.append(r)
  if late or noheader or reversedRows:candidates.append(r)
report=dict(reviewedCandidates=[dict(pdfPage=11,blockId='p011-table-1',resolution='특징 is an original left row label, not a misplaced column heading'),dict(pdfPage=32,blockId='p032-table-2',resolution='6두품 is an original left row label, not the bone-rank chart header')],confirmedFixes=[dict(pdfPage=5,issue='column header semantics and source blue shading'),dict(pdfPage=17,issue='column header semantics and source blue shading'),dict(pdfPage=23,issue='explicit single-row seven-column header and copy-safe column semantics; original robe and eligibility merged ranges restored')],scope='structural scan of current104 semantic pages; generic column labels, source-y order, header metadata and range bars. Does not certify all text or every visual merge.',tables=len(records),pages=104,candidates=candidates,records=records)
(ROOT/'docs/textbook-table-structure-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'tables':len(records),'rangeCharts':[(r['pdfPage'],r['blockId']) for r in records if r['rangeBarCount']],'candidates':candidates},ensure_ascii=False,indent=2))
