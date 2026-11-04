# API 실제 진행 상태

현재 버전 폴더 `v0.1.0`은 API의 기존 `package.json` 버전 `0.1.0`을 기준으로 한 문서 기준선이다. FE에는 별도 패키지 버전이 없고 두 저장소 모두 Git 릴리스 태그가 없다. 새 제품 릴리스를 선언하거나 태그·패키지 버전을 변경한 것이 아니다. 배포 식별은 아래 정확한 커밋을 사용한다.

## 현재 상태

2026-10-27 기능 배포는 완료했다. FE `63ce62688bb217ab0d46cb80f300854a2430e4c9`, API `30d7376ea8698e9847d58b99d2aead82820b4605`가 각 저장소 dev 및 운영 배포와 일치했다. migration045 적용 후 체크섬·제약·인덱스와 기존 테이블 권한 불변을 확인했다. 사용자 답안/XP 테스트 쓰기는0이다.

지도5규격과 전체 앱 두 브라우저·로컬 Nest/PGlite/SSE 지연 회귀 및 독립 QA가 검증 범위 내 통과했다. 실제 iPhone/Safari 검사는 미실행이다. 첫 문서 입구 정리 뒤 사용자 요청으로 기존 설명을 현재 설계에 통합하고 Git 원격에서 복원 가능한 중복 파일을 제거했다. 링크·원문 대응·문서 전용 diff 검사를 통과했다. 문서 커밋/원격 SHA는 Git과 최종 작업 결과 보고로 확인한다. 기능 코드/데이터 재검사가 아니라 문서 구조 검사다. 문서 커밋/push의 정확한 상태와 SHA는 Git 이력 및 작업 결과 보고로 확인한다.

## 다음 작업

이번 문서 통합의 링크/원문 대응 검사는 완료했다. 이후 기능 작업은 아래 미완료 후보를 별도 승인/검수로 다루고 실제 Git 커밋/원격 상태를 기록한다. 문서 작업에 DB migration·seed·실사용자 기록 변경은 필요 없다. 향후 기능은 plan의 미완료 후보와 별도 사용자 지시로 구분한다.

[계획](plan.md) · [결과·한계](report.md)


## 10/27 개발 기간 무료 프리미엄

로컬 정책·화면 검사를 완료했다. API 258개 통과·3개 기존 조건부 검사 건너뜀, 별도 실제 Nest HTTP·합성 PGlite 검사에서 신규/기존/만료/유료 회원, 익명401, 이용권·결제·권한·XP 원장 불변과 정책 해제를 확인했다. 전체 앱 합성 API 화면6케이스도 통과했다. 아직 이 기능의 push/운영 반영은 최종 배포 확인 전이다.


## 10/27 전투 백그라운드 진행 복구

별도 작업 트리에서 수동 진화 미커밋을 제외한 연결 수정을 검증 중이다. API262개 통과/기존조건부3개 건너뜀. lifecycle 숨김17초·75초 검사는 통과했지만 실제 JS 중단 증거와 구분한다. 실제 Debugger.pause70초 동안 서버의 다음 문제·마감 진행과 복귀 현재 상태를 확인했다. 복구 창 만료 뒤 정상 snapshot 재수신/옛 오류 제거, 봇의 실제 서버 진행·XP0, LC hidden 상태의 실제 파일/해시/메타데이터 준비·Audio.play 성공·1배속도 통과했다. LC의 실제 OS 프로세스 중단 재생은 보장하지 않는다. 아직 이 수정은 미배포다.


## 10/27 동시 대결 신청

연결 후보3a66e6c/ac44721은 그대로 보존했다. 후속 동시 신청은 기존 lobby advisory lock 안에서 같은 방을 반환하고 요청ID 재처리를 서버에 저장한다. 최초 수락·양쪽Ready 규칙은 유지한다. 실제 Nest+PGlite의12회 동시 HTTP에서 교차/4중 재전송·취소/수락·만료·다른 상대/과목 방어·종료 후 재전송과 점수 변동0을 확인했다.


