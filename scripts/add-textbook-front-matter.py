"""Add missing front matter/era dividers as native text, never page images."""
import hashlib,json,sys,collections,re
from pathlib import Path
import pymupdf
ROOT=Path(__file__).resolve().parents[1]/'private-textbook-semantic-data'
EXPECTED='35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442'
def L(text):
 return dict(spans=[dict(text=p[2:-2] if p.startswith('**') else p,bold=p.startswith('**'),sourceRasterText=True) for p in re.split(r'(\*\*.*?\*\*)',text) if p])
def text(stem,content,heading=False):return dict(id=stem,type='heading' if heading else 'text',**({'level':2} if heading else {}),lines=[L(s) for s in content.split('\n')],reviewStatus='verified')
def table(stem,rows):
 out=dict(id=stem,type='table',columnCount=len(rows[0]),rows=[dict(id=f'{stem}-r{ri}',cells=[dict(id=f'{stem}-r{ri}-c{ci}',rowIndex=ri,columnIndex=ci,rowSpan=1,colSpan=1,lines=[L(s) for s in v.split('\n')]) for ci,v in enumerate(row)]) for ri,row in enumerate(rows)],reviewStatus='verified')
 if rows[0]==['구분','내용']:
  out['headerRowCount']=1
  for c in out['rows'][0]['cells']:c.update(header=True,scope='col',sourceShading='blue')
 return out
