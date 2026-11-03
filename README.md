# file-island-api

파일섬(File Island) 백엔드 API 저장소입니다.

NestJS + PostgreSQL API입니다. 현재 운영 기준과 새 에이전트의 실행 순서는 아래 표 및 [CHATGPT.md](CHATGPT.md)를 확인하세요.

## 현재 운영·후보와 문서 기준 (2026-11-03 인계 기준)

| 구분 | 전달된 확인 기준 | 다음 담당자의 주의점 |
|---|---|---|
| 운영 API | 원본 소스 `987be5798893b0023674a194626704a9d5033a37`, schema54; 홈서버 API 도메인 TLS 완료 | 이 저장소 main SHA와 원본 SHA를 구분. health/TLS 성공만으로 새 기능·전체 CI/CD 완료를 선언하지 않음 |
| 운영 FE | [홈서버](https://file-island.duckdns.org), `2f745855e618f790617ecf3b64068afd4315b49d`, 0.2.10-beta | 실제 [app-version.json](https://file-island.duckdns.org/app-version.json)·HTML·변경 자산을 재확인 |
| 준비 후보 | 147쪽 판본 history API `ab5…`, auth capability `92429f9f115ab2bb22b58a5a16210996d3cd7655` | feature 준비 상태. 운영 반영·교재 활성화 완료가 아님 |
| 운영 제한 | migration056 미적용, 새147 교재 기본 OFF, 인프라 통합 진행 중 | XP 선택 조정·새 판본 release gate를 디자인 변경으로 해제하지 않음 |
| 이전 호스팅 | Vercel·Render 아직 중지되지 않음 | 새 홈서버 검증과 별도 중지/전환 조율 필요 |

이 표는 전달된 운영 기준선이다. 이후 실제 배포 시 관찰 시각·전체 SHA·image digest·migration checksum을 갱신한다. 축약 `ab5…`는 후보 식별을 위한 인계 표기이며 배포 pin으로 사용할 수 없다. 해당 담당자가 확정한 전체 SHA를 받아 검증한다.

### VERSION·RELEASE_VERSION·릴리스 증거

두 저장소 루트에 독립적인 `VERSION` 파일은 없다. API `package.json`과 `package-lock.json`의 0.1.0은 패키지 기준선이다. 패키지 버전 변경이 필요한 경우 둘을 맞추되, 이를 프런트 표시 버전이나 schema54/056으로 대체하지 않는다. API에는 현재 `RELEASE_VERSION` 또는 `app-version.json` 생성 계약이 없다. 프런트 사용자 버전은 [FE RELEASE_VERSION](https://github.com/hddooo/file-island-web/blob/main/RELEASE_VERSION), [CHANGELOG](https://github.com/hddooo/file-island-web/blob/main/CHANGELOG.md), [빌드 설명](https://github.com/hddooo/file-island-web#version--release_version--sha의-실제-의미)이 기준이다. 콘텐츠 version·원문 PDF SHA·quiz digest·CAS revision·migration 번호는 각각 별개 계약이다.

API 릴리스는 정확 소스 SHA → OCI image revision/identity → archive SHA-256 및 receipt → 검수된 compose/bootstrap·migration checksum → 실제 배포 상태로 추적한다. `GET /api/v1/health`는 `{status:"ok"}`만 반환하며 소스 SHA를 증명하지 않는다. [현재 baseline CI](.github/workflows/ci.yml)는 main push/수동 실행이며 일부 비공개 자료 의존 unit을 제외한다. [수동 image workflow](.github/workflows/image.yml)는 빌드만 수행한다. feature push 자체는 현재 baseline CI를 실행하지 않는다. [6-suite 검수 계약](docs/functional-producer.md)·[실행 recipe](docs/functional-recipe.md)의 전체 API/FE/deploy SHA와 실제 결과를 확인하고, skip·자료 누락·과거 SHA 성공을 최종 qualification으로 바꾸어 적지 않는다. 기능/검사/push/CI/image/운영 반영은 각각 기록한다.

기존 [버전 계획](docs/versions/v0.1.0/plan.md)·[진행](docs/versions/v0.1.0/progress.md)·[결과](docs/versions/v0.1.0/report.md)는 문서 기준선이다. 문서 전용 변경으로 package 버전이나 migration을 올리지 않는다. 적용된 SQL을 수정하지 말고 실제 승인된 schema 배포와 별도 검증한다.

### API·자료·자산 경계와 콘텐츠 추가 입구

- `src/`·[API 계약](docs/api.md): 인증, 서버 채점, owner·권한, transaction, 멱등성. 화면 연출이 서버 상태를 결정하지 않는다.
- `migrations/`: 체크섬이 기록되는 DB 변경. 파일 번호·현재 Git 트리·실제 적용 이력은 같다고 가정하지 않는다.
- FE `media/`: 승인된 공개 실행 자산. 비공개 교재·정답 번들·음원·회원 기록을 옮기지 않는다. 개인 자료는 기존 인증 API와 승인된 readonly 자료 연결을 유지한다.
- `HANQ_FRONT_DIR`: seed/일부 검사가 읽는 프런트 카탈로그 루트. 새 저장소 이름을 기본 `../hanq_front`로 오인하지 말고 실제 sibling `file-island-web` 경로를 지정한다. seed는 자료 등록 쓰기이므로 로컬 격리 DB에서 목적을 확인하고 실행한다.

| 추가 대상 | 기존 매뉴얼 | 준비/보존 기준 |
|---|---|---|
| Practice 문제·정답·오답 | [원본과 준비 상태](docs/toeic-wrong-cbt.md#source-and-readiness), [검증되지 않은 정답](docs/toeic-wrong-cbt.md#repeated-practice-numbering-and-unverified-proposals), [공용 자료와 개인 답안](docs/common-toeic-learning.md) | 실제 원문·보기·정답키·지문/음원 그룹 확인; 원래 오답과 맥락 문제 구분; 명시한 소유자/공유 게시자와 개인 결과 보존. 공개 source-writing endpoint는 없음 |
| 한국사 수동 오답 | [배포 후 수동 등록 절차](docs/wrong-note-review-policy.md#배포-후-수동-등록-절차) | 기존 도구의 기본 dry-run, 원본/배포 hash·단일 계정 확인·백업·허용된 apply; 실제 답안·성장·시험 기록 전후 보존 |
| 음원·대본 | [LC 중계·대본 계약](docs/design-development.md#lc-중계대본-계약), [TOEIC 준비 조건](docs/toeic-wrong-cbt.md#source-and-readiness) | 승인된 자산·그룹·접근 제한, 실제 재생/모바일 별도 확인. ASR와 공식 대본/정답 구분. Full Test 음원만으로 문제/정답을 만들지 않음 |
| 공개 기출 자산 | [기존 공개 원본 배포 매뉴얼](docs/cbt-public-assets-deployment.md) | 이 매뉴얼의 Vercel/Render 주소는 과거 경로다. 현재 프록시/자산 위치는 배포 담당과 확인하며 기존 공개 승인 범위를 확대하지 않음 |

### 한국사 81회 대비 원문·재현·기존 진도

새 147쪽 원문 PDF SHA는 `d54c1aa5d5816eeb73a2e82da0ec699555c2cbf1e7cb717a3b84420ed18296de`, 구144쪽은 `35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442`다. 재생성 명령은 [FE scripts의 기존 절차](https://github.com/hddooo/file-island-web/blob/main/scripts/README.md#81회-대비-판본-후보-재생성), 판정·저장은 [semantic 교재](docs/semantic-textbook.md), [workspace 계약](docs/source-blank-workspaces.md), [정답 정확 비교](docs/source-answer-normalization.md)를 따른다. 판본 후보의 추가 endpoint는 담당 branch의 실제 계약을 확인한 뒤 합의하며 현재 main의 계약으로 추정하지 않는다.

원문 글자·공백·기호·문항·정답·사진/표 관계를 보존한다. 웹 가독성은 리플로우·읽기 글꼴·내부 표 스크롤·원문 전체/확대로 개선하고 원문 내용을 임의로 다시 쓰지 않는다. 같은 입력의 byte 재현·문자/ID/그림/anchor 검사는 모든147쪽 사람 대조 또는 역사적 사실 검증의 완료가 아니다. 새 root를 검수하고 구판 source·문항·정답·workspace까지 실제로 이어읽기/오답/중단 복구 가능한지 확인한다. 기존 IDs·읽음·체크·attempt·owner·CAS·멱등 키를 보존한다. DB row만 남긴 뒤 구판 파일을 제거하지 않는다. 운영 API·두 불변 root·프런트 pin의 실제 통합 검수 전까지 새 판본은 기본 OFF다.

## 코드 이관

원본: `blockmonkey1992/hanq_api` / `987be5798893b0023674a194626704a9d5033a37`. Git 과거 이력 대신 검증한 소스 스냅샷으로 이관했습니다.

운영 기준 소스입니다. 원격 `dev` 및 schema056 개발 후보와 분리했습니다. 교재 비공개 번들 298개는 제외하여 해당 기능과 Docker 빌드는 별도 비공개 자료 연결이 필요합니다.

홈서버 API의 운영 기준은 문서 상단 표와 같습니다. 이 저장소 main에는 baseline CI와 수동 image 빌드가 있으나 API CI/CD 통합은 진행 중입니다. `.github/workflows-held/*.disabled`의 원본/functional workflow는 비활성입니다. image 빌드 성공을 기능 qualification 또는 운영 배포 성공으로 표시하지 않습니다.

설정 위치와 전환 순서는 [Secrets 계획](docs/secrets-plan.md), Docker 제약과 외부 마운트는 [이관 기록](docs/repository-migration.md)을 확인하세요.

## 원본 프로젝트 안내

# hanq_api · HanQ API

NestJS + PostgreSQL 서버 저장소. 기존 인증·서버 채점·개인 기록·성장·얼음섬을 담당한다. 제품/화면 흐름은 [FE 문서](https://github.com/hddooo/file-island-web/blob/main/docs/design-outline.md)가 기준이다. 데이터는 기존 `hanq` 스키마에 둔다.

## 문서

- [서버 기획 범위](docs/design-outline.md) · [개발 설계](docs/design-development.md) · [서버 사용자 흐름](docs/design-userflow.md)
- 문서 기준선 v0.1.0: [계획](docs/versions/v0.1.0/plan.md) · [진행](docs/versions/v0.1.0/progress.md) · [결과·통합 대응표](docs/versions/v0.1.0/report.md)
- [API 계약](docs/api.md), [보안 경계](docs/security.md), [공통 자료/개인 답안](docs/common-toeic-learning.md)
- [CBT](docs/cbt.md), [부분 복습](docs/authenticated-cbt.md), [오답 연습 정책/수동 등록 매뉴얼](docs/wrong-note-review-policy.md)
- [공개 원본 자산 배포](docs/cbt-public-assets-deployment.md), [읽기 전용 준비 검사](docs/cbt-readiness-growth-floor.md)
- [원문 workspace](docs/source-blank-workspaces.md), [정확 비교](docs/source-answer-normalization.md), [비공개 교재 경계](docs/private-textbook.md), [semantic 교재](docs/semantic-textbook.md), [단어장](docs/toeic-notebook.md), [TOEIC 오답](docs/toeic-wrong-cbt.md)

중복 UI/배포 메모는 현재 설계와 버전 결과로 통합했다. 기존 원문은 Git 이력에서 복원 가능하며 스크립트 JSON·운영 매뉴얼·접근 계약은 유지한다. v0.1.0은 기존 package 버전 기준선으로 새 릴리스 선언이 아니다. 초기 “미배포/001만 적용” 관찰은 현재 상태가 아니며 정확한 운영 근거는 버전 결과를 따른다.

### 버전별 한눈에 보기

| 문서 기준선 | 날짜 | 핵심 변경 | 실제 상태·검증/배포 | 남은 일 |
|---|---|---|---|---|
| v0.1.0 | 2026-10-08~27 | 한국사/TOEIC 학습 → LC·미니모의 → 얼음섬·6섬 지도 | 10/27 기능 배포 검증 완료; 이번 통합은 문서 전용 | 실기기·과거 콘텐츠 감사 후보·다중 인스턴스 검토 |

[계획](docs/versions/v0.1.0/plan.md) · [진행](docs/versions/v0.1.0/progress.md) · [날짜별 이력·결과](docs/versions/v0.1.0/report.md#timeline). 별도 과거 릴리스 태그가 없어 가상의 v0.0.x 폴더를 만들지 않았다. 같은 기준선의 작업은 아래 결과 문서에서 날짜·실제 커밋으로 구분한다.

## 저장소 구성

`src/`는 auth/profile/questions/attempts/wrong-notes/textbook/toeic/battle 등 기존 도메인, `migrations/`는 체크섬 기록 DDL, `scripts/`는 운영/검수 도구, `test/`는 unit/integration 검사다. 각 repository 쿼리는 parameterized SQL·명시적 schema·본인 소유 조건을 유지하고 service가 transaction을 관리한다.

## Setup (local)

Node 24, PostgreSQL 15+ (현재 홈서버의 별도 PG17 검수와 구분). 명령은 이 저장소 루트에서 실행한다. `npm run build` 후 `npm start`, 또는 빌드를 포함하는 `npm run start:dev`를 사용한다. 개인 `.env` 값은 문서나 로그에 복사하지 않는다.

프런트 카탈로그가 필요한 검사는 실제 sibling 경로를 지정한다. 예: PowerShell `$env:HANQ_FRONT_DIR = (Resolve-Path ../file-island-web).Path`, POSIX `export HANQ_FRONT_DIR=../file-island-web`. 전체 `npm test`에는 별도 비공개 semantic/TOEIC fixture를 요구하는 검사가 있어, 공개 checkout만으로 전체 성공을 보장하지 않는다. hosted CI 제외 목록과 전체 qualification의 차이는 위 CI 설명을 따른다.

```sh
npm ci
npm run typecheck
npm run lint
npm test          # unit tests; DB 불필요, 일부 비공개 fixture 필요
# Integration tests need a DISPOSABLE loopback database whose name ends in _test (they DROP SCHEMA hanq):
HANQ_TEST_DATABASE_URL=postgresql://hanq_test:<local test password>@127.0.0.1:55439/hanq_test npm run integration
```

`docker-compose.yml` optionally starts such a database (`127.0.0.1:55439`, db/user `hanq_test`, password from your shell).
Tests never read `DATABASE_URL` or `.env`; JWT secrets in tests are random per run.

Running against your own database (values come from your private `.env` only; nothing is printed):

```sh
npm run ca:supabase   # once: downloads Supabase's PUBLIC CA to certs/ and checks its pinned SHA-256 (no-op if present)
npm run migrate       # creates/updates schema hanq; privileges are closed inside the same transactions
npm run seed          # loads ../hanq_front/media/{quiz-catalog,exam-pool}.js (HANQ_FRONT_DIR), idempotent
npm start
```

`migrate`, `seed`, `start` and `start:dev` run Node 24 with `--env-file-if-exists=.env` (values already exported in the
shell win). `npm test` / `npm run integration` never load `.env`: they use only `HANQ_TEST_DATABASE_URL` (loopback, `*_test`).
`migrate`/`seed` need only the database settings (no JWT secrets).

## Startup and migrations

Local `npm start` and `npm run start:dev` run `dist/src/main.js`, which starts in this fixed order (`src/startup.ts`). This is the local/source startup path. The current production Dockerfile instead invokes a separately reviewed mounted bootstrap; do not replace it with the general automatic migrator:

1. **Apply pending versioned migrations** from `migrations/NNN_*.sql` with the existing migrator, on a short-lived pool that is always closed:
   applied files are recorded with their checksum in `hanq.schema_migrations` and skipped; each new file runs in its own transaction together with
   the repeatable privileges file (it only revokes PUBLIC/anon/authenticated access); a session advisory lock (`hanq.migrate`) makes concurrent
   instances apply each file exactly once (the others wait, then find it applied).
2. **Build the app** (request pool, routes) — only after step 1 succeeded.
3. **Listen** — only after step 2. If listening fails, the app and its pool are closed.

Any failure stops the process before a single request is served (no half-migrated server answering `schema_not_ready`). The log line is
secret-free: `[startup] migration failed: <ErrorClass> code=<driver code>` — connection strings, hosts, users, SQL text and values are never printed;
the only message passed through is the migrator's own `migration NNN_name.sql was changed after being applied`.

Safe data handling: nothing at startup drops, resets, seeds, backfills or force-syncs schema/data; an applied migration whose file changed is refused
(write a new migration instead), and history is never rewritten. No new environment variable is needed: the same `DATABASE_URL`
(and test-only `HANQ_TEST_DATABASE_URL`) as before. Use a session-mode connection (Supabase session pooler / direct) so the advisory lock holds for
the whole run. Note the existing pool limits (statement 15 s, query 20 s): a second instance that waits longer than that behind another instance's
migration exits with an error and is restarted by the host, then finds the files applied. `npm run migrate` and `npm run seed` still work on their
own; seeding is never run at startup. Integration tests build the app with `bootstrap.createApp` directly and never migrate on startup (they reset
only an isolated loopback `*_test` database via `test/helpers/db.ts`).

## Configuration (see `.env.example`)

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `postgres://`/`postgresql://` URL, or the JDBC form `jdbc:postgresql://host:5432/db?user=…&password=…` (decoded in memory only; repeated or conflicting user/password fails). Supabase **Session pooler** (IPv4, port 5432) works. TLS-related query params (`sslmode`, `ssl`, …) are ignored. |
| `HANQ_DB_SSL_MODE` | `verify-full` (default; required in production) or `disable` (loopback + non-production only). |
| `HANQ_DB_CA_FILE` | PEM of the server CA; always takes precedence. If unset and the host is a Supabase host, `certs/supabase-prod-ca-2021.crt` is used, but only if its SHA-256 equals the pin in `src/db/supabase-ca.ts` (`80:70:25:AD:…:CA:FA`, source: Supabase Studio's download link). `rejectUnauthorized` and hostname checks are always on; global trust is never changed. |
| `HANQ_JWT_ISSUER`, `HANQ_JWT_ACCESS_SECRET`, `HANQ_JWT_REFRESH_SECRET` | two different random ≥32-char secrets; required in production. The older names `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are read only when the `HANQ_` ones are empty (startup warning); both set differently = startup error (names only, never values). |
| `HANQ_CORS_ORIGINS` | exact https origins of the front (comma separated). |
| `HANQ_COOKIE_SAMESITE`, `HANQ_COOKIE_SECURE` | refresh cookie; Secure forced in production. |
| `HANQ_PREMIUM_PERIOD` | `calendar-month` (default) or `fixed-days` + `HANQ_PREMIUM_FIXED_DAYS`. New purchases use fixed30 days; existing expiry dates remain unchanged. |
| `HANQ_PAYMENT_PROVIDER` | `none` (default: checkout answers 503) or `test` (development/test only; startup fails in production). |

## 운영 원칙

현재 홈서버 운영과 이전 Node/Render·Supabase 이력을 구분한다. 이전 Vercel·Render는 아직 중지되지 않았으며 중지/전환은 통합 담당이 별도로 조율한다. 마이그레이션·seed·설정·유료 자원 변경은 문서 정리의 일부가 아니다. 가입/세션/채점·정산을 검사할 때 실제 사용자 데이터 대신 격리 환경을 사용한다. 신규 결제 제공자·환불·다중 인스턴스 지원을 이 문서가 활성화하지 않는다. 현재 기능 상태·검증 한계·다음 업무는 위 버전 문서를 따른다.
