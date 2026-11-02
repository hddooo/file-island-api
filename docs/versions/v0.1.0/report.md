# API 결과·이슈·다음 업무

현재 버전 폴더 `v0.1.0`은 API의 기존 `package.json` 버전 `0.1.0`을 기준으로 한 문서 기준선이다. FE에는 별도 패키지 버전이 없고 두 저장소 모두 Git 릴리스 태그가 없다. 새 제품 릴리스를 선언하거나 태그·패키지 버전을 변경한 것이 아니다. 배포 식별은 아래 정확한 커밋을 사용한다.

<a id="timeline"></a>
## 날짜별 변경 이력

다음은 같은 패키지 기준선 안의 실제 작업 이력이다. Git 반영과 당시 운영 검증을 구분하며 현재 기능으로 확정한 것은 최신 설계를 따른다. 과거 미완료가 후속 커밋으로 대체된 경우도 날짜를 유지한다.

| 날짜 | 한 일 | 실제 근거 | 상태·한계 |
|---|---|---|---|
| 10/08 | 초기 계정/서버·기출/원문 학습 통합 | 원격 이력에 보존된 당시 local-release 보고 | 당시 로컬 검사·운영 준비 기록. 오늘 미배포 상태라는 뜻 아님 |
| 10/13 | 선정표 회상 공백·연결 보기·그림 출처 감사 | 독립 감사와 source/coverage JSON | 전체 풀과 선정표를 구분. 미확인 후보를 이번 문서 작업으로 해결 처리하지 않음 |
| 10/22~23 | 디지털월드 화면·개인 체크·KST 기록·문법/보기 해설 | API `1db4962`, `b04df44`, `213686a` 및 당시 검수 보고 | source/역사 검사 범위. 실제 iPhone 전체 성공 근거 아님 |
| 10/24~25 | 약점 문제/첫 결과·최근3회, 연결어 PDF, Chapter1 공개, LC 순차 준비 | FE `6efbe0e`, `310e973`, `aeb094f`; API `6a5c65b`, `2ac130f` | 초기 준비중/2쪽 압축 설계는 후속으로 대체 |
| 10/26 | Chapter2·3, PDF 독립 예문·Tip 간격, 공통자료/개인답안, opt-in90일 | FE `04f1a2f`, `52b0f59`, `9336983`, `7a44d78`; API `0ac880a`, `1dc1eb7`, `90085b7`, `0ed4de8` | Git 반영 확인. 정책 설정을 이 문서가 변경하지 않음 |
| 10/26 | SSE·자동진행·지연응답/공격 누락 복구·연습봇 | FE `8522ffa`, `011a582`; API `022e843`, `e32a225` | 격리 전체 앱·두 참가자·응답 지연 검사. 물리 단말 미검증 |
| 10/27 | 문제/종료 모달·Ready·HP 잔상,6섬 지도·전투 오답·UI 정리 | FE `0502f01`, `b3036c1`, `63ce626`; API `129d50b`, `30d7376` | 아래 최신 기능 배포·자산/health·DB045 근거 확인 |
| 10/27 | 전체 기획3문서·버전 기록 입구 | FE `583e508`; API `8ecbfc0` | Vercel 체크 성공·Render Live, health200 확인 |
| 10/27 | 기존 문서 실제 통합·중복 제거·이력 표 정리 | 이번 문서 전용 diff와 이후 Git 커밋 | 링크/원문 대응·실행 참조 검사. 새 기능/실계정 검사는 아님 |

## 확인된 배포 결과 — 2026-10-27