manual={
1:[('h','벼락치기 한능검\n**선택지노트**'),('t','**79회!!**\n**한 번에 끝낼거에요**\n**..제발**\n만나서 너무 반갑지만 우리 이번까지만 만날까요')],
5:[('t','벼락치기 한능검'),('h','**선택지노트 200% 활용법**'),('t','방대한 내용 중에 시험에 반드시 나오는 내용만 모았습니다.\n\n만점이 목표라면 본 노트에 부족한 내용이 있을 수도 있지만,\n안정적인 1급이 목표라면 본 노트의 내용만으로 충분합니다.\n\n그 중에서도 특히 **BOLD**처리된 키워드는 반드시 암기해주세요!'),('t','**〈표 19〉 고려 원 간섭기 시대 핵심 내용**'),('table',[['구분','내용'],['**원의 내정간섭**','• **일본** 원정 시도(실패): **정동행성** 설치\n• **쌍성총관부** 설치\n• **권문세족**: 도평의사사 장악\n• **응방**(매), **공녀**(결혼도감 설치), 몽골어 역관(충렬왕 때 통역을 담당하는 통문관 설치)\n• **몽골풍(변발과 호복)** 유행\n• **정치도감** 설치(충목왕의 개혁)'],['**공민왕의**\n**개혁 정책**','• **기철** 세력 숙청\n• **쌍성총관부** 수복\n• **전민변정도감** 설치(신돈)\n• 노국공주와의 사랑'],['**신진사대부**','• 성리학 수용\n• **만권당**에서 원 학자와 교류(이제현)\n• 국자감 → 성균관']]),('t','※ 유튜브 영상에는 나오지만 선택지노트에는 없는 내용이 있을 수 있어요!\n영상에서는 흐름을 함께 설명드리기 위해 쪼오금 더 많은 내용이 있거든요!\n선택지노트에는 1급에 꼭 필요하지 않은 내용들을 쪼오금 더! 과감하게 덜어냈습니다!!')],
6:[('t','벼락치기 한능검'),('h','**선택지 표현으로 기억하자**'),('t','선택지는 같은 표현으로 반복되어서 출제됩니다.\n\n내용만 암기하지 말고, 실제 선택지에 쓰이는 표현을 익혀둡시다!\n\n**① ② ③ 번호**  30% 이상 (**★** 40% 이상)\n**음영 처리**  20% 이하\n\n※ 최근 10회 시험 중 출제 비중'),('h','**시험에는 이렇게 나온다!**'),('table',[['홍건적,\n왜구 침입','① **최영**의 지휘 아래 **홍산**에서 **왜구**를 격퇴하였다\n② 화통도감을 두어 **화포**를 제작하였다 **★**\n③ **최무선**이 화포를 사용하여 **진포**에서 **왜구**를 격퇴하였다\n④ **박위**를 파견하여 근거지를 토벌하였다\n\n• 공민왕이 홍건적의 침입 때 안동으로 피란하였다\n• 이성계를 중심으로 한 고려군이 황산에서 왜구를 격퇴하였다'],['조선 건국\n과정','① (최영이) 철령위 설치에 반발해 **요동 정벌을 추진하였다** **★**\n② 경기에 한하여 설치된 **과전이** 농민에게 미친 영향을 파악한다 **★**\n\n• 정몽주가 이방원 세력에게 피살되었다\n• 이성계가 위화도에서 회군하여 정권을 장악하였다']]),('t','시간이 없다면 **★**선택지만이라도 꼭 외우기!')],
7:[('t','벼락치기 한능검'),('h','**빈칸 문제로 공부내용 점검하기**'),('t','시대마다 공부 내용을 확인하기 위한 **빈칸 문제**가 있습니다.\n\n빈칸 문제만 쓱쓱 풀어낼 수 있다면\n**꼭 맞아야 하는 문제**들은 어렵지 않게 풀릴거에요!'),('h','**공부 내용 확인!(빈칸에 해당하는 내용을 적어보자)**'),('t','**[ 독립운동단체 / 지역 중에 해당되는 내용을 쓰세요 ]**'),('table',[[s,'(                 )'] for s in ['(1) 김구가 상하이에서 조직하였고 윤봉길 의거 등이 있는 **이 단체는?**','(2) 경학사와 신흥무관학교가 있는 **이 지역은?**','(3) 김원봉이 우한에서 설립한 **조직으로** 조선민족전선연맹 산하 부대는?','(4) 대구에서 박상진이 조직하여 친일파를 처단한 **이 단체는?**','(5) 신한촌과 권업회를 조직하고, 한인들이 중앙아시아로 강제 이주된 **이 지역은?**','(6) 일본에 국권 반환 요구서를 제출하고자 한 **이 단체는?**','(7) 대조선국민군단을 설립하고 최초로 공식 이민이 시작된 **이 지역은?**','(8) 인도·미얀마 전선에 파견되고, 국내 진공 작전을 계획한 **이 단체는?**','(9) 김원봉이 설립하고, 신채호의 조선혁명선언을 지침으로 삼은 **이 단체는?**','(10) 서전서숙, 명동학교, 중광단이 있는 **이 지역은?**','(11) 영릉가, 흥경성 전투가 있고, 남만주 지역에서 활약한 **이 단체는?**','(12) 발생 순서대로 번호를 적어보세요']]),('t','⋮')],
144:[('t','해당 교재는 대한민국 **저작권법의 보호**를 받습니다.\n작성된 모든 내용의 권리는 작성자에게 있으며,\n**작성자의 동의없는 사용이 금지**됩니다.\n\n본 교재의 **일부 혹은 전체 내용을 무단으로 복제/배포**하거나\n**2차적 저작물로의 재편집, 영리를 목적으로 활용할 경우,**\n\n**5년 이하의 징역** 또는\n**5천만원 이하의 벌금**과 **민사상 손해배상**을 청구합니다.'),('h','**벼락치기 한능검**\n**선택지노트 2026©**'),('t','발 행 일 : 2025년 4월 (2026.6 개정)\n발 행 인 : 이 루 리\n발 행 처 : 공부돼지\n주    소 : https://blog.naver.com/gongbupig\n          https://www.youtube.com/@gongbupig\n\n제C-2025-016148호')]
}
def main(source):
 assert hashlib.sha256(Path(source).read_bytes()).hexdigest()==EXPECTED
 doc=pymupdf.open(source);manifest=json.loads((ROOT/'manifest.json').read_text());font_votes=collections.defaultdict(collections.Counter)
 for path in (ROOT/'pages').glob('*.json'):
  def walk(v):
   if isinstance(v,dict):
    if 'font' in v and 'bold' in v:font_votes[v['font']][bool(v['bold'])]+=1
    for x in v.values():walk(x)
   elif isinstance(v,list):
    for x in v:walk(x)
  walk(json.loads(path.read_text()))
 for n in [1,2,3,4,5,6,7,8,16,144]:
  page=doc[n-1];blocks=[]
  if n in manual:
   for i,(kind,content) in enumerate(manual[n]):blocks.append(table(f'p{n:03}-front-{i}',content) if kind=='table' else text(f'p{n:03}-front-{i}',content,kind=='h'))
  else:
   # Original PDF native lines, grouped on their baseline and sorted by x.
   groups={}
   for bi,b in enumerate(page.get_text('rawdict')['blocks']):
    if b['type']!=0:continue
    for li,l in enumerate(b['lines']):
     for si,s in enumerate(l['spans']):
      votes=font_votes[s['font']];spanid=f'p{n:03}-b{bi:03}-l{li:03}-s{si:03}'
      for ci,c in enumerate(s['chars']):
       if c['bbox'][1]>775:continue
       baseline=round(c['origin'][1],0)
       item=dict(text=c['c'],font=s['font'],fontSize=s['size'],bold=votes[True]>votes[False] if votes else bool(s['flags']&16),bbox=list(c['bbox']),sourceSpanId=spanid,sourceCharIds=[spanid+f'-c{ci:03}'])
       groups.setdefault(baseline,[]).append(item)
   for i,(baseline,chars) in enumerate(sorted(groups.items())):
    chars.sort(key=lambda s:s['bbox'][0]);spans=[]
    for c in chars:
     if spans and spans[-1]['sourceSpanId']==c['sourceSpanId'] and spans[-1]['font']==c['font']:
      prev=spans[-1];prev['text']+=c['text'];prev['sourceCharIds']+=c['sourceCharIds'];prev['bbox']=[min(prev['bbox'][0],c['bbox'][0]),min(prev['bbox'][1],c['bbox'][1]),max(prev['bbox'][2],c['bbox'][2]),max(prev['bbox'][3],c['bbox'][3])]
     else:spans.append(c)
    blocks.append(dict(id=f'p{n:03}-native-{i}',type='text',lines=[dict(baseline=baseline,spans=spans)],reviewStatus='source-native-text'))
  if n==5:
   sample=next(b for b in blocks if b['type']=='table')
   for c in sample['rows'][0]['cells']:c['sourceShading']='blue'
   sample['sourceMarginalAnnotations']=[dict(text='BOLD',targetText='기철',kind='source-highlight-label')]
  if n==6:
   sample=next(b for b in blocks if b['type']=='table')
   for row,start in zip(sample['rows'],[5,3]):
    cell=row['cells'][1];cell['lineGroups']=[dict(kind='source-inset',startLine=start,endLineExclusive=len(cell['lines']),borderStyle='dotted',sourceShading='gray')]
  for b in blocks:b['transcriptionAudit']=dict(method='visual-transcription' if n in manual else 'native-source-text',sourceSha256=EXPECTED,sourcePdfPage=n,verificationScope='wording and emphasis; original full-page decorative artwork excluded')
  data=dict(schemaVersion='hanq-semantic/1',pdfPage=n,printedPage=n-7 if n>=8 else None,width=page.rect.width,height=page.rect.height,sourceSha256=EXPECTED,reviewStatus='source-review-pending',blocks=blocks,sourceBlanks=[],generatedPractice=[],imageInventory=[],pageRole='era-divider' if n in [8,16] else 'front-matter' if n<8 else 'publication-notice')
  (ROOT/f'pages/page-{n:03}.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
  manifest['pages']=[p for p in manifest['pages'] if p['pdfPage']!=n]+[dict(pdfPage=n,printedPage=data['printedPage'],reviewStatus='source-review-pending',figuresAvailable=False,pageRole=data['pageRole'])]
 manifest['pages'].sort(key=lambda p:p['pdfPage']);(ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n');print('Added 10 source pages; semantic pages',len(manifest['pages']))
if __name__=='__main__':main(sys.argv[1])
