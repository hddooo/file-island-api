"""Reviewed raster-text transcriptions. No source bitmap is published by this script.
Run on the approved semantic bundle. Original native spans remain untouched.
"""
import copy,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'private-textbook-semantic-data'
RECORDS=[]
def C(text='',**kw):return dict(text=text,**kw)
def T(rows,kind='source-diagram'):return dict(rows=rows,kind=kind)
def record(page,ids,panels,relations=None):RECORDS.append(dict(pdfPage=page,assetIds=[f'p{page:03}-figure-{i}' for i in ids],panels=panels,relations=relations or []))
def line(text):
 parts=re.split(r'(\*\*.*?\*\*)',text)
 return dict(spans=[dict(text=x[2:-2] if x.startswith('**') else x,bold=x.startswith('**'),sourceRasterText=True) for x in parts if x])
def cell_lines(text):return [line(x) for x in text.split('\n')]
def timeline(page,ids,phases,events):
 # Rows preserve the original band labels and event order. Boundary events are
 # retained explicitly with their source positions in the audit metadata.
 record(page,ids,[T([[C(p[0],colSpan=p[1],header=True,shade=['yellow','green','blue'][i%3]) for i,p in enumerate(phases)],[C(x) for x in events]],'source-timeline')])
record(17,[1],[dict(text='전성기 이전이구나~\n정도만 알자',kind='text')])
timeline(17,[2],[('**전성기 이전**',3),('**전성기**',2),('**수·당 전쟁**',3)],['관구검\n공격','낙랑군\n축출','소수림왕','광개토왕','장수왕','수\n살수대첩','연개소문\n정변','안시성\n전투'])
timeline(20,[3],[('**한성 시대**',3),('**공주(웅진) 시대**',1),('**부여(사비) 시대**',4)],['근초고왕','불교 수용','개로왕 死\n문주왕 공주 천도','무령왕','성왕\n부여 천도','성왕 死\n관산성 전투','무왕','의자왕'])
record(23,[1],[T([[C('**백제 전성기**\n근초고왕, 평양성 전투'),C('**→**'),C('**고구려 전성기**\n소수림왕 → 광개토왕 → 장수왕')]])],[dict(kind='succession',fromText='백제 전성기',toText='고구려 전성기')])
record(23,[2],[T([[C('**→**'),C('**신라 전성기**\n지증왕 → 법흥왕 → 진흥왕')]])])
record(23,[3,4],[T([[C('**7세기 & 삼국통일**',colSpan=3,header=True)],[C('**→ 을지문덕**\n(고구려 vs 수)',rowSpan=2),C('→ **연개소문**\n(당 강경외교)',colSpan=2)],[C('**백제 vs 신라**\n(대야성 전투)'),C('→ **나당 연합**\n신라 김춘추')]])],[dict(kind='branch',fromText='을지문덕',toTexts=['연개소문','백제 vs 신라']),dict(kind='arrow',fromText='백제 vs 신라',toText='나당 연합')])
record(23,[5],[T([[C('→ **백제멸망**\n무열왕\n황산벌 전투'),C('→ **고구려 멸망**\n문무왕'),C('→ **나당 전쟁**\n문무왕')]])])
timeline(23,[6],[('**전성기 이전**',3),('**전성기**',2),('**삼국통일**',3)],['왜 공격','나제동맹','지증왕','법흥왕','진흥왕','백제\n멸망','고구려\n멸망','나당\n전쟁'])
# Original rank chart: eligibility bars are graphic cells, never fabricated text.
ranks=['이벌찬','이 찬','잡 찬','파진찬','대아찬','아 찬','일길찬','사 찬','급벌찬','대나마','나 마','대 사','사 지','길 사','대 오','소 오','조 위']
rows=[[C(x,header=True,shade='blue') for x in ['등급','관등명','공복','진골','6두품','5두품','4두품']]]
for i,name in enumerate(ranks):
 row=[C(str(i+1),shade='yellow'),C(name,shade='peach')]
 for start,span,label in [(0,5,'자색'),(5,4,'비색'),(9,2,'청색'),(11,6,'황색')]:
  if i==start:row.append(C(label,rowSpan=span,shade='green'))
 for start,label in [(0,'진골'),(5,'6두품'),(9,'5두품'),(11,'4두품')]:
  if i==0 and start>0:row.append(C(rowSpan=start,shade='green'))
  elif i==start:row.append(C('',rowSpan=17-start,bar=True,shade='green',rangeStart=start+1,rangeEnd=17,accessibleLabel=f'{label} 원문 범위: {start+1}~17등급'))
 rows.append(row)