## 10/27 최초 준비와 선착순 신청 보완

수락 후 첫 Ready 전까지는 연결 grace를 적용하지 않는다. /me9.3초 순차 진입의 두 브라우저가 준비/XP0을 유지하고 이후 정상 진행하는 전체 앱 검사가 통과했다. 60초 준비 만료 및 이전 초기 grace도 실제 서버·DB에서 무효0으로 확인했다. 실제 시작 후 유예/도주·XP 규칙은 보존한다.


## 10/27 정적 전투 능력치 간격 축소

정적 표를 50/10/5 →75/15/8 →113/23/11 →169/34/17 →253/51/25 →380/76/38로 바꿨다. 각 원래 깜몬 수치×1.5^단계를 반올림한 값이다. API264개 통과/기존조건부3개 건너뜀. 실제 PGlite+BattleService에서 신규 유저/봇113/23/11, 기존100/25/10 경기의 피해15 유지, XP불변을 확인했다.


## 10/27 한국사 CBT 회차 최초 보상과 XP 바

구현 및 합성 검증 완료. 실제 CbtService·저장소·PGlite에서 경계점수8개, 동일 실행 중복3회, 같은 회차 동시 실행, 다른 계정, 과거 완료 및 XP 보존을 확인했다. API 단위266통과/조건부3건 건너뜀. FE 전체 index 스타일·캐릭터 렌더러12상태에서 XP 바34px·라벨투명·중앙정렬 통과. 운영 반영은 배포 근거로 별도 확인한다.


## 10/27 관리자 총 XP 표시·조정

관리자 XP만 운영 기준에서 별도 작업 트리로 분리했다. API267개 통과/기존조건부3개 건너뜀, 실제 migrator/PGlite의 실패rollback·재시작no-op·기존원장보존, Nest/PGlite의 권한·검증·중복·경합·0하한 검사 통과. 전체index와 실제Nest/PGlite 두브라우저에서9.3초지연·명시확인·응답유실후같은요청재확인·개인총XP갱신과모바일 검사를 통과했다. push/운영반영은 배포확인으로 구분한다.

## 10/28 본인 통합 기록·한국사 모의고사 배틀

기존 저장 자료만 읽는 본인 기록 API와 한국사 mock 출제를 구현했다. 실제 migrations 001–046을 적용한 새 PGlite와 실제 BattleService·문제 풀·아카이브·기록 서비스에서 양쪽 답안 분리, 재접속 동일 마감, 중복 제출 1회 보존, mock 5보기·공통 이미지·해설과 기존 가입 XP 보존을 확인했다. 별도 SQL fixture에서는 전체 원천·동률 페이지·반복 시도·늦은 오프라인 수신·검증 실행 제외를 확인했다. 현재 카탈로그의 mock 500건이 모두 남고 원본 그림이 존재한다. 변경한 소스/검사 파일 lint는 통과하며 전체 lint의 기존 83개 오류는 기준본과 같다. 스키마 변경은 없고 미커밋 melee/migration047 작업은 포함하지 않았다. 운영 배포 확인은 별도 근거로 구분한다.

## 10/28 출석 10XP 별도 후속

API `797fbec7`에서 시작한 별도 후속 변경이다. 보상이 없던 기존 출석에 신규 KST 출석당 10XP를 추가했다. 실제 migrator/PGlite에서 048 1회 적용·재실행 no-op·기존 XP 보존·소급 지급 없음·첫 지급/반복/24개 대기열 동시 호출·KST 자정·잠금 뒤 시각·원장 실패 롤백·응답 유실 재시도·50XP 제약 거절을 검증했다. 네이티브 PostgreSQL 다중 연결 경쟁 검사는 로컬 서버 부재로 실행하지 않았다. 현재 원격 배포는 커밋/push 뒤 별도 확인한다.

## 10/28 확정 연속 출석 5일 주기