- FE [63ce626](https://github.com/blockmonkey1992/hanq/commit/63ce62688bb217ab0d46cb80f300854a2430e4c9): Vercel 성공. 운영24개 FE자산 bytes의 SHA256이 최종 검수 후보와 일치했다.
- API [30d7376](https://github.com/blockmonkey1992/hanq_api/commit/30d7376ea8698e9847d58b99d2aead82820b4605): Render `dep-dbg18hbbc2fs739o44f0` Live. 기존 Render Free와 Supabase 구성 유지.
- migration045 `045_battle_wrongnotes.sql` 체크섬 `c57102980ea7435194ba93181ec069f409d86008697032da1658c06356d79941`. 기존44개 체크섬과 기존 테이블 권한 불변, 새 제약·인덱스 확인. 사용자 데이터 쓰기0.
- [운영 지도](https://hanq.vercel.app/#subjects) 픽셀 확인. health200, 익명 battle history/wrongnotes401. 운영에서 실제 사용자 대결/답안/XP를 만들지 않았다.

## 검사 근거와 한계

독립 지도 QA는375×667/390×844/360×640/1156×838/1440×900,6메뉴·4캐릭터·이탈 정리·reduced-motion·기존 TOEIC 화면을 확인했다. 실제 전체 index/common scripts와 로컬 Nest/PGlite/SSE 두 브라우저에서7묶음10문항,9.2~9.7초 지연·응답 유실·READY·제출/완료·공격/HP·자동 진행·종료 리뷰·개인 기록/오답/정산 중복방지를 검사했다. 해당 실행 wire40건 조기 연결종료0·브라우저 오류0이었다.

근거 산출물은 작업 공간 `deliverables/map-renewal/REPORT.md`, `source-manifest.json`, `release/deployment.json`, `release/live-assets.json`, `release/migration045.json` 및 별도 `independent-map-20261027/INDEPENDENT-REPORT.md`다. 이 로컬 QA 산출물은 저장소의 공개 자산으로 복사하지 않았다. 물리 iPhone/Safari·네이티브 PostgreSQL 다중 프로세스·장기 운영 부하 검사는 이 결과에 포함되지 않는다.

초기 API push는 목적지 승인 심사로 실행 전 거부됐으며 정확한 두 저장소/dev의 새 사용자 승인 후 한 번 재시도해 완료했다. 실패한 공개65초 프로브는 재시도하지 않았다.

## 문서 정리 결과와 향후 업무

최초 문서 입구 정리에서는 기존 기록을 유지하고 전체3문서·버전별3문서·README 입구·AGENTS/CLAUDE 문서 규칙을 추가했다. 문서 변경은 기능 배포 결과를 소급하여 바꾸지 않는다. 문서 커밋은 Git 이력으로 식별하며 새 제품 릴리스 태그를 만들지 않는다.

다음 후보는 실기기 재생 검사, 다중 인스턴스 준비, 반복 대결 보상 악용 정책이다. 효과음·무지개마을 실제 기능은 계획이지 완료가 아니다. [계획](plan.md)과 [진행](progress.md)을 갱신한다.

<a id="consolidation"></a>
## 기존 문서 통합·제거 검증 (2026-10-27)

중복된 파일을 archive로 옮기지 않고 현재 기획·설계와 아래 버전 결과로 통합했다. 원문은 이 저장소의 이전 원격 커밋 `8ecbfc02fde558b17523f111f0d253de2e37cf60`에서 복원할 수 있다. 현재 트리에서 제거한 파일은 모두 이 커밋에 추적돼 있었으며 미추적 유일 자료는 삭제하지 않았다. 아래 대응은 옛 파일의 내용 범위이며 과거의 수치/준비중/미배포를 현행 완료 사실로 승격하지 않는다. 당시 검사 세부는 Git 원문에서 확인하고 현재 검증은 이 보고서의 배포·한계 항목을 따른다.

<details>
<summary>기존 파일별 통합 대응표</summary>

| 제거한 기존 파일 | 현재 내용 위치 |
|---|---|
| `battle-island.md` | [통합 설계: 전투 전송·판정·개인 오답 계약](../../design-development.md#battle) |
| `battle-push.md` | [통합 설계: 전투 전송·판정·개인 오답 계약](../../design-development.md#battle) |
| `battle-wrongnotes.md` | [통합 설계: 전투 전송·판정·개인 오답 계약](../../design-development.md#battle) |
| `cbt-source-validation.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `cbt-stars-reviews.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `database-verification.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `email-availability-20261022.md` | [통합 설계: 로그인·체크·본인 집계](../../design-development.md#identity) |
| `goryeo-recall-seed.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `history-read-performance-20261022.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `joseon-recall.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `lc-audio-files-20261022.md` | [통합 설계: LC 중계·대본 계약](../../design-development.md#audio) |
| `lc-player-script-20261022.md` | [통합 설계: LC 중계·대본 계약](../../design-development.md#audio) |
| `local-release-20261008.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `local-repository-migration.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `paraphrasing-20261022.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `part5-option-study-20261023.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `personal-review-profiles.md` | [통합 설계: 출처 결합·공통 복습·조회 비용](../../design-development.md#content) |
| `seven-day-login.md` | [통합 설계: 로그인·체크·본인 집계](../../design-development.md#identity) |
| `source-blank-progress.md` | [통합 설계: 미니모의·무료 테스트 이용권·원문 호환](../../design-development.md#mini) |
| `study-activity-20261023.md` | [통합 설계: 로그인·체크·본인 집계](../../design-development.md#identity) |
| `test-free-premium.md` | [통합 설계: 미니모의·무료 테스트 이용권·원문 호환](../../design-development.md#mini) |
| `vocabulary-mini-20261024.md` | [통합 설계: 미니모의·무료 테스트 이용권·원문 호환](../../design-development.md#mini) |
| `word-checks-20261022.md` | [통합 설계: 로그인·체크·본인 집계](../../design-development.md#identity) |

</details>

원문/학술 출처·실행 계약·운영 매뉴얼과 스크립트 입력/생성 대상은 사용처를 확인해 유지했다. JSON·법적 고지·코드·마이그레이션·사용자 데이터는 이동/수정하지 않았다.

통합으로 현재 트리에서 제거한 Markdown은23개, 유지한 상세 계약/운영/출처 Markdown은14개다. 기존 JSON은 전부 제자리에 유지했다. 새 기획3문서와 버전3문서가 기본 읽기 경로다.


## 10/27 개발 기간 무료 프리미엄

개발기간 정책은 HANQ_DEVELOPMENT_PREMIUM_OPEN=false로 해제할 수 있다. 운영 기본은 개방이며 테스트 기본은 기존 정책을 유지한다. 회원의 active는 실효 접근, paidExpiresAt/entitlementActive는 기존 유료권 상태로 구분한다. 새 구매 및 테스트 이용권 발급은 막고 기존 결제 확인·권리 이력은 보존한다. 프런트는 회원가입/마이페이지에 개발기간 무료 안내를 표시한다. 기존 관리자 검사와 개인 기록 소유자 검사는 변경하지 않았다. 테스트는 합성 계정이며 실사용자 데이터나 결제·권한을 수정하지 않았다. 실제 iPhone은 미검증이다.


## 10/27 전투 백그라운드 진행 복구

독립 QA가 운영 기준6bea699/15def62에서 렌더러 중단 시 다음 ready 정체·60초 후 자료 준비 무효, 숨김 중 복구 창 만료 후 복귀 미시도를 재현했다. 원인은 비LC 다음 문제까지 클라이언트 연출/ready ACK에 의존한 서버 전이 및 만료 recoveryEnd가 복귀 재시도를 차단한 분기다. 수정은 서버 문제 시각과 표시 연출을 분리하고 정상 스트림을 보존한다. 최초 양쪽Ready, LC의 양쪽 다운로드/해시·메타데이터 준비, 실제 단절의 서버10초 유예, 도주/점수 규칙은 유지한다. 실제 OS Alt+Tab/iPhone 실기기는 아직 검증하지 않았다. 수동 진화·관리자 reset·새 스키마는 포함하지 않았다.


## 10/27 동시 대결 신청

기존 서버는 직렬화된 두 번째 교차 신청을 battle_busy409로 거절했고 FE는 이를 연결 실패로 표현했다. 같은 두 명·같은 과목은 현재 방으로 수렴시키고 새 requestId는 비공개 state에 보존한다. 동일 ID 재전송은 종료된 원래 방을 반환하며 자동 새 경기나 수락을 만들지 않는다. 다른 상대 경기/다른 과목은409로 유지하고 FE는 신청 충돌 안내로 구분한다. 수락 직후 도착한 시작 전 취소도 XP0 취소로 수렴한다. 0점 감사 행은 남기며 실제 XP 적용량은0이다. 권한·스키마·실사용자 기록 변경은 없다. 네이티브 Postgres 병렬 접속은 미검증이며 PGlite 실제 SQL 트랜잭션+HTTP동시 요청 검사다.


## 10/27 최초 준비와 선착순 신청 보완

첫 Ready 전에도 LIVE5초/GRACE10초를 적용해 두 창의 정상 지연 진입을 도주로 오판할 수 있었다. 초기 ready/index0/start없음은 자료 준비로 분리하며 준비 마감60초 후 materials_unavailable 무효0만 허용한다. 이미 시작한 경기에는 기존 판정을 유지한다. 선착순 매칭은 lobby advisory lock 획득/트랜잭션 접수 순서로 첫 요청의 요청자·수락자를 확정한다. 늦은 교차 요청의200 응답은 최초 초대 상태일 뿐 새 신청 생성이나 자동 수락이 아니다. 기존 사용자의 과거 경기/XP는 수정하지 않았다.


## 10/27 정적 전투 능력치 간격 축소

능력치 데이터만 줄였다. 같은 단계는 대략 10~11타, 한 단계 높은 쪽이 아래를 공격하면 대략 5타로 검사됐다. 이는 피해 공식을 조정하기 위한 목표가 아니라 결과 기록이다. 극단에서는 워그레이몬→깜몬 피해 71로 한 번에 이길 수 있고, 반대는 피해 1로 380타다. 기존 최소 1 피해식을 유지한다. LUK 기본률과 공격 단계 나눗셈, 단계별 XP 보상과 성장 임계는 그대로다. 파닥몬 계열은 기존 단계 매핑을 유지하고 같은 서버 정적 표를 읽는다. 전투 툴팁은 서버 스냅샷을 사용하며 랭킹/마이페이지에 별도의 HP/ATK/DEF 표를 추가하지 않는다. 실제 사용자 기록은 변경하지 않았다.


## 10/27 한국사 CBT 회차 최초 보상과 XP 바

신규 정책 식별자는 round-first-score-bands-v1. 첫 최종완료를 계정·회차 기준으로 판정하고, 실제 적용 XP와 원래 정책량을 저장한다. 과거 완료는 이미 사용한 회차로 취급하되 기존 결과·원장은 수정하지 않는다. 60점은+3, 기존0하한 유지. 속도감지·보상보류·회수는 추가하지 않았다. 실제 사용자 기록 변경 없이 합성 검증했으며 네이티브 PostgreSQL 동시 부하 및 실기기 iPhone은 미검증이다.


## 10/27 관리자 총 XP 표시·조정

조정은 과거XP를 고치지 않고 신규 admin-adjustment 원장으로 누적한다. 입력은0제외±1,000,000 정수/사유300자/예상총XP/요청UUID이며, 현재총XP가 달라지면409로새확인을요구한다. 계정잠금·요청잠금으로한번만반영하고 실제delta는0하한까지, 변경전후·관리자·사유·시각을append-only감사표에보존한다. migration046_admin_xp_adjustments.sql은 조정표와기존growth원장nullable참조/검증분기만추가하며역사값·권한/RLS·인증정책은바꾸지않는다. 보류중진화migration046은운영미적용이므로이번번호와같이배포하지않는다. 나중진화재개시새번호로검토해야한다. 실사용자XP조정은하지않았고실물iPhone/네이티브PG병렬부하는미검증이다.

## 무지개섬 컬렉션 로컬 결과

추가052와 collection 단일 서비스에 소유·XP·장착·진화·재시도를 모았다. 실제 PostgreSQL 경합 검증과 기존 테스트 비교 근거는 progress에 기록했다. API `ed08c11` 이후 커밋으로 전달하며, `94f0e4a` 점유 검사 추출 및 draw 보완은 통합 담당이 병합한다. 원격 push·서버 배포·운영 DB 변경은 미실시다. 운영 fbcc866에는 새 계약이 없으므로 FE가 알 수령/장착을 비활성화하는 것이 현재 정상 상태다.

## 10/29 독립 통합 결과

무지개섬98ea8a9·약공격/draw·legacy session 호환을 합쳤다. 단위286 pass/3 skip, 실제 PG 컬렉션/무승부 경합 통과, 기존 통합60 pass/6 baseline fail을 구분했다. 기존 migration 변경 없이050~053을 로컬 적용했다. runner Offline으로 운영 서버 반영은 미완료이며 원격 push/운영DB 변경은 없었다.

## 2026-10-30 알 구매/60초 부화 로컬 결과

이전050~054/개체XP 구현을 보존하고055에서0Coin 상품과 서버 부화 시각을 추가했다. 같은 계열은 한 번만 구매하며 첫 장착 뒤60초를 재선택/재접속으로 초기화할 수 없다. 알의 XP수동부화를 폐기하고, 알 장착 중 출석/풀이XP도 보존한다. 기존누적1199·신규첫1000·단일장착·계정합계·중복재생·전투경합을 실제 격리 PostgreSQL로 검증했다. 세 collection/timed native suite와 사이트초대5/5 통과, CI필터 단위275pass/3skip, 원본동일 통합60/66(기존6실패), 수정파일 lint/타입/빌드 통과다.055 rollback 및 기존 원장 fingerprint 보존도 통과했다. 이 항목은 구현/로컬검수 결과이며 운영 적용 완료를 뜻하지 않는다. push·설치된배포경로·운영schema/API 검증은 최종 통합 보고를 확인한다.


### 2026-10-30 실제 FE/API 연결 검수 및 배포 경로

로컬 Nest collection HTTP와 독립 native PostgreSQL에 실제 FE를 연결해 Chrome/WebKit × 320/390/1440 6조합 통과했다. 인증은 합성 계정 adapter, 무관한 패널은 빈 fixture이며 구매/보관함/장착/부화는 실제 API·DB다. 응답 유실 후 동일키 재시도, 오프라인 조회 실패 후 online 복구, 새로고침 기한 보존, 계정 전환 중 지연된 구매 응답 격리와 XP 합계 불변을 확인했다. Chrome390은 실제 60초를 기다려 자동 부화를 확인했고 나머지는 주입된 서버 clock 경계를 사용했다. 새 테스트 lint0, 전체 lint161오류는 기준181오류와 비교해 새 오류 종류0이다.

운영 확인은 읽기 전용이다. 운영 /me/partners404, FE buildId f418f96. home-deploy db551c67의 설치된 배포 컨트롤러는48개 동형스키마 이미지 교체만 허용하며54개 후보를 실행 전에 거부한다. 신뢰 이미지 제작/전달·54개 schema adapter 설치/승인 manifest·새 bootstrap이 없는 상태다. Windows 직접접속·보안설정 변경·운영 DB 쓰기를 하지 않았다. 원격 후보 커밋과 실제 운영 배포는 구분한다.

## 2026-10-30 · 백엔드 Lint Gate 수정

원격 후보18fdbb06의 Actions40992527440에서 확인한161개 lint 오류를 수정했다. CommonJS Node 도구에만 sourceType/commonjs와 실제 Node 전역을 적용했으며, TS의 no-explicit-any·no-var·prefer-spread·no-control-regex 규칙과 전체 CI gate는 유지했다. 랭킹 projection/cache와 테스트 fixture를 구체 타입/unknown 경계로 바꾸고 닉네임의 C0·마크업 검사를 의미가 같은 문자 검사로 교체했다. 채점 함수는 let/const 및 spread로 정리했다.

전체 lint 오류0/경고0, typecheck/build 통과. 전체 단위292개 중289 pass/3 기존 조건부 skip/실패0(HANQ_FRONT_DIR=통합 FE, NODE_ENV=test). C0 32문자·DEL·Unicode 40자 경계, 다자리 순서·기호·잘못된 구분자, 복수답의 중복/누락/추가/공백 모호성 회귀 검사를 포함했다. 최초 sandbox loopback EPERM 뒤 로컬 HTTP를 허용한 동일 테스트에서 통과했다. migration001~055와 운영 DB는 바꾸지 않았다. 이 수정의 원격 커밋·정확한 SHA CI 결과는 push 후 확인하며 CI 성공을 운영 API 배포로 취급하지 않는다.

## 2026-10-30 · 검증된 후보 이미지 제작 경로

Lint 수정 커밋a28c358f95d85e1571d81f9ae0821c44fa79b5b3의 원격 Actions40996704626은 typecheck·unit(281개 중278 pass/3 skip/실패0)·build·lint 전체 성공했다. 뒤이어 production 접속이 없는 release-image job을 같은 CI에 추가했다. independent 성공 뒤 신뢰 저장소의 push/workflow_dispatch에만 실행하며 PR은 이미지를 만들지 않는다. official Node24 amd64 digest a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0을 고정하고, allowlist Docker context·nonroot runtime·승인 bootstrap 필수 CMD를 사용한다.

이미지는 network:none/read-only/nonroot에서 argon2·bootstrap import·migration/checksum 검사를 통과해야 하며, private Actions artifact에 docker-load용 archive와 source SHA·run ID·image ID·archive SHA256·54개 SQL/privileges checksum을 함께 보관한다. 외부 registry push, 운영 DB 접속, Windows 설치·start/stop은 없다. Mac의 Docker daemon은 꺼져 있어 직접 이미지 빌드는 하지 않았다. config/lint/typecheck/build는 로컬 통과했고 실제 image build/archive·upload 결과는 이 코드가 올라간 정확한 SHA의 CI에서 따로 확인한다.

기존 Windows controller는 48개 동등-schema image-only 계약이다. 이 이미지 artifact를 만들었다는 이유로 schema-release adapter/bootstrap 설치·기존 environment/admin gate가 해결됐다고 취급하지 않는다. 별도 Windows 설치본 확인과 승인된 schema 변경 경로가 여전히 필요하다.

## 2026-10-30 · 세 단계 검토와 최종 실제 화면 연결

검토1은 서버·DB 원자성과 데이터 보존이다. native PostgreSQL의 중복/동시 구매·장착·XP/60초 경계, 17개 schema 실패/보존 사례와 네 번의 실제 dump/격리 restore 비교를 유지했다. 계정 XP 합계, 첫 파트너1000, 새 알0, 보관 개체 XP 불변을 검사했다. 기존 전체 통합66개 중60 pass/6 baseline fail은 계속 구분한다.

검토2는 Chrome/WebKit320/390/1440의 게임 장면·보관함·캐릭터·아이콘·접근성이다. FE의 실제 외부 CSS를 로드한 화면에서 모션 custom-property URL이 /media/media로 해석되어 상대가 안 보이는 결함을 발견해 FE에서 절대 경로로 수정했다. 합성 gallery의 addStyleTag만으로는 이 문제를 발견하지 못했으므로 실제 외부 CSS와 실제 API 화면 검사를 추가했다. 파닥몬 대기·전투의 날개 색도 승인된 보라색으로 맞췄다.

검토3은 수정 후 실제 통합 재검사다. 실제 Nest collection/battle HTTP와 disposable native PG에서6개 브라우저/폭 조합을 다시 통과했다. 응답 유실 후 같은 키 재시도, 계정 전환, 시계 조작, 오프라인/재접속, 실제 wall60초 자동 부화와 두 계열의 UI 구매·장착·전체5단계 진화를 확인했다. 성장기/최종 단계 네 번의 실제 연습 문제 제출과 전투 연출에서 양쪽 모션 이미지의 computed URL이 실제200이고 /media/media가 아님을 검사하고 픽셀을 확인했다. 파닥몬 새 액션 사용도 검사한다. 합성 시험 원장으로 계열별1800XP를 지급했으며 첫 파트너1000과 합계4600은 보존됐다. 합성 인증 어댑터와 범위 밖 빈 패널 fixture는 실제 인증/학습 패널 운영 검증과 구분한다.

QA launcher는 독립 임시 port와240초 한계를 사용한다. embedded-postgres exit hook이 자연 beforeExit에서 process.exitCode를 덮는 문제를 실제 의도적 child 실패로 확인해, PG cleanup 후 명시적 exit1 전파를 검증했다. 초기 fixture의 legacy family/서버 준비시각 가정 실패는 UI 요청과 서버 응답 시각을 따르게 고친 뒤 재검사했다. 실패 로그를 성공으로 계산하지 않았다.

최종 로컬 전체 단위292개 중289 pass/3 조건부 skip/실패0이며 lint/typecheck/build를 유지한다. a28c358 Lint Gate 및 e9e42b4 image producer는 원격 CI 전체 성공했고 신뢰 artifact12951653564가 생성됐다. 이 QA 수정 커밋의 정확한 CI/이미지는 push 후 별도 확인한다. 실제 운영 DB·Windows·production FE 변경은 아직 없다.

## 2026-10-30 · 기준 통합 검사 6건 유지보수 완료

이전 e9c5d76/af24744 검수의66개 중6개 실패는 현 정책을 반영하지 못한 테스트 기대값이었다. 운영 코드·지급/채점 정책·SQL migration을 바꾸지 않고 네 통합 검사와 명시적 migration fixture만 보완했다. 모의 문항 보상은 실제 FE fixture의 원래1~3점으로 독립 계산하고 서버 응답을 보상 기대값으로 재사용하지 않는다. 3점 문항을 골라 잔고3의 동시 차감이 -3/0이 되는 zero-floor 경계를 유지했다.

출석은 count를 느슨하게 늘리지 않고 signup1000/attendance10/study[-100,100]/CBT50, KST 날짜별 출석 event_key/FK와 합계1060을 각각 검사한다. migration-manifest-20261030.json은 검토된54개 파일명·SHA256 및 repeatable privileges SHA256을 고정한 독립 oracle이다. 파일 자체의 정확한 목록/bytes와 DB 적용 목록/checksum을 비교하며 재실행 때 applied=[]·정확한 개수·기존 applied_at 불변까지 확인한다.

동일 submissionId의5개 동시 요청은 단일 attempt, 원장 단일 practice행, fixture 배점에 따른 정확한 총XP, 최초1/재생4, 이후3회 재시도와 충돌409 뒤 attempt·원장 snapshot 불변까지 모두 도달했다. 첫 재검사는65/66으로, 뒤쪽의 CBT 구형 -100 기대가 현 첫 회차 score0 보상 -10과 달라 드러났다. 이를 독립 score0/-10/잔고하한-3 기대로 고친 뒤 현재 owned XP>=0 보호가 과거 음수 원장 fixture 생성을 막는 것도 확인했다. 이 보호가 먼저 실패하는지 savepoint로 검증한 뒤, 과거 ledger-only 상태를 격리 DB transaction 안에서만 재현하고 migration015의 거부·ROLLBACK 후 두 guard 복구·XP/원장0·append-only를 확인했다. 실제 코드 결함을 숨기거나 보호 assertion을 skip하지 않았다.

최종 동일10개 파일의 통합66/66 pass, fail0/skip0. 전체 로컬 단위292개 중289 pass/3 기존 조건부 skip/실패0, 전체 lint/typecheck/build 통과. 과거 실패 로그는 이력이며 현 후보의 남은 실패로 보고하지 않는다. 근거: 작업폴더 evidence/api/integration-maintenance-{1,2,final}.log와 unit-integration-maintenance.log. 테스트 유지보수 커밋을 push한 뒤 정확한 SHA의 CI와 image/archive 식별을 갱신한다. GitHub CI는 기존 private FE fixture 경계를 유지하므로 이66개 DB 검사는 로컬 native PostgreSQL 근거와 구분한다. Windows·운영·Library 업로드는 하지 않았다.
