"""Native-source loss audit; does not claim OCR or visual-layout certification."""
import collections,hashlib,json,sys
from pathlib import Path
import pymupdf
ROOT=Path(__file__).resolve().parents[1]
expected='35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442'
def texts(v):
 if isinstance(v,dict):
  if 'sourceSpanId' in v:yield v['text']
  for x in v.values():yield from texts(x)
 elif isinstance(v,list):
  for x in v:yield from texts(x)
def counter(s):return collections.Counter(c for c in s if not c.isspace())
def main(source):
 assert hashlib.sha256(Path(source).read_bytes()).hexdigest()==expected
 doc=pymupdf.open(source);manifest=json.loads((ROOT/'private-textbook-semantic-data/manifest.json').read_text());results=[]
 for entry in manifest['pages']:
  n=entry['pdfPage'];data=json.loads((ROOT/f'private-textbook-semantic-data/pages/page-{n:03}.json').read_text());source_chars=''.join(c['c'] for b in doc[n-1].get_text('rawdict')['blocks'] if b['type']==0 for l in b['lines'] for s in l['spans'] for c in s['chars'] if c['bbox'][1]<775)
  missing=counter(source_chars)-counter(''.join(texts(data['blocks'])));assert not missing,(n,missing)
  results.append(dict(pdfPage=n,nativeContentChars=sum(counter(source_chars).values()),nativeCharDeficit=0,rasterWordingReview='explicit transcription metadata' if any(b.get('transcriptionAudit',{}).get('method')=='visual-transcription' for b in data['blocks']) else 'not applicable to this audit'))
 body={p['pdfPage'] for p in manifest['pages']};exercises={p for q in manifest['quizzes'] for p in q['pdfPages']};assert body|exercises==set(range(1,145))
 report=dict(sourceSha256=expected,scope='Native non-whitespace character multisets, including running headers, above y=775 PDF points; repeated page footers/page numbers excluded. Raster text has explicit visual transcriptions and is not certified by this character audit. Order and relationships have separate schema/DOM/source review evidence.',semanticPages=len(body),exerciseSourcePages=len(exercises),allPdfPagesRepresented=True,results=results)
 (ROOT/'docs/textbook-native-source-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(dict(semanticPages=len(body),nativeCharDeficits=0,allPdfPagesRepresented=True)))
if __name__=='__main__':main(sys.argv[1])