rank_panel=T(rows,'source-rank-chart');rank_panel.update(headerRowCount=1,sourceHeaderGroups=['관 등','골 품'],sourceColumnWidths=[9,19,14,14.5,14.5,14.5,14.5],sourceHeaderPlacement='bottom',displayHeaderPlacement='single-row-top',sourceRankGuides=[6,10,12])
record(23,[7],[rank_panel],[dict(kind='source-range-bars',ranges=[dict(label=l,start=s+1,end=17) for s,l in [(0,'진골'),(5,'6두품'),(9,'5두품'),(11,'4두품')]])])
timeline(31,[3],[('**통일신라 전기**',3),('**통일신라 후기**',3),('**후삼국 시대**',3)],['문무왕\n삼국통일','신문왕','혜공왕\n피살','원성왕','김헌창의 난','진성여왕','후백제\n후고구려\n건국','고려\n건국','신라\n항복'])
record(35,[3],[T([[C('',colSpan=5,shade='yellow')],[C('대조영\n발해 건국'),C('2대\n무왕'),C('3대\n문왕'),C('10대\n선왕'),C('거란 침입\n발해 멸망')]],'source-timeline')])
record(46,[1],[T([[C('**안향, 백이정**\n성리학 도입',rowSpan=2),C('→',rowSpan=2),C('**이제현**',rowSpan=2),C('**이 색**\n이제현 제자',rowSpan=2),C('┌ **정몽주**\n이색 제자')],[C('└ **정도전**\n이색 제자')]])],[dict(kind='teacher-branch',fromText='이제현',toText='이 색'),dict(kind='teacher-branch',fromText='이 색',toTexts=['정몽주','정도전'])])
record(58,[1],[T([[C('**1392**\n조선건국'),C('경국대전'),C('4대사화'),C('**1592**\n임진왜란'),C('대동법'),C('**1636**\n병자호란'),C('탕평'),C('고종'),C('**1910**\n경술국치')]],'source-timeline')])
record(58,[2,3,4],[T([[C('1대\n**태조 이성계**\n조선 건국\n정도전'),C('2대\n**정종**'),C('3대\n**태종 이방원**\n왕권 강화\n6조 직계제'),C('4대\n**세종**\n의정부서사제\n집현전\n대마도정벌\n4군6진 개척'),C('5대\n**문종**'),C('6대\n**단종**'),C('7대\n**세조**\n계유정난\n6조직계제\n직전법')]],'source-ruler-sequence'),T([[C('8대\n**예종**'),C('9대\n**성종**\n경국대전\n홍문관\n사림 등장(김종직)'),C('10대\n**연산군**\n무오사화\n갑자사화'),C('11대\n**중종**\n조광조 개혁\n기묘사화'),C('12대\n**인종**'),C('13대\n**명종**\n을사사화\n양재역 벽서사건')]],'source-ruler-sequence')])
record(58,[5],[T([[C('**명령**',rowSpan=3,bypass='down'),C('**국왕**',shade='peach'),C('**보고**',rowSpan=3,bypass='up')],[C('**의정부**',shade='green')],[C('**6조**',shade='blue')]])],[dict(kind='bypass',fromText='국왕',toText='6조',label='명령',bypasses='의정부'),dict(kind='bypass',fromText='6조',toText='국왕',label='보고',bypasses='의정부')])
record(59,[1],[T([[C('**국왕**',shade='peach')],[C('재가 ↓\n↑ 건의')],[C('**의정부**',shade='green')],[C('명령 ↓\n↑ 보고')],[C('**6조**',shade='blue')]])],[dict(kind='bidirectional',fromText='국왕',toText='의정부',forward='재가',reverse='건의'),dict(kind='bidirectional',fromText='의정부',toText='6조',forward='명령',reverse='보고')])
for i,text in [(2,'사화 ②'),(3,'사화 ①'),(4,'사화 ③'),(5,'사화 ④')]:record(59,[i],[dict(text='**'+text+'**',kind='text')])
record(63,[1],[T([[C('14대\n**선조**\n기축옥사\n임진왜란'),C('15대\n**광해군**\n중립 외교\n대동법'),C('16대\n**인조**\n이괄의 난\n병자호란'),C('17대\n**효종**\n북벌론\n나선정벌'),C('18대\n**현종**\n예송논쟁'),C('19대\n**숙종**\n환국')]],'source-ruler-sequence')])
record(63,[2],[T([[C('',colSpan=3),C('**세도정치**',colSpan=3,header=True)],[C('20대\n**경종**'),C('21대\n**영조**\n탕평\n균역법'),C('22대\n**정조**\n탕평\n신해통공'),C('23대\n**순조**\n신유박해\n홍경래 난'),C('24대\n**헌종**'),C('25대\n**철종**\n임술농민봉기\n삼정이정청')]],'source-ruler-sequence')])
record(63,[3],[T([[C('**선조**'),C('이조전랑\n**사림**\n├ 동인\n│  정여립 모반사건\n│  ├ 북인\n│  └ 남인\n└ 서인',tree=True)],[C('**인조**'),C('인조반정 → 북인 → X')],[C('**현종**'),C('예송논쟁\n남인 vs 서인')],[C('**숙종**'),C('환국\n남인    **서인**\n        ├ 노론\n        └ 소론',tree=True)],[C('**영조·정조**'),C('탕평책\n남인 vs 노론 vs 소론')],[C('**순조·헌종·철종**'),C('노론 → 세도정치')]])],[dict(kind='branch',fromText='사림',toTexts=['동인','서인'],label='이조전랑'),dict(kind='branch',fromText='동인',toTexts=['북인','남인'],label='정여립 모반사건'),dict(kind='elimination',fromText='북인',toText='X',label='인조반정'),dict(kind='branch',fromText='서인',toTexts=['노론','소론'])])
record(71,[1,2],[T([[C('**경(京)재소**\n중앙(서울)'),C('통제 →'),C('**유향(鄕)소**\n좌수·별감')],[C('규찰 ↙'),C(),C('↘ 자문·견제')],[C('**향리**\n(아전)'),C('← 감독\n보좌 →'),C('**수령**')]])],[dict(kind='arrow',fromText='경(京)재소',toText='유향(鄕)소',label='통제'),dict(kind='arrow',fromText='유향(鄕)소',toText='향리',label='규찰'),dict(kind='arrow',fromText='유향(鄕)소',toText='수령',label='자문·견제'),dict(kind='arrow',fromText='수령',toText='향리',label='감독'),dict(kind='arrow',fromText='향리',toText='수령',label='보좌')])
record(71,[3],[T([[C('**왕**',rowSpan=9),C('**의정부**'),C('**6조**',shade='yellow'),C('이조\n호조\n예조\n병조\n형조\n공조')],[C('**승정원**'),C('',colSpan=2)],[C('**의금부**'),C('',colSpan=2)],[C('**사헌부**'),C('**3사**',rowSpan=3,shade='yellow'),C('',rowSpan=3)],[C('**사간원**')],[C('**홍문관**')],[C('**한성부**'),C('',colSpan=2)],[C('**춘추관**'),C('',colSpan=2)],[C('**성균관**'),C('',colSpan=2)]])])
record(86,[1,2],[T([[C('**1866.5**'),C('**1866.6**'),C('**1866.10**'),C('**1868**'),C('**1871**'),C('**1871**')],[C('**병**\n인\n박\n해'),C('**제**\n너\n럴\n셔\n먼\n호'),C('**병**\n인\n양\n요'),C('**오**\n페\n르\n트\n도\n굴\n사\n건'),C('**신**\n미\n양\n요'),C('**척**\n화\n비')]],'source-timeline')])
timeline(106,[4],[('1910년대',1),('1920~30년대 초반',1),('1930년대 중반 이후',1)],['**헌병경찰통치**\n**1910**','**문화통치(기만)**\n**1920**','**민족말살**\n**1930년대 중반**\n**1945**'])

