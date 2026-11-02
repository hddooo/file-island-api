#!/usr/bin/env python3
"""Explicit, source-render-reviewed section boundaries. Never classify by stars or sentence vocabulary."""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'private-textbook-semantic-data'
FULL=[10,13,19,22,25,34,45,52,60,66,67,74,75,95,97,109,110,116,117,125,127,129,133]
# Inclusive source block index ranges, after the four missing vector headings are restored.
MIXED={11:(7,8),26:(6,13),33:(2,4),37:(1,3),42:(2,4),43:(4,6),44:(4,6),46:(5,7),47:(4,6),86:(9,10),88:(5,7),89:(1,2),90:(2,4),94:(2,4),108:(3,5),130:(5,7),131:(1,3),132:(2,4)}
# Source headings are vector outlines absent from native extraction; exact wording is already transcribed on adjacent pages.
RESTORE={19:('p019-reviewed-main-table',[232,112,376,129]),22:('p022-reviewed-main-table',[228,112,376,129]),25:('p025-reviewed-main-table',[232,118,376,135]),26:('p026-outside-22',[232,610,376,627])}
def digest(x):return hashlib.sha256(json.dumps(x,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def clean(b):return {k:v for k,v in b.items() if k!='studySection'}
def apply():
 report={'schemaVersion':'hanq-source-section-audit/1','sourceSha256':'35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442','method':'explicit PDF heading/table boundaries, full source contact sheets visually inspected; no star/keyword sentence extraction','fullExamPages':FULL,'mixedPageRanges':MIXED,'continuations':{'34':'continuation of PDF33 callout table; no fabricated repeated heading'},'specialBoundaries':{'37':'exam callout ends before original blank exercise section','89':'top exam table only; lower concept table remains concept','130':'side figure groups stored after callout remain concept, based on source coordinates','131':'top exam table only; lower concept heading/table remains concept'},'restoredSourceVectorHeadings':list(RESTORE),'pages':[]}
 manifest=json.loads((DATA/'manifest.json').read_text());entries={p['pdfPage']:p for p in manifest['pages']}
 for f in sorted((DATA/'pages').glob('page-*.json')):
  p=json.loads(f.read_text());n=p['pdfPage'];before={b['id']:digest(clean(b)) for b in p['blocks']};added=[]
  if n in RESTORE:
   target,bbox=RESTORE[n];id=f'p{n:03}-visual-heading-callout'
   if not any(b['id']==id for b in p['blocks']):
    template={'id':id,'type':'heading','level':2,'bbox':bbox,'lines':[{'spans':[{'text':'시험에는 이렇게 나온다!','bold':True}]}],'reviewStatus':'verified','verification':{'scope':'original vector heading wording and source section boundary','method':'original PDF page visually inspected'}}
    i=next(i for i,b in enumerate(p['blocks']) if b['id']==target);p['blocks'].insert(i,template);added.append(id)
  exam=set(range(len(p['blocks']))) if n in FULL else set(range(MIXED[n][0],MIXED[n][1]+1)) if n in MIXED else set()
  if n in MIXED:assert max(exam)<len(p['blocks'])
  for i,b in enumerate(p['blocks']):b['studySection']='exam' if i in exam else 'concept'
  parts={kind:[b['id'] for b in p['blocks'] if b['studySection']==kind] for kind in ['concept','exam']}
  assert not set(parts['concept'])&set(parts['exam']);assert len(parts['concept'])+len(parts['exam'])==len(p['blocks'])
  for b in p['blocks']:
   if b['id'] in before:assert digest(clean(b))==before[b['id']],(n,b['id'],'source changed')
  p['studySectionPartition']={'schemaVersion':'hanq-study-sections/1','sourceBoundaryReviewed':True,'conceptBlockIds':parts['concept'],'examBlockIds':parts['exam']}
  entries[n]['studySectionCounts']={k:len(v) for k,v in parts.items()}
  if parts['exam']:entries[n]['examSectionAvailable']=True
  report['pages'].append({'pdfPage':n,'conceptBlockIds':parts['concept'],'examBlockIds':parts['exam'],'existingSourceBlocksUnchanged':True,'restoredHeadingIds':added})
  f.write_text(json.dumps(p,ensure_ascii=False,separators=(',',':'))+'\n')
 manifest['studySectionSchemaVersion']='hanq-study-sections/1';(DATA/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
 report['summary']={'semanticPages':len(report['pages']),'examPages':sum(bool(p['examBlockIds']) for p in report['pages']),'conceptPages':sum(bool(p['conceptBlockIds']) for p in report['pages']),'examBlocks':sum(len(p['examBlockIds']) for p in report['pages']),'allExistingBlocksConserved':True,'overlap':0}
 (ROOT/'docs/textbook-exam-section-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']))
if __name__=='__main__':apply()