고정10 API a78d902는 중간 상태로 운영 반영됐다. 이후 확정한 10/20/30/40/50 반복과 결석 초기화를 별도049로 구현했다. 048은 수정하지 않았다. 실제 SQL에서 1–11일·결석·KST경계·24개 대기열 호출·응답유실 재시도·롤백·이전10XP 보존을 확인했다. API 단위280통과/조건부3건 건너뜀. 네이티브 PostgreSQL 다중 연결 경쟁은 미검사다. 운영 최종 반영은 별도 배포 확인으로 구분한다.

## 10/28 수동 진화·얼음섬 수락 리뉴얼

미배포 수동 진화 원본의 XP 무소모·한 단계·revision/요청 영수증 규칙을 정식 050으로 통합했다. 051은 탭별 25초 lease, 수락된 경기와 pending 요청 분리, 연습전 subject를 추가한다. 신청·수락·퇴장과 교차/중복 요청을 서버 잠금으로 검증한다. 초대는 10초, 문제 풀이는 기존 30초다. 한국사 연습봇은 기존 빈칸/실전 모의 bank와 XP 0 기록을 재사용한다.

실제 Nest HTTP/SSE + 격리 PGlite 및 네이티브 PostgreSQL 독립 연결에서 초대 3개, 동시 수락 1건, 교차 요청, 퇴장 경합, 다중 탭, TTL, 서버 만료, XP 임계값/중복키/동시 revision/초과 XP/최종 단계/소유자 분리를 검증했다. 로컬 Chrome 4클라이언트에서 모달 대기열·거절→다음 요청·수락→전투·새로고침 복구와 서버 형태 버튼을 검증했다. 기존 운영 fbcc866 복제 API와 FE 호환 수락 모달도 별도로 확인했다. 전체 API unit 280통과/조건부3건 건너뜀. 추가 요구 후 최종 재검증 결과는 종료 보고에 기록한다.

운영 API 배포는 집 runner offline으로 미완료다. Windows/운영 DB/Render/Supabase에는 접근하지 않았으며 기존 checksum과 미배포 047은 수정하지 않았다.

## 10/28 독립 API 통합 검수·정리

원저자 체크아웃을 수정하지 않는 별도 복제본에서 `ed08c11`을 검수했다. 실제 로컬 PostgreSQL의 독립 연결로 다중 초대·원자 수락·교차 요청·만료·다중 탭·leave 경합·수동 진화 중복/revision/임계/초과 XP 보존·한국사 봇 XP 0을 확인했다. PGlite 테스트 어댑터에 seedQuestions가 요구하는 connect/release를 제공해 문서의 기본 검수 명령도 끝까지 실행되게 고쳤다. 제품 DB 코드는 이 어댑터를 사용하지 않는다.

신청과 수락의 동일한 활성 경기 SQL을 `hasActiveBattle`로 추출했다. SQL·잠금·실행 순서·에러 계약은 보존했다. 최종 정적 검사와 단위 280 pass·3 skip, 실제 PostgreSQL 경합 재검증을 모두 통과했다. macOS 검수에는 `HANQ_FRONT_DIR=../integration`과 canonical `TMPDIR=/private/tmp/hanq-task9-canonical-tests`를 사용한다. 기본 tmpdir의 /var↔/private/var 별칭 차이는 교재 fixture 경로 검사 실패 원인이었고 제품 코드를 변경하지 않았다.

DB 63표·90외래키·기존 48 migration 불변을 빈 로컬 DB로 조사했다. 운영 DB 행 수/쿼리 빈도는 미조사다. 단순화 후보·보존 이유·되돌릴 수 있는 source 상태 전환 설계는 design-development.md에 기록했다. API 운영 배포는 runner offline 상태 때문에 완료로 표시할 수 없으며, 원격 push·배포·운영 스키마/권한 변경을 하지 않았다.