# Previously connected rasters also undergo the same text-vs-image audit.
record(9,[7],[T([[C('B.C.\n8000년 경'),C('B.C.\n1500년 경'),C('B.C.\n5세기'),C()],[C('**구석기 시대**',shade='yellow'),C('**신석기 시대**',shade='green'),C('**청동기 시대**',shade='peach'),C('**철기 시대**',shade='blue')]],'source-timeline')])
record(11,[1],[T([[C('B.C.2333'),C('B.C. 3세기'),C('B.C.194'),C('B.C. 2세기'),C('B.C.108')],[C('**단군왕검**'),C('**연 장수**\n**진개의 공격**'),C('**준왕 축출**\n**위만 즉위**'),C('**진번·임둔**\n**복속**'),C('**우거왕**')]],'source-timeline')])
record(35,[2],[T([[C('**왕**',rowSpan=7,shade='green'),C('**정당성**',rowSpan=2,shade='blue'),C('**좌사정**',shade='peach'),C('**충부**\n**인부**\n**의부**')],[C('**우사정**',shade='peach'),C('**지부**\n**예부**\n**신부**')],[C('**선조성**',shade='blue'),C('',colSpan=2)],[C('**중대성**',shade='blue'),C('',colSpan=2)],[C('**중정대**',shade='pink'),C('감찰 업무',colSpan=2)],[C('**문적원**',shade='pink'),C('서적 관리',colSpan=2)],[C('**주자감**',shade='pink'),C('교육 기관',colSpan=2)]])],[dict(kind='branch',fromText='정당성',toTexts=['좌사정','우사정']),dict(kind='branch',fromText='좌사정',toTexts=['충부','인부','의부']),dict(kind='branch',fromText='우사정',toTexts=['지부','예부','신부'])])
record(51,[1],[T([[C('**왕**',rowSpan=5,shade='green'),C('**도병마사**\n**식목도감**',rowSpan=5,shade='blue'),C('**중서문하성**',shade='peach'),C()],[C('**상서성**',shade='peach'),C('**이부**\n**병부**\n**호부**\n**형부**\n**예부**\n**공부**')],[C('**중추원**',shade='pink'),C()],[C('**어사대**',shade='pink'),C()],[C('**삼사**',shade='pink'),C()]])],[dict(kind='branch',fromText='상서성',toTexts=['이부','병부','호부','형부','예부','공부']),dict(kind='councils-on-root-link',fromText='왕',toTexts=['도병마사','식목도감'])])
for page,num,label in [(86,3,'**척화비**'),(86,4,'**어재연 장군**\n**수자기**'),(124,1,'**신탁통치**\n**찬반 갈등**'),(124,2,'**남북협상(김구)**'),(124,3,'**여운형**\n**조선건국동맹**'),(130,1,'**삼청교육대**'),(130,2,'**6월민주항쟁**\n**(이한열)**')]:record(page,[num],[dict(text=label,kind='text')])

