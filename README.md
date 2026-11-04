# file-island-api

파일섬(File Island) 백엔드 API 저장소입니다.

기준 소스 스냅샷을 이 저장소로 이관했습니다. 배포 연결과 Secrets 등록은 아직 진행하지 않았습니다.

## 코드 이관

조선 Script 전용 읽기 경로와 비공개 배치/검증 계약은 [전송 명세](docs/joseon-script-transport.md)를 참조하세요. 운영 배포 상태와 실제 계정 검증은 구현 여부와 별도로 기록합니다.

원본: `blockmonkey1992/hanq_api` / `987be5798893b0023674a194626704a9d5033a37`. Git 과거 이력 대신 검증한 소스 스냅샷으로 이관했습니다.

운영 기준 소스입니다. 원격 `dev` 및 schema056 개발 후보와 분리했습니다. 교재 비공개 번들 298개는 제외하여 해당 기능과 Docker 빌드는 별도 비공개 자료 연결이 필요합니다.

코드 스냅샷 이관 단계이며 운영 전환·배포 연결·Secrets 등록은 진행하지 않았습니다. 원본 workflow는 `.github/workflows-held/*.disabled`에 보존하여 이관 push로 실행되지 않게 했습니다.

설정 위치와 전환 순서는 [Secrets 계획](docs/secrets-plan.md), Docker 제약과 외부 마운트는 [이관 기록](docs/repository-migration.md)을 확인하세요.

## 원본 프로젝트 안내

# hanq_api · HanQ API

NestJS + PostgreSQL 서버 저장소. 기존 인증·서버 채점·개인 기록·성장·얼음섬을 담당한다. 제품/화면 흐름은 [FE 문서](https://github.com/blockmonkey1992/hanq/blob/dev/docs/design-outline.md)가 기준이다. 데이터는 기존 `hanq` 스키마에 둔다.

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

Node 24, PostgreSQL 15+.

```sh
npm ci
npm run typecheck && npm run lint && npm test          # unit tests, no database
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

`npm start` (Render) and `npm run start:dev` run `dist/src/main.js`, which starts in this fixed order (`src/startup.ts`):

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

기존 Node/Render 및 Supabase 설정을 사용한다. 마이그레이션·seed·설정·유료 자원 변경은 문서 정리의 일부가 아니다. 가입/세션/채점·정산을 검사할 때 실제 사용자 데이터 대신 격리 환경을 사용한다. 신규 결제 제공자·환불·다중 인스턴스 지원을 이 문서가 활성화하지 않는다. 현재 기능 상태·검증 한계·다음 업무는 위 버전 문서를 따른다.
