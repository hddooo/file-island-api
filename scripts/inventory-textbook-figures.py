"""Audit all 144 PDF pages and source image placements, without exporting images.
Requires PyMuPDF. Pass the approved original PDF as argument. Output is structural
coverage, never a declaration of complete visual or textual fidelity.
"""
import pathlib,json,sys,pymupdf,hashlib
source=pathlib.Path(sys.argv[1])
expected='35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442'
assert hashlib.sha256(source.read_bytes()).hexdigest()==expected,'Wrong source PDF'
doc=pymupdf.open(source);assert len(doc)==144
base=pathlib.Path(__file__).resolve().parents[1]
import collections,hashlib
root=base/'private-textbook-semantic-data';m=json.loads((root/'manifest.json').read_text());available={f['id']:f for f in m['figures']};rows=[];pages=[]
for n,p in enumerate(doc,1):
 path=root/f'pages/page-{n:03}.json';d=json.loads(path.read_text()) if path.exists() else None;figures={}
 def walk(v):
  if isinstance(v,dict):
   if v.get('type')=='figure':figures[v['assetId']]=v
   for x in v.values():walk(x)
  elif isinstance(v,list):
   for x in v:walk(x)
 if d:walk(d)
 for inv in d.get('imageInventory',[]) if d else []:
  aid=inv['assetId'];f=figures.get(aid,{});cls=f.get('classification',inv.get('classification',''));status='pending-semantic-transcription-or-classification'
  if aid in available:status='connected-source-asset'
  elif inv.get('presentationStatus')=='semantic-transcription-reviewed':status='semantic-transcription-reviewed'
  elif aid in {'p009-figure-5','p009-figure-6'}:status='held-user-approval'
  elif aid=='p009-figure-4':status='held-atomic-group-with-p009-figure-5'
  elif 'cover' in cls:status='excluded-page-raster'
  elif 'decorative' in cls:status='excluded-decorative'
  elif inv.get('pageAreaRatio',0)<.02 and len([b for b in p.get_text('dict')['blocks'] if b['type']==1 and hashlib.sha256(b['image']).hexdigest()==inv['sha256']])==1:
   # Classification remains explicitly pending unless reviewed in the connected data.
   pass
  sourceMatch=any(b['type']==1 and hashlib.sha256(b['image']).hexdigest()==inv['sha256'] for b in p.get_text('dict')['blocks'])
  assert sourceMatch,('Unmatched source image',aid)
  row=dict(sourceHashMatched=sourceMatch,id=aid,pdfPage=n,classification=cls,status=status,sourceSha256=inv['sha256'],sourceBbox=inv['sourceBbox']);rows.append(row)
 q=[q['id'] for q in m['quizzes'] if n in q.get('pdfPages',[])]
 pages.append(dict(pdfPage=n,semanticBody=bool(d),pageRole=d.get('pageRole','body-or-appendix') if d else 'exercise' if q else 'unrepresented',quizIds=q,sourceNativeChars=len(p.get_text()),semanticTables=sum(b['type']=='table' for b in d['blocks']) if d else 0,figurePlacements=len(figures),connectedFigures=sum(a in available for a in figures),remainingFigures=[r['id'] for r in rows if r['pdfPage']==n and r['status'].startswith(('pending','held'))],diagramTranscriptionCount=len(d.get('diagramTranscriptions',[])) if d else 0,visualFidelity='source-comparison-in-progress'))
report=dict(sourceSha256=m['source']['sha256'],counts=dict(collections.Counter(r['status'] for r in rows)),figures=rows)
(base/'docs/textbook-figure-inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(base/'docs/textbook-page-coverage.json').write_text(json.dumps(dict(sourceSha256=m['source']['sha256'],scope='structural inventory; native text/table/full-page fidelity remains subject to source comparison',pages=pages),ensure_ascii=False,indent=2)+'\n')
print(report['counts'])