추가 요구 대조에서 양쪽 오답 약공격 및 동시 KO 무승부가 현재 rules/service/rewards/DB outcome에 없음을 확인했다. 실제 함수를 실행한 근거는 작업 폴더 evidence/missing-battle-rules.json에 있다. 두 오답은 none·0피해이고 양쪽 HP0을 주입하면 right 승리로 판정한다(현재 정상 경로에서 양쪽 동시 피해 자체는 생성되지 않는다). 최소1 일반 피해는 구현돼 있다. 별도 규칙·이벤트·보상·FE 종료/기록·새 migration 범위로 처리해야 하며 이번 중복 추출에 섞지 않았다. 새 LobbySession.sessionId 필수 DTO는 구 FE의 오래 열린 탭과 호환되지 않으므로 실제 API 배포 전에 한시 호환/명시적 새로고침 경로 검증이 필요하다. 출석 반복/리셋은 실제 SQL의 1~11일 및 하루 공백 12사례로 추가 확인했다.

API lint는 원본 ed08c11과 현재 모두 153개 기존 오류로 실패한다. 파일·규칙·메시지별 비교가 동일하며 변경한 제품 파일 src/battle/service.ts는 오류 0개다. 추가한 CommonJS 로컬 검수 스크립트에는 실행 환경을 명시해 새 오류를 남기지 않았다(evidence/api-lint-comparison.json). 전체 lint 통과로 보고하지 않는다.

## 10/28 후속 구현 — 약공격·draw·legacy session

부모가 전달한 원문에 따라 P1 두 건을 실제 수정했다. 약공격은 `max(1,floor(normalDamage/3))`, 독립 회피, 동시 HP 적용이며 double_ko는 finished/draw와 양측 XP0이다. 실제 native PostgreSQL에서 두 HTTP 답안의 경합·원장2행/성장 지급0·8회 동시 재조회·종료 재요청·서비스 재구성·양측 기록/복기/MyPage·타인404·봇draw를 확인했다. 기존 한쪽 정답·동시 정답 상쇄·소수점/최소1·미응답·양쪽 회피·한쪽 KO·후속 문항 취소 단위검사도 포함했다.

API 단위는286 pass/3 skip/0 fail, build/typecheck 통과다. 기존 native 대기열·다중 탭·진화·봇 검사도 재통과했다. 실제 구 FE 192ad57의 battle-island.js 두 탭을 새 API에 연결해 sessionId 없는 enter/lobby/leave가 동작하고 한 탭 나가기로 다른 구 탭과 신 탭의 lease를 지우지 않음을 확인했다. 과거 presence만 있는 배포 중간 상태·키 오류/null·인증 없음·TTL도 확인했다. 실제 전체 FE+로컬 API+SSE의390/1440px에서 입장/수락/레디/제출/약공격/draw/복기까지 통과했다. 합성 스냅샷 UI9개 경우에서 긁기/몸통박치기·HP 동시 갱신·중복 스냅샷·축소 모션·중단 정리를 확인했다.

근거: task-9/evidence의 weak-native.log, weak-draw-api/, weak-unit.log, weak-draw-ui/, full-app-weak/, legacy-client/, weak-normal-invariants.json. 마이그레이션053만 추가했고 운영 적용은 하지 않았다. 장착 디지몬/052 최종 통합은 전달 대기이며, 이 단계에서 기존 전체 XP와 장착 XP가 같다고 가정하지 않는다. 새 제품 코드의 제한 lint는 통과하며 저장소 전체 기존153개 오류는 별도다.
## 10/28 무지개섬·디지몬별 성장 — 로컬 통합 대기

기준 `ed08c11`, 신규 migration052만 추가했다. 첫 XP 이관·신규 가입1000·추가 알0·1마리 장착·계정합계·원장 중복 지급 방지·개별0하한을 구현했다. 대전은 장착한 모습/단계를 조회하도록 연결했고 결과·draw·원장 outcome은 수정하지 않았다. 랭킹도 실제 장착 모습과 합산 XP를 사용한다.