record(123,[6],[T([[C('→',colSpan=9,shade='green')],[C('**광복**'),C('**이승만**\n**정부**'),C('**박정희**\n**정부**'),C('**전두환**\n**정부**'),C('**노태우**\n**정부**'),C('**김영삼**\n**정부**'),C('**김대중**\n**정부**'),C('**노무현**\n**정부**'),C('**이명박**\n**정부**')]],'source-ruler-sequence')])

def union(boxes):return [min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
TIMELINES={
 'p009-figure-7':dict(bounds=[15.5,389.5,770.5,1146.5,1525.5],points=[202.5,580,958.5,1336]),
 'p011-figure-1':dict(bounds=[96,687,1066],points=[96,452,687,893,1066]),
 'p017-figure-2':dict(bounds=[19.5,476.5,1052.5,1614.5],points=[150,314,476.5,667,855,1164,1334,1496]),
 'p020-figure-3':dict(bounds=[13.5,536.5,935.5,1566.5],points=[208,393,536.5,798,935.5,1145,1324,1493]),
 'p023-figure-6':dict(bounds=[6.5,463.5,1039.5,1452.5],points=[137,300,463.5,654,842,1126,1250,1373]),
 'p031-figure-3':dict(bounds=[91.5,439.5,1123.5,1559.5],points=[91.5,283,439.5,597,776,991,1227,1373,1491]),
 'p035-figure-3':dict(bounds=[99.5,888.5],points=[99.5,275,403,611,888.5]),
 'p106-figure-4':dict(bounds=[60,387,787,1166],points=[223.5,587,976.5])
}
def timeline_layout(panel,audit):
 key=audit['sourceAssetIds'][0];spec=TIMELINES.get(key)
 if not spec:return None
 left,right=spec['bounds'][0],spec['bounds'][-1];position=lambda x:(x-left)/(right-left)
 if key in ['p009-figure-7','p011-figure-1']:
  is_pre=key=='p009-figure-7';shades=['yellow','green','peach','blue'] if is_pre else ['green','peach']
  bands=[dict(start=position(spec['bounds'][i]),end=position(spec['bounds'][i+1]),lines=[],shade=shade) for i,shade in enumerate(shades)]
  events=[dict(position=position(x),lines=cell_lines(c['text'])) for x,c in zip(spec['points'],panel['rows'][1])]
  datepoints=spec['bounds'][1:-1] if is_pre else spec['points'];dates=panel['rows'][0][:3] if is_pre else panel['rows'][0]
  return dict(bands=bands,events=events,topBoundaries=[dict(position=position(x),lines=cell_lines(c['text'])) for x,c in zip(datepoints,dates)],sourcePixelAxis=[left,right],coordinateBasis='original source band and tick x coordinates')
 bands=[]
 for i,src in enumerate(panel['rows'][0]):
  bands.append(dict(start=position(spec['bounds'][i]),end=position(spec['bounds'][i+1]),lines=cell_lines(src['text']),shade=src.get('shade','yellow')))
 events=[dict(position=position(x),lines=cell_lines(c['text'])) for x,c in zip(spec['points'],panel['rows'][1])]
 layout=dict(bands=bands,events=events,coordinateBasis='normalized original small-diagram source x coordinates; tick and band boundaries checked against the source image',sourcePixelAxis=[left,right])
 if key=='p106-figure-4':
  for e,t in zip(events,['**헌병경찰통치**','**문화통치(기만)**','**민족말살**']):e['lines']=cell_lines(t)
  layout['boundaries']=[dict(position=position(x),lines=cell_lines(t)) for x,t in zip(spec['bounds'],['**1910**','**1920**','**1930년대\n중반**','**1945**'])]
 return layout
def build_table(panel,stem,audit):
 rows=[];occupied={};colcount=max(sum(c.get('colSpan',1) for c in row) for row in panel['rows'])
 # Compute column positions accounting for earlier rowspans.
 for ri,inputrow in enumerate(panel['rows']):
  cells=[];cursor=0
  for src in inputrow:
   while (ri,cursor) in occupied:cursor+=1
   cs=src.get('colSpan',1);rs=src.get('rowSpan',1)
   c=dict(id=f'{stem}-r{ri}-c{cursor}',rowIndex=ri,columnIndex=cursor,colSpan=cs,rowSpan=rs,header=src.get('header',False),lines=cell_lines(src['text']))
   if src.get('shade'):c['sourceShading']=src['shade']
   if src.get('tree'):c['sourceTree']=True
   if src.get('bypass'):c['sourceBypass']=src['bypass']
   if src.get('bar'):c['sourceRangeBar']=True;c['sourceRangeLabel']=src['accessibleLabel'];c['sourceRangeStart']=src.get('rangeStart');c['sourceRangeEnd']=src.get('rangeEnd')
   for r in range(ri,ri+rs):
    for col in range(cursor,cursor+cs):occupied[(r,col)]=True
   cells.append(c);cursor+=cs
  colcount=max(colcount,cursor);rows.append(dict(id=stem+f'-row-{ri}',cells=cells))
 result=dict(id=stem,type='table',columnCount=colcount,rows=rows,layoutRole=panel['kind'],reviewStatus='verified',transcriptionAudit=audit)
 for key in ['headerRowCount','sourceHeaderGroups','sourceColumnWidths','sourceHeaderPlacement','displayHeaderPlacement','sourceRankGuides']:
  if key in panel:result[key]=panel[key]
 layout=timeline_layout(panel,audit)
 if layout:result['sourceTimeline']=layout
 return result
def link_photo_labels():
 # The two original marginal labels identify these actual source photographs.
 path=ROOT/'pages/page-086.json';d=json.loads(path.read_text())
 for label,photo in [(4,6),(3,5)]:
  block=next(b for b in d['blocks'] if b['id']==f'p086-diagram-{label}-1');aid=f'p086-figure-{photo}';inv=next(i for i in d['imageInventory'] if i['assetId']==aid);cid=block['id']+'-caption'
  lines=block.get('lines') or block['rows'][0]['cells'][0]['lines']
  for parent in d['blocks']:
   if parent is not block and parent.get('figures'):parent['figures']=[f for f in parent['figures'] if f['assetId']!=aid]
  figure=dict(id=aid,type='figure',assetId=aid,bbox=inv['sourceBbox'],alt='원문 이미지 · PDF 86쪽',classification='source-photo-with-native-caption',sourceRowIndices=[0],sourceCaptionCellId=cid,associationReviewStatus='source-render-checked',presentationStatus='source-image-preserved')
  block.update(type='table',layoutRole='source-illustration-gallery',columnCount=1,rows=[dict(id=block['id']+'-row',cells=[dict(id=cid,rowIndex=0,columnIndex=0,rowSpan=1,colSpan=1,lines=lines,sourceAssociations=[dict(kind='source-figure-caption',startLine=0,endLineExclusive=len(lines),assetIds=[aid],reviewStatus='verified')])])],figures=[figure],figureGroups=[dict(assetIds=[aid],relationship='one-source-illustration',captionCellId=cid,reviewStatus='verified')]);block.pop('lines',None)
 path.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
def apply():
 report=[]
 for rec in RECORDS:
  n=rec['pdfPage'];path=ROOT/f'pages/page-{n:03}.json';d=json.loads(path.read_text());found=[];locations=[]
  for b in d['blocks']:
   if b.get('assetId') in rec['assetIds']:found.append(b);locations.append(('block',b))
   for f in b.get('figures',[]):
    if f.get('assetId') in rec['assetIds']:found.append(f);locations.append(('table',b))
  if not found:
   current=[b for b in d['blocks'] if b.get('transcriptionAudit',{}).get('sourceAssetIds')==rec['assetIds']]
   if current:
    audit=current[0]['transcriptionAudit'];replacements=[]
    for i,panel in enumerate(rec['panels']):
     stem=f'p{n:03}-diagram-{rec["assetIds"][0].split("-")[-1]}-{i+1}'
     out=dict(id=stem,type='text',lines=cell_lines(panel['text']),reviewStatus='verified',transcriptionAudit=audit) if panel['kind']=='text' else build_table(panel,stem,audit)
     for key in ['sourceParentTableId','sourceRowIndices','sourceTargetCellId']:
      if key in current[0]:out[key]=current[0][key]
     replacements.append(out)
    at=d['blocks'].index(current[0]);d['blocks']=d['blocks'][:at]+replacements+[b for b in d['blocks'][at:] if b not in current];path.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');report.append(dict(pdfPage=n,sourceAssetIds=rec['assetIds'],blockIds=[b['id'] for b in replacements]));continue
   assert any(b.get('transcriptionAudit',{}).get('sourceAssetIds')==rec['assetIds'] for b in d['blocks']),rec['assetIds'];continue
  assert {f['assetId'] for f in found}==set(rec['assetIds']),(rec['assetIds'],[f['assetId'] for f in found])
  inv=[i for i in d['imageInventory'] if i['assetId'] in rec['assetIds']]
  audit=dict(method='visual-transcription',sourceVerified=True,sourcePdfPage=n,sourceSha256=d['sourceSha256'],sourceAssetIds=rec['assetIds'],sourceImageSha256=[i['sha256'] for i in inv],sourceBBox=union([f['bbox'] for f in found]),verificationScope='visible wording, original emphasis, sequence, branches and source ranges; no historical correction',relations=rec['relations'])
  replacements=[]
  for i,panel in enumerate(rec['panels']):
   stem=f'p{n:03}-diagram-{rec["assetIds"][0].split("-")[-1]}-{i+1}'
   if panel['kind']=='text':out=dict(id=stem,type='text',lines=cell_lines(panel['text']),reviewStatus='verified',transcriptionAudit=audit)
   else:out=build_table(panel,stem,audit)
   replacements.append(out)
  tableparents=[b for kind,b in locations if kind=='table']
  topfigures=[f for kind,f in locations if kind=='block']
  target=topfigures[0] if topfigures else tableparents[0]
  index=d['blocks'].index(target)+(0 if topfigures else 1)
  if tableparents:
   assert len({b['id'] for b in tableparents})==1
   for out in replacements:
    out['sourceParentTableId']=tableparents[0]['id'];out['sourceRowIndices']=sorted({r for f in found for r in f.get('sourceRowIndices',[])})
    captions={f.get('sourceCaptionCellId') for f in found}
    if len(captions)==1 and None not in captions:out['sourceTargetCellId']=next(iter(captions))
   for parent in tableparents:
    parent['figures']=[f for f in parent['figures'] if f.get('assetId') not in rec['assetIds']]
    parent['figureGroups']=[g for g in parent.get('figureGroups',[]) if not set(g['assetIds'])&set(rec['assetIds'])]
  removed={f['id'] for f in topfigures}
  d['blocks']=d['blocks'][:index]+replacements+[b for b in d['blocks'][index:] if b['id'] not in removed]
  for item in inv:item['presentationStatus']='semantic-transcription-reviewed';item['semanticBlockIds']=[b['id'] for b in replacements]
  d.setdefault('diagramTranscriptions',[]).append(dict(sourceAssetIds=rec['assetIds'],blockIds=[b['id'] for b in replacements],reviewStatus='verified'))
  path.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');report.append(dict(pdfPage=n,sourceAssetIds=rec['assetIds'],blockIds=[b['id'] for b in replacements]))
 link_photo_labels()
 (ROOT.parent/'docs/textbook-diagram-review.json').write_text(json.dumps(dict(sourceSha256='35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442',scope='explicit visual transcriptions; original native text spans retained',diagrams=report),ensure_ascii=False,indent=2)+'\n');print('Transcribed',len(report),'diagrams;',sum(len(r['sourceAssetIds']) for r in report),'source placements')
if __name__=='__main__':apply()
