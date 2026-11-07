# API 개발 설계

## 현재 기준

NestJS API와 PostgreSQL `hanq` 스키마를 사용한다. 기존 자체 JWT 인증·strict TLS·소유권 검사를 유지한다. 보안의 상세 기준은 [security.md](security.md), API 목록은 [api.md](api.md), 공통 학습 자료/개인 기록 계약은 [common-toeic-learning.md](common-toeic-learning.md)다. FE의 시각/상호작용 설계는 [FE 개발 설계](https://github.com/blockmonkey1992/hanq/blob/dev/docs/design-development.md)에만 둔다.

## 얼음섬 서버 권위

- 현재 전송은 인증된 same-origin SSE이며 WebSocket이 아니다. 액션은 HTTP POST, 대기 목록만 활성 시10초 갱신이다. [battle-push.md](design-development.md#battle)가 최신 전송 계약이다. 이전 [battle-island.md](design-development.md#battle)의1.5초/5초 polling 설명은 초기 구현 이력이며 현행으로 해석하지 않는다.
- 서버가 과목·문제 버전·시작/마감·능력치·최초 제출 수신 시각을 고정한다. 첫 준비 한 번 뒤 Ready 표시와3초 카운트다운, 이후 판정/연출 뒤 자동 다음 문제다. UI의 답 변경은 제출 전까지만 가능하다.
- 한국사/Part5는30초, Part6은 묶음 문항수×30초, Part7은×50초, LC는 고정된 실제 음원 duration+5초. 양쪽 음원 준비가 먼저다. 클라이언트 duration/시각/HP를 신뢰하지 않는다.
- 문항별 정오답과 최초 서버 수신 시각으로 공격권을 정한다. 정확한 동시 정답은 중앙 상쇄·HP 불변, 양쪽 오답/미응답은 무행동이다. 피해=max(1,ATK−DEF), 회피%=방어자 기본LUK÷공격자 단계. RNG는 공격당 한 번 저장한다.
- 다음 문제 전 단절 유예는 고정 최대10초/3회다. 문제 중 시간은 계속 흐른다. 정상 경기에는 임의20문제 제한이 없다. HP0/도주까지 계속하며 진행 불가 무효는 XP0이다.
- XP는 별도 원장과 유일 키로 한 번 정산하고0하한을 지킨다. 학습 이력을 덮어쓰지 않는다. 봇은 사용자별 독립 연습이고 XP·랭킹 변동0이다. 과목/접속/개인 기록 접근은 기존 인증 범위를 유지한다.

## 개인 전투 오답

[상세 계약](design-development.md#battle). migration045는 `battle_wrong_attempts`와 인덱스를 추가했다. 원본 경기/답안을 수정하지 않고 개인별 request key로 재풀이를 중복 방지한다. 같은 출처·버전의 누적 복습과 최신 출현 상태를 구분한다. 다른 계정 기록은 합치지 않는다.

## 운영과 한계

기존 migrator가 체크섬·transaction·advisory lock으로 선적용 후 listener를 시작한다. 적용된 migration은 수정하지 않는다. `docs/`의7개 JSON은 도구 근거 자료이며5개 스크립트가 경로를 참조하므로 일괄 이동하지 않는다. SSE 알림/presence는 단일 프로세스 기준이며 다중 인스턴스 전환에는 공유 조정이 필요하다. [결과·배포 근거](versions/v0.1.0/report.md)를 참조한다.

<a id="identity"></a>
## 로그인·체크·본인 집계

인증은 자체 JWT와 살아 있는 session family로 검증한다. 현재 source default 일반 access는7일(설정 상한7일)이며 opt-in `remember-90d`는 활성화된 경우 절대90일 family와 최대15분 access를 사용한다. 일반 family 기본30일과 opt-in90일을 구분하고 새로고침으로 절대 마감이 연장되지 않는다. 로그아웃/비밀번호 변경·revocation은 기존 계약을 따른다. 오래된10분 access 또는 일괄7일 로그인 안내를90일 opt-in과 혼합하지 않는다. 실제 운영 환경의 비밀 설정값을 문서에 복사하지 않는다.

이메일 availability는 기존 rate limit과 정규화로 available boolean만 제공하며 최종 중복 방지는 signup UNIQUE 제약이다. 단어 체크는 JWT 본인+revision CAS, 계정별 pending intent와 한 번의 legacy import를 사용한다. 월별 집계는 KST 월초 포함/다음 월초 미포함, 누락 월은 기존84일 호환 동작이다. 현재 성장 기록은 실제 signed delta를 읽고 오류를0으로 만들지 않는다.

<a id="content"></a>
## 출처 결합·공통 복습·조회 비용

공통 전체복습은 로그인 회원에게 같은 curated 자료를 제공하며 개인 wrong profile을 자동 등록하거나 실제 오답/점수 이력을 공용 응답에 포함하지 않는다. 기존 개인 프로필/원래 기록은 보존한다. 고려/조선 회상 문항은 선택적 카탈로그의 안정ID·원래 무료 슬롯을 유지하며 seed는 migration과 별개다. 과거 카탈로그703/752/990 등의 수치는 당시 snapshot이지 현재 콘텐츠 수라고 재사용하지 않는다.

Part5 optionStudy와 TEST1 expression links는 정확한 source hash·문항번호·stem·part·확인 정답/보기 텍스트를 결합한 채점 후 읽기 응답이다. 미검증/변경된 원문은 적용하지 않는다. Part1 책 설명과 동의어 연결, 날짜/맥락 추론, 언급되지 않은 오답을 구분한다. 창작 예문은 교육용이라고 표시하고 원본 문항/답안은 수정하지 않는다.

기록 조회는 불필요한 groups/metadata JSON을 DB projection에서 제외하고 문항 번호 map으로 조회하되 owner predicate·cursor·원본 정오답·최근 결과 순서는 유지한다. 당시 각 작업 약953KB 절감 및 합성 CPU47.6→13.8ms 측정은 운영 API 지연 개선 보장이 아니다. 실제 N+1/인덱스 근거 없이 migration을 추가하지 않는다.

<a id="audio"></a>
## LC 중계·대본 계약

LC 중계는 기존 로그인과 공유 게시자/개인 기록 분리 계약 안에서 고정 HTTPS S3 host만 허용하고 caller URL·redirect를 받지 않는다. 파일 제한과 인증 검증을 유지한다. 현재 일반 플레이어는 선택 곡 우선·나머지 순차 준비로 동작하며 옛 “모든 곡을 다 받아야 재생” 설명은 대체됐다. 페이지 캐시를 영구 오프라인 저장으로 표현하지 않는다.

player 응답은 같은 공통 기준 회차/파트/음원 그룹을 중복 제거해 반환하고 개인 실제 정오답은 덮어쓰지 않는다. 영문 대본과 ASR timing은 인간 검증/공식 대본 여부와 별개다. 정확히 매핑되지 않은 단어에 추정 timestamp를 붙이지 않는다. 과거39/22+17음원 수치는 초기 source snapshot이며 오늘 전체56음원 맥락과 구분한다. 직접 iPhone 잠금/중단·다음곡은 별도 실기기 검사다.

<a id="battle"></a>
## 전투 전송·판정·개인 오답 계약

현재 실시간 상태는 인증된 same-origin SSE다. 액션은 POST, 목록만 활성 시10초/수동/과목 변경 즉시 갱신한다. 하나의 스트림·지수 백오프/지터·in-flight 제한·이탈 정리를 유지하고 오래된 revision·역순 snapshot은 상태를 되돌리지 않는다. SSE15초 heartbeat comment는 DB polling이 아니다. 프로세스 로컬 알림/presence와 DB 지속 상태를 구분하며 다중 인스턴스는 공유 조정 전 별도 범위다.

초대30초 만료·좌석 유일성·수락/거절/취소 원자성을 유지한다. 첫 Ready만 수동이고 양쪽 준비를 실제 표시한 뒤3초 카운트다운으로 시작한다. 다음 문제는 공격/연출 완료 후 자동 준비·321이다. 연결복구는 문제 마감을 멈추지 않고 다음 문제 전에 고정10초/3회만 제공한다. 서버 재시작의 불명확한 공백을 곧바로 개인 도주로 단정하지 않는다.

| 단계 | HP | ATK | DEF | 기본LUK% |
|---|---:|---:|---:|---:|
| 깜몬 |50|10|5|1|
| 코로몬 |75|15|7|3|
| 아구몬 |100|25|10|5|
| 그레이몬 |200|50|20|7|
| 메탈그레이몬 |400|100|40|9|
| 워그레이몬 |800|200|80|11|

피해=max(1,공격ATK−방어DEF), 회피%=방어LUK/공격단계1..6이다. 정수 반올림하지 않고 서버에서 공격당 한 번 추첨해 저장한다. HP/ATK/DEF 격차 보정·MP 없음. 다른 기존 진화계열은 같은 단계 수치를 사용하며 진화 규칙은 바꾸지 않는다.

문항별 최초 제출 수신시간을 기준으로 양쪽 정답이면 빠른 쪽, 한쪽만 정답이면 해당 쪽 공격이다. 정확한 같은 시각은 clash·중앙상쇄·HP불변·회피추첨 없음이다. 양쪽 오답/미응답은 무행동이다. 묶음 끝에 문항 순서로 연출하며 HP0이면 남은 공격을 중단한다. 클라이언트 탭 시각이 아니라 서버 수신이므로 지연 영향이 있다. 정상20문제/라운드 상한은 없고 풀 소진 후 고정 풀 반복으로 계속한다.

XP는 시작단계차 기준: 동급 승/패+100/−100, 상대1단계위+150/−50,2이상위+200/−25,1아래+50/−150,2이상아래+25/−200. 실제 차감은0하한으로 줄어들 수 있다. 종료 시 별도 battle 원장과 유일 growth key를 같은 transaction에서 한 번 기록한다. 도주=패배, 시작 전 취소/무효=0, 사용자별 독립 연습전=0이다. XP0 파트너 삭제는 구현하지 않는다.

종료 history/review는 참가자 본인만 조회한다. `GET /battle/wrongnotes`는 본인의 제출한 오답만, `POST /battle/wrongnotes/answer`는 출처/버전/소유 검증과 request key로 재풀이만 기록한다. 미응답은 오답 항목으로 만들지 않고 원본 답안/XP는 변경하지 않는다. 동일 출처 새 매치 재오답은 최신 needsReview를 갱신하되 모든 이전 출현의 recentResults/reviewCount를 합산한다. 다른 계정/동명 다른 버전은 합치지 않는다. 상세 schema는 migration045와 `src/battle/wrongnotes.ts`가 실행 근거다.

<a id="mini"></a>
## 미니모의·무료 테스트 이용권·원문 호환

미니모의는 기존 JWT owner/event ID·키 검증·처음 결과50분모·최근3회·한 번의 bounded XP를 사용한다. 서버 릴리스 가드/실제 음원 준비가 기준이며 초기 “기본 false/준비중” 메모를 현재 상태로 재사용하지 않는다. migration038/039 등 과거 변경은 적용 이력·체크섬으로 확인하며 이번 문서 작업에서 재적용하지 않는다.

무료 테스트 premium은 설정이 허용하고 본인이 명시 POST했을 때만30일 지급, 사용자 PK 감사 원장으로 한 번 제한하며 결제/관리자 권한을 만들지 않는다. 과거 DB에001만 있었다는 보고는2026-10-08/초기 환경 관찰이고 현재 상태가 아니다. 활성 설정은 런타임 응답으로 확인하며 문서 정리 중 켜지 않는다.

원문 순차 progress017은 호환용으로 보존되고 현재 workspace018은 별도 행에 수정 가능한 입력/확인 마스크/위치/revision/mutationId를 저장한다. 같은 계정·원문 hash·quiz ID 기준이고 기존 행/attempt/XP를 변경하지 않는다. 순서형은 circled1~20와 명확한 숫자 구분자만 정규화, unordered multi-answer는 정확한 canonical items·개수만 비교한다. 부분답/중복/추정 동의어는 정답으로 만들지 않는다. 과거 저장 답은 자동 재채점하지 않는다.


## 관리자 XP 조정

`GET /ops/members` 및 상세는 총XP를 반환한다. `POST /ops/members/:id/xp`는 기존 ADMIN검증을 그대로 사용하며 requestId·delta·expectedBalance·reason을 검증한다. 같은요청 재처리는 원래결과를 반환하고 잔액경합은409로재확인을요구한다. 모든변경은감사표와성장원장을한트랜잭션에추가한다. 학습·전투기록을재작성하지않으며비밀번호/역할/세션관리는이기능범위가아니다.

## 본인 문제별 기록 조회 (10/28)

`GET /api/v1/me/records?subject=all|history|toeic&source=all|battle|review|unknown&page=1&snapshot=<ISO>`는 기존 JWT 가드의 사용자만 읽는다. 사용자 식별자 입력은 받지 않는다. 필터와 페이지(1–1,000,000), 조회 시각을 검증하고 REPEATABLE READ READ ONLY에서 전체 건수와 20건 페이지를 조회한다. 동시 시각은 이벤트 종류와 실제 저장 키로 정렬한다. 저장·수신 시각이 snapshot 이후인 새 이벤트는 제외하므로 늦게 수신된 과거 집중학습도 기존 페이지를 밀지 않는다.

원천은 `attempts`, `weakness_practice_attempts`, `toeic_cbt_practice_answers`, 완료한 `toeic_cbt_runs/items`, 종료된 배틀·연습의 실제 본인 제출, `battle_wrong_attempts`다. 검증 전용 토익 실행은 기존 기록 계약대로 제외한다. 미응답·시작 전 취소를 답안 시도로 만들지 않고 배틀 결과 경로에 보존한다. 집계 결과·최근 3회 요약·로그인·자료 열람·체크 상태를 추가 풀이로 복제하지 않는다. 단어 등 시도별 저장이 없는 학습과 브라우저 안에만 남은 기록도 서버 풀이로 만들지 않는다.

일반 풀이의 과거 저장 유형은 실제 화면 진입 경로를 증명하지 않아 `unknown`으로 둔다. 전투와 전투 오답 복습은 서로 다른 경로다. 가져온 시각과 실제 풀이 시각도 구분한다. 집중학습은 기록 버전과 일치하는 원본 자료만 표시한다. 없는 과거 문제·해설·문항 시각을 현재 내용으로 덮거나 추정하지 않는다. 앞으로 화면 진입 경로까지 보장하려면 선택적 provenance 필드를 새 제출에만 저장하는 별도 호환 확장이 필요하다. 이 변경에는 마이그레이션·과거 자료 재작성·권한 변경이 없다.

한국사 배틀은 기존 짧은 quiz와 원본 이미지 mock을 별도로 섞어 번갈아 배치한다. mock의 5개 보기 번호·정답 대응·공통 자료·해설을 보존한다. 제한시간은 기존 한국사 규칙인 30초다. 이미지 준비를 기다릴 때는 기존 60초 준비 제한과 재접속 유예를 적용하고, 양쪽이 준비하면 같은 서버 시작·마감 시각으로 진행한다. 보상·공격·판정 계산은 유지한다. 진행 중 question 응답에는 정답과 해설을 싣지 않는다.

## 일일 출석 보상 10XP (후속)

기존 자동 출석(가입·로그인)과 명시적 출석 버튼은 같은 트랜잭션 함수를 사용한다. 사용자 행을 잠근 뒤 서버 시각으로 KST 날짜를 결정하며, `(user_id, day)` 출석 INSERT가 실제로 새 행을 만든 경우에만 `attendance:YYYY-MM-DD` 원장에 10XP를 함께 쓴다. 동일 날 재요청·응답 유실 후 재시도는 추가 지급하지 않는다. 읽기·마이그레이션·기존 출석 재조회에는 보상이 없다. 가입 보너스 1,000XP와 별도 이벤트이므로 새 가입일 총점은 1,010XP다.

독립 마이그레이션 `048_attendance_growth.sql`은 기존 출석을 참조하는 nullable `attendance_day`, 날짜별 원장 유일성, 정확히 10XP인 새 사유만 추가한다. 기존 원장 검증식은 유지하며 과거 행과 보상은 재작성하지 않는다. 별도 미커밋 `047_battle_draw.sql`은 포함하지 않는다. 반환값은 `reward.daily`, 이번 요청의 `awarded`, 오늘 확인된 `earnedToday`, 서버 합계 `growth.points`를 구분한다. 성장 기록의 사유는 `attendance`다.

## 최종 출석 규칙: 5일 반복 (후속049)

중간 API `a78d9024`의 고정 10XP 정책 뒤에 확정된 규칙이다. 전체 실제 연속 출석 수 n에 대해 보상은 `((n-1)%5+1)*10`이다. 어제 출석이 없으면 다음 출석의 n은 1이다. 신뢰할 수 있는 기존 `(user_id,day)` 기록으로 연속 일수를 계산하고, 이전 보상은 재정산하지 않는다. 6일 연속은 계속 6일이며 보상 주기 위치만 1이다. 5일차 완료 당일 체크판에는 실제 50XP를 남기고 다음날 주기 전환을 안내한다.

048 체크섬·FK·유일성은 그대로 둔다. 049는 기존 비출석 XP 검증식을 유지하면서 출석 허용액만 10/20/30/40/50으로 확장한다. 행 UPDATE/DELETE·소급 INSERT·권한 변경은 없다. 실제 migrator/PGlite에서 049 DDL 뒤에 의도적 오류를 발생시키고 ROLLBACK했을 때 048의 원래 검증식으로 돌아오는 것을 확인한다. 운영 적용 실패 시에도 기존 migrator의 트랜잭션이 스키마를 되돌리고 신규 서버는 시작하지 않는다. 이미 지급한 보상을 되돌리는 down migration은 사용하지 않는다.

## 간결한 풀이 기록과 경기 결과

기존 owner 범위와 문항별 이벤트·정렬·스냅샷을 유지한다. 종료 경기의 보관된 fighters.name에서 상대 공개 닉네임만 읽고 이메일 형식·누락 이름은 미확인으로 반환한다. 본인 side와 저장된 winner로 win/loss를 구분한다. 명시적 double_ko만 draw, void는 무효, 자료가 없으면 unknown이다. 문항 정오답으로 경기 승패를 추정하지 않는다. 전투 오답 재풀이에도 원경기 정보를 제공한다. 새 스키마나 과거 데이터 변경은 없다.

## 수동 진화·얼음섬 입장과 수락 계약 (구현, API 배포 대기)

새 migration `050_partner_evolution.sql`은 현재 XP에 해당하는 기존 형태를 보존하고 계열별 형태·revision 및 요청 영수증을 저장한다. 미배포 수동 진화 구현을 재사용하되 현재 정식 046/048/049는 수정하지 않는다. `GET /me`의 `partnerEvolution.{agumon,patamon}`은 stage(0부터), revision, character, nextCharacter, nextThreshold, eligible, final을 반환한다. `POST /me/evolve {family,revision,requestId}`는 기존 owner lock 안에서 현재 원장 합계와 revision을 검증하여 한 단계만 진화한다. 동일 요청은 같은 결과, 다른 동시 revision은 409다. XP는 소비하지 않고 초과 XP와 기존 보상·0하한을 유지한다. 형태는 XP 감소로 퇴화하지 않는다. 가입 시 두 계열을 가입 XP 기준으로 초기화하며 전투 능력치와 보상 단계는 저장된 형태를 사용한다.

`051_battle_lobby_sessions.sql`은 사용자·탭별 sessionId lease와 연습 경기 subject를 추가한다. `/battle/enter`는 family/sessionId, `/battle/lobby`와 `/battle/events`는 sessionId 쿼리, `/battle/suspend`·`leave`는 sessionId 본문을 사용한다. 보이는 얼음섬만 10초마다 lease를 갱신하고 25초 TTL을 적용한다. 숨김·화면 이탈·SSE 단절은 해당 탭 lease를 제거하며 다른 탭을 제거하지 않는다. 명시적 마지막 탭 퇴장은 경기 종료 규칙을 적용한다. 숨김/새로고침은 진행 경기를 유지하고 기존 재접속 규칙으로 복구한다. 서버는 신청·수락 때 양측의 유효 lease를 확인한다.

대기실 `participants`는 busy, status(waiting/battling), opponentName을 제공한다. `matchId`는 수락된 경기만 가리키며 `invitations`는 id/subject/direction(incoming/outgoing)/name/expiresAt 배열이다. SSE `invitations`와 수락된 `snapshot`은 별도 이벤트다. 초대는 10초이며 실제 문제 30초 규칙은 유지한다. pending은 좌석을 차지하지 않고 수락 transaction에서 양측 좌석 확보·다른 관련 요청 종료를 함께 수행한다. 교차 신청은 기존 초대를 반환하며 자동 수락하지 않는다. 요청키 중복 및 사용자별 대기/발신 빈도를 제한한다. 모든 경기 액션의 lock 순서는 lobby → match → 필요 시 owner다.

`POST /battle/practice {family,sessionId,subject}`는 history/toeic을 받는다. 기존 로컬 봇 판정, 개인 전용 기록과 XP 0 규칙을 유지한다. 한국사는 기존 빈칸·실전 모의고사 bank를 재사용하며 실제 사용자 계정을 만들지 않는다. 기존 연습전은 default toeic으로 보존되고 조회·오답·통합 기록도 저장된 subject를 사용한다.

FE는 `/me`가 새 계약을 제공할 때만 새 세션·진화·한국사 봇을 호출한다. 기존 API에서는 pending snapshot을 중앙 수락/거절·신청자 대기/취소 모달로 표시하고 기존 서버 expiresAt(30초)을 따른다. 따라서 수락 전 전투 UI 진입 차단은 기존 API로 별도 반영 가능하지만 10초 서버 제한·다중 초대·입장 검증·수동 진화·한국사 봇은 API 배포가 필요하다. 집 runner offline 상태에서는 이를 운영 완료로 표시하지 않는다.

## 사이트 전체 접속자·대전 초대 계약 (구현, API 배포 대기)

`054_battle_site_presence.sql`은 `battle_lobby_sessions.place`(island|site, 기본 island)만 추가한다. 기존 얼음섬 lease 의미와 데이터는 그대로다. 로그인한 모든 HanQ 탭은 `POST /battle/presence {sessionId,place}`로 10초마다 lease를 갱신하고(25초 TTL), 서버는 탭 여러 개를 계정 하나로 합친다. lease는 탭 자신의 요청으로만 갱신한다. 서버 SSE heartbeat는 갱신하지 않으므로 반쯤 끊긴 연결이 접속자를 남기지 않는다. 한 탭의 `POST /battle/suspend {sessionId}`는 그 탭만 지우고, 마지막 탭이 사라지면(명시적 종료 또는 TTL) 대기 중인 초대를 `offline`으로 닫는다.

대기실 `participants`는 기존 busy/status를 유지하고 `activity`(available=얼음섬, learning=다른 페이지, invited=응답 대기 초대 있음, battling)와 `place`를 더한다. 목록 조회와 신청은 여전히 얼음섬 lease가 필요하지만, 신청 대상과 수락은 사이트 lease만 있으면 된다. 전투 중 상대·자기 자신 신청은 서버가 409로 거절한다(버튼 비활성은 보조).

`GET /battle/invitations`와 SSE `invitations` 이벤트는 `{serverNow,invitations,closed}`를 준다. `closed`는 최근 20초 안에 닫힌 초대의 id/subject/direction/name/reason(declined·cancelled·expired·busy·offline)/closedAt이다. 거절·취소는 act에서, 만료는 clean에서, 다른 초대 수락은 accept transaction에서(`busy`), 접속 종료는 suspend·sweeper에서 이유를 기록한다. 1초 sweeper가 만료·이탈을 정리하고 양쪽에 알린다. `GET /battle/events?place=site&sessionId=`는 초대 정보만 보내며 경기 연결 수·snapshot·경기 타이머에 관여하지 않고, 닫혀도 탭 lease를 지우지 않는다(같은 탭에서 얼음섬이 이어받을 수 있음). 경기 진행·채점·XP·전투 시간·봇 연습 규칙은 바꾸지 않았다.

## 2026-10-28 독립 검수: DB 단순화와 서버 정리 후보

운영 DB에 접속하지 않고 `fbcc866`와 `ed08c11`의 마이그레이션을 비교하고 빈 로컬 PGlite에 적용했다. 새 API 기준 애플리케이션 테이블은 63개, 외래키는 90개다. 운영 기준 48개 번호 마이그레이션은 바뀐 것이 없고, 050·051 두 파일만 추가된다. 이번 세 테이블을 제외한 기준은 60개다. 이는 실제 운영 행 수나 조회 빈도를 조사한 결과가 아니다. 63개 모두 현재 TypeScript 소스에 이름 참조가 있어, 단순 이름 검색만으로 삭제 가능한 테이블은 찾지 못했다.

| 범위 | 현 구조의 근거 | 안전한 정리 방향 | 먼저 확인할 사항 |
| --- | --- | --- | --- |
| 대결·연습 경기와 라운드 | 사람 경기는 두 사용자·점유·XP 외래키, 봇 경기는 단일 소유자·활성 경기 유일 인덱스·XP 제외를 각각 강제한다. `battle/service.ts`, `battle/wrongnotes.ts`, `attempts/my-records.ts`가 두 경로를 읽는다. | 공통 읽기 저장소나 읽기 전용 projection으로 UNION과 소유자 조건을 한 곳에 둔다. 테이블 병합은 우선하지 않는다. | 사람/봇 ID 충돌, 양쪽 개인 답안, 보상, keyset 순서, 기록 권한 회귀 |
| `source_blank_progress`와 `source_blank_workspaces` | 동일 사용자/퀴즈/버전 키를 쓰지만 순차 제출 v1과 편집 가능한 v2의 payload·revision 계약이 다르다. v2는 v1 fallback을 실제 사용한다. | 테이블 통합 가능성이 가장 뚜렷한 후보다. 기존 API 유지와 mode 구분을 전제로 별도 전환 설계 후 진행한다. | v1 endpoint 호출량, 실제 두 표의 중복 키·revision·payload, 옛 클라이언트 쓰기 여부 |
| `toeic_recall_view`·`toeic_word_checks` | 화면 위치와 낱말 체크 상태다. 후자는 별도 revision과 단 한 번의 legacy import 계약을 가진다. | 통합 사용자 학습 설정 저장소 후보이나 지금 한 테이블로 합쳐도 의미 있는 복잡도 감소가 작다. 인증 users 행에 붙이지 않는다. | 단일 user 행에 서로 다른 기능 쓰기가 충돌하지 않도록 부분 갱신/기능별 revision 필요 |
| 세션·토큰·로그인 실패 | 로그아웃/회전 토큰/만료·재사용 탐지·로그인 제한은 수명과 유일성 제약이 다르다. | 현 분리 유지. 공통 인증 수명 정책만 코드로 정리한다. | 기존 세션·로그아웃 전체·탈취 재사용 대응 회귀 |
| XP·결제·진화 이벤트 | `growth_ledger`, `battle_xp_ledger`, `admin_xp_adjustments`, `partner_evolution_events`, 결제 이벤트는 append-only 근거와 중복 지급 방지 키가 다르다. | 조회 집계의 중복만 공통화한다. 감사 원장 병합·소급 재작성은 제외한다. | 총 XP 동일, event/request key 재전송 동일, 0하한·과거 보상 보존 |
| TOEIC 검증 경기 표 | `toeic_cbt_verification_runs`는 운영 검증을 실제 학습 이력에서 제외하는 표로 6개 소스 참조가 있다. | 행 수가 작아 보여도 삭제 후보가 아니다. 읽기 필터의 공통화 후보다. | `recent-own-learning.ts`는 다른 이력 조회와 검증 경기 제외 조건이 달라 후속 일관성 검토 필요 |

이번 로컬 코드 정리는 신청과 수락에 복제돼 있던 점유 검사 두 곳을 `hasActiveBattle`로 모으는 데 한정한다. SQL, seat 우선 조회, 연습 경기 조회의 short circuit, 인자, lobby lock 위치와 응답 코드는 그대로다. 전체 전투 서비스 분할은 lobby/presence, match state, history/media의 세 경계로 따로 작업하고, 글로벌 lobby lock의 범위를 줄이는 일은 독립 DB 경합 검사와 함께 진행해야 한다.

### source 상태 표의 되돌릴 수 있는 전환 설계 (미실행)

1. 새 표 `source_learning_state`를 `(user_id, quiz_id, source_version, mode)` 키로 설계하고 `mode`를 `legacy-progress`/`editable-workspace`로 구분한다. 각 payload·revision·mutation_id·mutation_hash는 그대로 보존한다. 기존 표·API·마이그레이션 checksum은 바꾸지 않는다.
2. 기존 read/write를 유지한 상태에서 복사 기준시점, 키별 개수, payload hash를 점검하는 일회성 dry-run을 준비한다. 새 표는 아직 읽기 기준이 아니다. 운영 실행 전 실제 row 규모와 동시 writer를 알아야 한다.
3. 기존 트랜잭션 안에서 새 표에 mirror write를 추가하고, 양쪽 읽기를 비교하되 응답은 기존 표 기준으로 유지한다. v1→v2 fallback은 기존 변환 함수에서만 수행한다.
4. 동일한 소유자·revision 충돌·같은 mutation 재전송·다른 payload 거부·cursor/완료 상태 검사를 통과한 뒤 읽기 기준만 전환한다. 기존 표에 쓰기를 유지하는 기간 동안 롤백은 이전 코드/읽기 기준 복원으로 끝난다.
5. 옛 클라이언트와 비교 기간이 끝나기 전에는 기존 표를 제거하지 않는다. 이번 작업에는 스키마 실행, DROP, 기록 삭제·변환이나 운영 데이터를 이용한 검증이 없다.

## 2026-10-28 약공격·무승부와 이전 FE 접속 호환

각 문항에서 양쪽 모두 정답이 아니면(오답 또는 시간 내 미응답) 각각 약공격을 1회 판정한다. 기존 정수 일반 피해 `max(1, ATK−DEF)`의 1/3을 버림하고 다시 최소1을 적용한다. 즉 일반 피해 1/2/3/4/5/6/8/9는 약공격 1/1/1/1/1/2/2/3이다. 각 공격의 기존 회피 확률을 독립적으로 적용하며 회피는 피해0이다. 양쪽 판정과 피해를 먼저 계산하고 HP에 함께 적용하므로, 먼저 HP0이 된 쪽도 반격을 잃지 않는다. 기존 한쪽 정답 공격·양쪽 동시 정답 상쇄·제한시간은 그대로다.

결과 event는 `kind:weak`, `strikes.left/right:{damage,miss}`(키는 공격자), 최종 양쪽 HP를 보존한다. 연출은 2000ms이며 클라이언트가 피해를 재계산하지 않는다. 양쪽 HP0은 `status:finished, winner:null, finishReason:double_ko`다. API 기록·복기·MyPage는 draw, 양측 battle_xp_ledger는 outcome draw와 requested/applied 0을 저장하고 growth_ledger에는 새 지급을 넣지 않는다. 기존 owner lock·경기 lock·원장 유일 키·저장된 rewards를 그대로 사용한다. 재접속·같은 답/종료 재요청·재조회는 저장한 event와 보상을 읽는다. 봇도 draw로 보관하되 인간 경기 원장과 XP는 계속 건드리지 않는다.

053_battle_draw는 기존 outcome CHECK만 확장하며 050/051/052 및 기존 원장 행을 변경하지 않는다. 무지개섬 052와 장착 XP trigger는 부모의 최종 전달물로 합친 뒤 별도로 확인한다. 롤백 시 이미 저장된 draw를 void/loss로 바꾸면 안 된다. 확장 CHECK는 유지하고 draw 읽기 호환 코드를 남기는 방식이 안전하다. CHECK를 다시 좁히려면 draw 행이 없다는 검증이 선행돼야 한다.

이전 FE가 sessionId를 생략하면 기존 JWT guard가 확인한 userId+인증 sessionId로 별도 UUIDv8 임시 lease를 만든다. 신 FE의 UUIDv4 탭 키와 겹치지 않는다. 명시적으로 잘못된 키/null은 계속400이다. 배포 전에 열린 구 탭은 자신의 기존 battle_presence가 있는 authenticated lobby GET에서만 임시 lease를 복구할 수 있다. 입장 이력 없는 사용자의 GET은409이며 SSE만으로 lease를 새로 만들지 않는다. 기존 lease는 요청/인증된 연결의 heartbeat로 갱신한다. 구 탭의 leave/suspend/SSE 종료는 공유 legacy lease를 지우지 않고 TTL25초에 맡긴다. 신 탭은 기존 탭별 즉시 정리를 그대로 사용한다. 구 FE는 탭/visibility를 구분해 보내지 못하므로 이 기간에는 로그인 세션별 접속 유지가 적용되며, 신 FE로 갱신한 뒤 정밀한 탭별 lease를 사용한다. 인증·권한·다른 계정 row는 변경하지 않는다.
## 무지개섬 컬렉션 Beta — 2026-10-28 로컬 설계

`052_owned_digimon.sql`은 050/051 다음의 추가 migration이다. 이전 checksum과 원장 행은 바꾸지 않는다. `owned_digimon` 한 행에 소유자·계열·XP·단계·revision·장착 여부를 모으고, claim/equip/evolve의 재시도 영수증은 `digimon_commands` 한 표로 공유한다. 계열별 표나 XP별 세부 표를 늘리지 않는다. Beta는 파피몬/파닥몬 계열 각각 한 번 수령, 기존 첫 아구몬을 포함해 최대 세 마리다.

기존 계정의 전체 원장 합계와 050의 아구몬 단계/revision을 첫 디지몬으로 한 번 복사한다. 보너스를 새로 주지 않으며, 과거 원장의 `digimon_id`는 NULL로 보존한다. 신규 회원은 기존 signup 1,000 XP 원장이 첫 성장기 디지몬을 만든다. 이후 알은 0 XP, stage=-1이다. 부화/진화 목표는 100/500/1,000/1,200/1,500/1,800 XP이며 한 번에 한 단계, XP 무소모다. 이 수치는 HanQ 규칙이다. 기존 잔액이 음수면 migration은 실패하므로 사전 정합성 확인 후 처리하며 임의로 0으로 덮지 않는다.

원장의 BEFORE INSERT는 소유자 row lock과 장착 ID 검증을 하고, AFTER INSERT만 장착 디지몬 XP를 갱신한다. ON CONFLICT 재시도는 AFTER가 실행되지 않아 이중 지급하지 않는다. 모든 기존 보상 경로가 같은 원장으로 들어오므로 각 채점 서비스에 컬렉션 지급 로직을 복제하지 않는다. `boundedGrowth`와 관리자 차감은 장착 디지몬의 0 XP 하한을 사용하고 다른 디지몬의 XP를 빌리지 않는다. 계정 합계는 소유 XP의 합이며 `/me`는 repeatable-read snapshot 안에서 원장 합계와 비교한다. 명예의 전당은 합산 XP 순위와 실제 장착 모습을 함께 표시한다.

장착은 계정 전체 revision 합, 진화는 해당 디지몬 revision을 검사한다. 요청 UUID+입력+결과를 영수증에 저장하여 동일 요청 재시도는 기존 결과만 반환한다. 다른 입력에 같은 UUID를 쓰거나 오래된 revision을 쓰면409다. 부분 unique index와 deferred constraint로 커밋 시 정확히 한 마리만 장착된다. 작업 잠금 순서는 battle lobby advisory lock → owner row다. 유효한 초대/진행 중 대전·연습 중 장착과 진화는409다. 알은 대전에 참가할 수 없다. 대전 결과·보상 승패 enum은 이 변경의 범위 밖이며 통합 담당의 draw 변경과 별도로 병합한다.

| 경로 | 입력/결과 |
| --- | --- |
| GET `/api/v1/me`, GET `/api/v1/me/partners` | `partners` 또는 컬렉션 본문: version=1, claimEnabled/equipEnabled, totalPoints, equippedId, revision, items |
| POST `/api/v1/me/partners/claim` | family=gabumon/patamon, requestId(UUID4) |
| POST `/api/v1/me/partners/equip` | id(소유 디지몬), revision(컬렉션), requestId |
| POST `/api/v1/me/partners/evolve` | id(소유 디지몬), revision(개별), requestId |

성공은200과 `confirmed:true`, `replayed`, `partnerId`, 확정된 디지몬 스냅샷이다. UI는 이후 `/me`로 최신 전체 상태를 읽는다. 기존 `/me/evolve`는 소유한 계열만 찾아 같은 command에 연결한다. 옛 클라이언트의 로컬 계열 선택은 장착을 바꾸지 않는다. 새 FE와 API를 함께 검수해야 한다.

### 테이블 단순화와 전환

050의 `partner_evolution`/`partner_evolution_events`는 기존 진화 이력과 가입 경로에서 쓰이므로 삭제하지 않는다. 새 현재 상태 읽기는 collection 모듈로 모았고 새 진화 기록은 공통 commands를 사용한다. 후속 정리는 실제 참조와 보존 기간을 확인해 옛 읽기 어댑터·가입 초기화를 단계적으로 제거하는 안이다. 회원·보상·감사 표를 무조건 병합하지 않는다. 신규 디지몬에 XP가 분배된 뒤에는 옛 합계형 API로 단순 롤백하면 표시가 어긋난다. 쓰기 차단을 유지한 호환 버전으로 롤포워드하고, 원장/컬렉션 데이터는 보존한다. 운영 migration 실행과 데이터 변경은 아직 하지 않았다.

부화 전 알은 대기실에 전투 가능=false·HP/ATK/DEF/LUK0으로 표시하고 실제 대결/연습 요청은409로 막는다. 새 계열의 단계별 능력치는 기존 공통 단계식을 사용하며 아구몬 전용 기술명을 잘못 붙이지 않도록 기본 타격으로 표시한다. 전용 기술·pose 연출은 후속 범위다.

## 무지개섬 알 구매와 60초 부화 (2026-10-30 서버 계약)

`GET /me`의 `partners`와 `GET /me/partners`는 기존 `version:1`을 유지하고 `purchaseEnabled`, `hatchEnabled`, `hatchSeconds:60`, `serverNow`(UTC ISO), `coinBalance`, `products`를 제공한다. 상품은 `{id,kind:'egg',family,name,priceCoin:0,owned}`다. Coin은 XP와 별개의 게임 재화이며 현재 두 알 상품 가격은 서버·DB 모두0이다. 지급·지갑·결제·옷/스킨 구매 API는 없다.

`POST /me/partners/claim`은 `{family,priceCoin:0,requestId}`를 받아 서버 상품 가격을 확인하고 계열별 한 개체만 생성한다. 이전 클라이언트의 `priceCoin` 생략은 호환되지만 서버 가격 확인을 생략하지 않는다. 소유자 행 잠금·`UNIQUE(user_id,family)`·상품 소유 유일성·append-only 명령 영수증이 같은 transaction에 있다. 같은 요청 재시도는 원래 영수증을 반환하고, 다른 입력에 같은 requestId 사용 또는 다른 키의 중복 계열 구매는409다. 응답을 놓친 구매를 재시도해도 새 개체·거래를 만들지 않는다.

알 개체는 `stage:-1`, `points:0`, `eligible:false`, `nextThreshold:null`로 시작한다. 첫 장착 요청이 소유자 잠금을 획득한 뒤 읽은 서버 시각을 `hatchStartedAt`에 한 번 저장하고 정확히60초 뒤를 `hatchReadyAt`에 저장한다. 재장착·새로고침·로그아웃·페이지 이탈은 기한을 바꾸지 않는다. 기한이 지난 알은 다음 인증된 상태 조회/명령 또는 대결 프로필 조회 때 stage0으로 원자적으로 완료하고 `hatchedAt=hatchReadyAt`을 기록한다. 다른 개체로 바꾸어 보관 중이어도 이미 시작한 타이머는 끝난다. 화면은 서버 재조회 결과를 보고 부화 연출을 하며 클라이언트 시각만으로 단계를 바꾸지 않는다. 수동 진화로 알을 깨거나100XP를 요구하는 이전 정책은 폐기됐다. 부화 후 다음 정상 진화 임계값500XP 및 이후1000/1200/1500/1800은 유지한다.

migration055는 상품·Coin계정·기존 개체의 상품 연결 및 부화 시각만 추가한다.001~054와 기존 XP/출석/풀이/전투 원장은 수정하지 않는다.052의 개체별 XP trigger가 모든 growth_ledger insert를 현재 장착 개체에 귀속하고 성공한 insert 뒤 한 번만 XP를 더한다. 계정 XP 합계는 기존 원장과 개체 XP 합계를 대조하며 신규 첫 파트너1000XP와 기존 첫 파트너의 정확한 누적액을 유지한다. 알 장착 중 출석/풀이 XP도 같은 원칙으로 보존한다.

운영 적용 전에는 기존 migration checksum, 계정별 원장/개체 합계, 기존051 좌석 정리의 대상이 만료/대기 상태인지와 현재 schema를 확인한다. migrator는 migration마다 transaction·checksum·advisory lock을 유지한다.055 DDL 실패 시 해당 transaction rollback을 사용한다. 성공 후 rollback은 소유/부화/영수증을 보존하고 이 계약을 이해하는 이전 이미지로만 되돌린다. 컬럼·테이블 삭제나 XP 과거 snapshot 복원은 사용하지 않는다. 적용과 백업은 승인된 배포 경로에서만 하며 현재 실제 운영 반영 여부는 최종 보고의 커밋/실행 근거로 구분한다.

### Node 도구와 테스트의 정적 검사

ESLint는 .cjs를 Node24 CommonJS로 검사한다. require 문법 예외는 이 확장자에만 적용하며 no-undef와 TS any 금지는 유지한다. 랭킹 projection의 외부 행은 Record<string,unknown>으로 받고 페이지 cache는 반환 타입을 보존한다. C0 닉네임 정제와 순서/복수답 채점의 경계 회귀 검사는 공개 fixture만으로 실행한다.

### 후보 이미지 provenance

Dockerfile은 pinned official Node24 amd64·nonroot·승인 mounted bootstrap 필수이며 .dockerignore는 입력 allowlist다. CI independent 전체 성공 뒤 release-image는 신뢰 저장소 push/dispatch만 받아 SHA/run/image ID/archive SHA256/SQL checksum을 private artifact에 남긴다. 이 job은 운영 접속·registry credential·Windows 설치·자동 migration을 하지 않는다.

### 통합 검사의 독립 oracle

10/30 유지보수 이후 테스트의 mock XP 기대값은 server 응답 대신 FE fixture의 원래 배점을 사용한다. 출석은 signup과 별도 event/FK/날짜/정확한 금액으로 검사한다. test/fixtures/migration-manifest-20261030.json은 검토된 파일명·체크섬의 고정 목록이며 새 migration 승인 시 의도적으로 갱신한다. 실제 파일과 DB 적용 ledger가 이 목록과 정확히 일치하고 재실행으로 applied_at이 바뀌지 않아야 한다. 과거 음수 상태 fixture는 격리 DB transaction에서만 구성하며 현재 XP guard 실패와 rollback 뒤 guard 복구도 함께 검사한다.

## Private question request staging

[API contract and undeployed migration gate](question-request-staging.md). Owner uploads and manual answers stay private until reviewed; OCR, automatic review and publication remain disabled capabilities.