`test/local/native-collection.cjs`는 새 /tmp PostgreSQL 데이터베이스만 만들며 실제 Nest HTTP와 독립 트랜잭션으로 동일 키 수령3회, 다른 키 수령 경합, 장착 경합, 타인 ID 거부, 장착/XP 경합, 부화·초과XP·진화 revision 경합·오래된 영수증 재생, 초대 중 장착/진화 금지, 신규 가입과 DB 제약을 확인했다. 원장 행 수/기존1199XP 보존, 합계 불변, 중복 보너스 없음이 통과했다.

build 및 단위283개 중280 통과/3 조건부 skip/실패0. 동일한 NODE_ENV=test·합성 로컬 DB로 기존 통합10개 suite를 비교해 기준 ed08c11과 변경 버전 모두66개 중60 통과/6 실패였다. 실패 이름도 같고 기존 mock 가중치±5 기대, 출석으로 늘어난 원장 수, migration15개 고정 기대가 원인이다. 새052로 인한 회귀를 기존 기대값 실패와 혼동하지 않는다. 운영 API·운영 데이터·인증정보를 이용한 시험은 하지 않았다.

부화 전 알은 대기실에 전투 가능=false·HP/ATK/DEF/LUK0으로 표시하고 실제 대결/연습 요청은409로 막는다. 새 계열의 단계별 능력치는 기존 공통 단계식을 사용하며 아구몬 전용 기술명을 잘못 붙이지 않도록 기본 타격으로 표시한다. 전용 기술·pose 연출은 후속 범위다.

## 10/29 무지개섬·약공격·무승부 독립 통합

API98ea8a9 최종 보완(알 능력치0·전투불가, 새 계열 기본 기술명)을 약공격/legacy-session 호환a45a0e8 위에 합쳤다. 별도 원저자 checkout은 수정하지 않았다. 현재 collection·profile·growth-floor·052는98ea8a9와 바이트가 같고 battle/service만 점유 공용화·양측 weak·draw·구탭 lease와 결합했다. migration050/051/052/053 순서의 disposable native PG에서 검수했고 운영 baselinefbcc866의 기존 파일은 바꾸지 않았다.

native-collection-draw는 무승부양쪽XP0·재접속/기록/MyPage·중복 정산, 대기/전투 중 장착 차단, 정산과 장착의 경합, 중복 원장1건과 한 디지몬 귀속, 패배 차감의 장착XP 하한을 검사했다. native-collection은 수령/장착/revision/초과XP/한단계진화/알전투차단을 확인했다. 전체 단위289개 중286 pass/3 skip·빌드/타입 통과. 수정 서버 파일과 신규 결합검사 lint0.

기존10개 통합 파일은 별도 ed08c11 DB와 최종 통합 DB에서 모두66개 중60 pass/6 fail이었다. 실패6개를 직접 대조했으며 growth-floor의 과거 고정-3, practice-growth2개의 고정±5, growth-history의 출석행 누락, migration2개의15개 고정 기대다. 기존 실패를 새052/053 회귀로 분류하지 않지만 전체 통합 green으로도 보고하지 않는다. 실행에는 NODE_ENV=test, HANQ_FRONT_DIR=통합FE절대경로, TMPDIR=/private/tmp, NODE_PATH=/tmp/hanq-local-test-tools/node_modules를 썼다. 기본 sandbox의 loopback EPERM, 경로·외부 FE fixture 미설정 실패는 환경을 바로잡은 후 재검증했다.

집 hanq-home-windows runner는 GitHub 설정 페이지에서 Offline으로 재확인했고 기존 control job은 queued다. 새 workflow 실행·Windows 직접접속·운영 schema/데이터 변경은 없었다. 서버 의존 기능은 운영 미완료이며 최종 큰 묶음 배포를 부모와 조율한다. 로컬 증거는 task-9/evidence의 collection-*·baseline-failure-comparison·migration-preservation-final·runner-current JSON/로그다.

## 10/29 사이트 전체 대전 초대 (로컬 검수 완료, 배포 대기)

기준 `0425314` 위에 `3ad9e45`(사이트 접속자·초대 상태·sweeper·054), `4218d1b`(lease는 탭 heartbeat로만 갱신). 통합 검사 `battle-site` 5건(학습 중 사용자 초대, 거절/취소/만료 이유, 동시 초대·다중 탭 수락 단일 전투, 전투 중·자기 신청 거절, 탭 여러 개·마지막 탭 이탈, 연타 제한, 사이트 SSE가 경기 연결에 관여하지 않음)과 기존 battle·concurrency 통과. 전체 단위/통합은 기준본과 같은 실패 집합(새 실패0). 운영 배포는 집 Windows runner offline으로 시도하지 않았고 운영 DB는 054를 받지 않았다.

## 2026-10-30 · 알 구매 오픈/서버60초 부화 · [dev/qa]

기존 e9c5d76의050~054와 collection/XP 구조를 이어055만 추가했다.0Coin 상품/별도 Coin계정과 상품 연결·장착 첫 시각/60초 기한/완료 시각을 저장하고, 소유자 잠금+계열/상품 유일성+명령 영수증을 같은 transaction으로 처리한다. 기존 고객XP·풀이·출석·전투 원장에 backfill/삭제/리셋을 하지 않았다. 수동100XP 부화는 서버에서 막고 기한이 지난 알은 인증된 조회/명령에서 완료한다. 기한은 보관 중에도 계속되고 오래된 영수증 재생은 타이머/장착/단계를 되돌리지 않는다. 화면은 purchaseEnabled/hatchEnabled와 UTC serverNow 및 상품0Coin을 보고 동작한다.

실제 독립 backend PostgreSQL에서 `native-timed-eggs`(055 DDL transaction rollback·기존 원장 fingerprint 불변·가격변조·동시구매/응답유실 재생·계정격리·59,999/60,000ms·재선택/이탈/재접속·동시조회·알 장착 중 출석1회/퀴즈XP 귀속), `native-collection`(1199XP 이관/신규1000·두 요청 장착/구매경합·XP/장착경합·단일장착 DB제약·진화·알 전투차단), `native-collection-draw`(무승부/패배하한·중복정산·기록·장착경합) 모두 통과했다.사이트초대 통합5/5, CI와 같은 필터 단위275 pass/3 skip/0 fail, 타입/빌드·수정파일 lint 통과.055 SHA256=c92d72d0220f6b12478dfc0a6298d6df42641bc28fcbedc60abcd2ddf8a5558e.001~054와 repeatable 권한 파일은 원본과 바이트 동일이다.

기존10개 통합 파일은 원본 e9c5d76와 변경본을 서로 다른 /tmp DB에서 같은 NODE_ENV=test·FE fixture·canonical TMPDIR로 실행해 모두66개 중60 pass/6 fail, 실패 이름도 동일함을 확인했다. 기존 고정 mock ±5/하한-3·출석행 누락·migration15개 고정 기대가 원인이다. 전체 lint는 원본부터 다수 실패하며 수정 서버/새 테스트에는 새 lint 오류가 없다. 최초 기본 sandbox의 shared-memory/loopback EPERM와 FE fixture 미설정 실패는 격리 DB 실행 권한 및 명시 경로로 재검사했다. 결과는 task/evidence/api에 저장했고 운영 자격증명/실사용자 데이터는 쓰지 않았다. 실제 push·운영 migration/배포는 통합 담당의 별도 커밋/배포 근거로 확정한다.


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
# 2026-11-04 Joseon Script private transport backport

Implemented an additive exact-source GET bundle/PNG controller on deployed-snapshot baseline `96c6b7a`; existing JWT/live-session and textbook membership guards are unchanged. Source inputs remain outside Git/build/static roots. See [contract and rollout evidence](../../joseon-script-transport.md). Final isolated typecheck/lint/build passed; unit suite: 301 passed, 3 optional-fixture skips, 0 failures. Original bundle and all 38 PNG HTTP hashes matched locally. Deployment/private runtime mount and real-account verification remain pending; no schema, progress or canonical quiz identity changes.
