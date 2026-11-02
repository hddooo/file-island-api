# File Island 저장소 이관 기록

## API image producer와 CD 인계 구현 (2026-11-02)

기존 baseline 테스트 CI와 원본 held/Dockerfile/producer/SQL은 유지합니다. 새 수동 `.github/workflows/image.yml`과 `scripts/build-file-island-image.cjs`는 main의 정확한 새 API Git SHA에 묶인 **이미지 build 증거만** 만듭니다. Git blob으로 별도 LF context를 작성하고 기존 비활성 runtime-mount Dockerfile 후보를 명시적으로 선택합니다. 비공개 자료·비밀 파일·host credential은 context에 넣지 않습니다. 원본 Dockerfile은 교체하지 않습니다.

build 후 network-none/readonly/권한 축소 container에서 API bootstrap 모듈 import, argon2 합성 hash와54개 SQL/privileges 원본 바이트를 검사합니다. API 서버·DB·실제 bootstrap·비공개 자료는 실행/연결하지 않습니다. 공식 pinned base를 유지하고 Docker build의 부가 attestation/index 출력을 분리하여 기존 archive gate가 요구하는 단일 runtime manifest와 config digest를 직접 검증합니다. GitHub run/artifact 출처 인증은 별개이며 생략하지 않습니다.

기본 이미지 producer·functional binding·migration preflight는 같은 `scripts/schema54-contract.cjs`의54개 계약을 유지합니다. 001–055 중047이 없는54개 전체 filename/checksum을 manifest SHA256 `c082a2e30f2caab4d2e7802944fb58c4f60e890c636e6d5a30958ebd9d04fdfa`로 고정하고, privileges SHA256 `9fc57d632355720757da4ec9ba9a44fcb59bae296b295fb561e0a494039960c0`도 유지합니다. 개수만 같은 SQL 교체와 image receipt의 privileges 불일치도 거절합니다. 현재 migration harness는 복원 뒤 적용0개·기존54개·데이터 불변을 검사하므로056/schema55의 upgrade 검사가 아닙니다. Functional qualification과 migration 실행 입력은 계속54개만 인정합니다.

별도 이미지 제작 profile `schema55-image-only`는 명시적으로 선택할 때만 허용합니다. `scripts/migration-build-profile.cjs`는 기존54개 전부와 unchanged privileges에 `056_admin_partner_xp.sql` SHA256 `13eeb81ff165a6ad1ad03aa2c1793ede79e020cdd5cc5383917fe740cd6796ab` 한 개만 추가된 정확한55개를 요구합니다. Canonical `{version,checksum}` row 배열 SHA256은 `e7f9138ab0372e165396771c5eec671b738cdc31b497261158b451c012a35b83`이며 manifest JSON 파일의 서식 포함 SHA와 구별합니다. 수동 image workflow의 기본값은 `schema54`이고 두 번째 선택은 이미지 제작만 허용합니다. profile을 생략하거나 `schema55`/`auto`처럼 다른 이름을 주면55개를 받아들이지 않습니다. 로컬 확인은 `node scripts/build-file-island-image.cjs --verify-config --migration-profile schema55-image-only`이며 Docker를 실행하지 않습니다. 이 검사는 현재 checkout의 실제 HEAD를 읽으므로55개가 들어 있는 정확한 통합 commit에서만 성공할 수 있습니다.

Image receipt에는 선택한 `migrationProfile`을 기록하되6suite는 계속 not_run/unverified이고 productionQualified=false입니다. `check-image-cd-handoff.cjs`는 inventory/hash만 오프라인으로 대조하며 ready=false/운영 migration 불허를 유지합니다. receipt의 authenticated=true 주장만으로 completed/success run·정확 attempt·artifact digest를 인증하지 않습니다. schema55의 PG17 backup/restore·056 upgrade·idempotency·legacy data 보존·rollback과 전체6suite 근거는 별도 선행조건입니다. 새 CD entry·runner·credential·권한·운영 apply를 만드는 기능은 없습니다. 이 profile 후속 소스는54 완료 commit과 분리하며, 원격 반영·dispatch는 별도 조율합니다.

SQL 기대값은 고정 row/privileges hash이며 현재 SQL에서 다시 계산한 값을 새 기대값으로 받아들이지 않습니다. 실제 image source는 checkout에서 한 번 확인한 전체 Git SHA와 CI event SHA를 대조해 receipt에 바인딩합니다. mutable ref·축약 SHA는 source manifest 입력으로 거절합니다. 검토된 Growth 원본 SHA와 최종 helper 통합 SHA는 구별하며, 체크인 파일에 자기 자신의 최종 commit SHA를 요구하지 않습니다. 과거 fixture의 reviewedSource 값은 현재 release source로 사용하지 않습니다.

API 테스트 container는 각 child TAP의 summary를 정확히 한 번씩 요구합니다. 중복 summary로 앞선 실패를 덮거나 실패·SKIP·TODO·bail-out을 정상 count로 포장한 결과는 qualification에 사용하지 않습니다. 원본 TAP와 비공개 fixture는 artifact에 내보내지 않습니다.

결과는 `file-island-api-image-<SHA>-<run>-<attempt>` artifact의 image archive와 `release.json`, context manifest/checksum입니다. `release.json`은 항상 productionQualified=false이고6개 배포 자격 suite는 not_run/unverified입니다. `release-evidence.json`이나 인증된 functional qualification을 만들어낸 것으로 보고하지 않습니다. 로컬 `--local-build`는 run ID를 조작하지 않으며 local-unqualified로 기록합니다. 기존 controller가 허용하는 `hanq-release-evidence-*`와 다른 이름으로 보존합니다.

`scripts/check-image-cd-handoff.cjs <image-receipt> [controller-source]`는 읽기 전용으로 남은 계약을 보고하고 ready=false/exit2를 반환합니다. apply/설치/재시작 기능이 없습니다. 관찰한 controller는 원본 API/functional.yml 고정이며 mount6개만 허용하여 승인된 readonly 음원이 포함된 현재 운영 compose와 맞지 않습니다. 음원을 제거하지 않고 controller policy·native 설치·approval을 별도로 검토해야 합니다. 외부 semantic bundle의 추가 readonly mount/읽기권한/무결성 검증도 필요합니다.

후속 인계 대상은 기존 private `blockmonkey1992/hanq-home-deploy`의 owner-controlled 수동 제어와 기존 Windows runner입니다. 새 runner 등록 없이 유지하는 안을 우선하며, 새 private API Actions/Contents 읽기에 필요한 인증 주체와 정확 범위를 먼저 확정해야 합니다. 신규 접근 권한·credential·controller 설치·운영 image 교체는 이 코드 구현에 포함하지 않습니다. 전체6suite/격리 restore/FE·deploy 정확 SHA 증거·기존 audio와 rollback 보존 전에는 production cutover를 허용하지 않습니다. schema54/056 분리를 유지합니다.

## Windows 조사와 전환 준비 (2026-11-02)

준비 branch `prep/windows-migration`, 기준 main `96c6b7a1fdc16660edb97676ed5f8a5ba1b3d4ec`. 새 repo SHA는 기존 Git Credential Manager 인증을 재사용한 원격 조회로 확인했습니다. 이 변경은 문서와 비활성 build 후보의 소스 동기화입니다. CI 실행·운영 반영은 별도입니다.

### 직접 확인한 운영 상태

- 호스트 `DESKTOP-LKMB8TS`; Docker server 29.9.2 / context `desktop-linux`; WSL은 `docker-desktop`만 등록·실행 중인 것으로 확인했습니다. Linux `/etc` 제안을 Windows 운영 경로로 취급하지 않습니다.
- API `hanq-api-staging`: healthy, loopback `8080`, image `sha256:5ffd2cc49f557fab789dd8f5092350ff27c8396ccfee0dda1c29c774e0a347b6`, image source revision `987be5798893b0023674a194626704a9d5033a37`.
- PostgreSQL `local-postgres` healthy. 기존 Nginx Proxy Manager `fileisland-npm-local` 실행 중. 관련 port 점유는 API 8080, DB 33006, proxy 18080/18081/18443이며 proxy HTTPS 18443은 기존 LAN에도 bind되어 있습니다. 80/443/8082 listener는 조회 당시 없었습니다. 외부 접근·DNS·TLS 유효성·새 공개 port는 확인하거나 변경하지 않았습니다.
- C: 여유 약377GiB, D: 약1.1GiB. Docker image 약5.5GB / build cache 약2.1GB. 정리·삭제하지 않았습니다.
- 실제 API compose: `C:\Users\INNOGRID\Documents\Codex\2026-10-29\task\candidate\hanq_final_20261028.compose.json`; bootstrap은 같은 폴더의 `hanq_final_20261028.bootstrap.mjs` → `/run/hanq-production/bootstrap.mjs` readonly bind입니다. 비밀 파일/CA/음원 mount는 [설정 계획](secrets-plan.md)의 Windows 표를 따릅니다.
- runner 실행파일: `C:\Users\INNOGRID\Documents\Codex\2026-10-28\task-2\runner-package\unregistered\bin\Runner.Listener.exe`; 설정 이름 `hanq-home-windows`, 연결 repo `blockmonkey1992/hanq-home-deploy`. 프로세스와 `HanQ-Interactive-Deploy-Runner` Running, 최신 runner 로그의 listening/session 생성은 확인했습니다. GitHub 서버의 현재 online badge는 직접 확인하지 않았습니다. `HanQ-API-Recovery` Disabled는 유지했습니다.
- runner checkout은 `_work\hanq-home-deploy\hanq-home-deploy\hanq-verify-source` SHA `4b105f4b9bd718a9eb854ed7a377f663c172a28e`, `hanq-contract-hash-source` SHA `50ea6a4f5294f886203d2200b651985d5f2eb2c3`. 두 checkout은 clean입니다. 이들은 API 소스 SHA가 아닌 배포 도구 SHA입니다.
- 도구 실행 view의 `%LOCALAPPDATA%\HanQDeploy\deploy.cjs`는 34079 bytes / SHA256 `6ac725dce62e4270e4c1f1adf36b2100ddbcd4423c950e60ccdf681c76d97a6f`. 과거 문서에 Scheduler native view 차이가 기록되어 있어 이 readback을 실제 Scheduler 설치 검증으로 간주하지 않습니다. 재설치·예약 작업 실행은 하지 않았습니다.

후속 읽기 점검에서 Windows PowerShell 직접 조회도 같은 deploy.cjs 크기/hash를 반환했습니다. deploy.cmd는169 bytes / SHA256 `71cff0d4694e3592e96c30da5ae8500c40a8da1ccdc45052c09d33620d9368f8`입니다. 두 파일 ACL은 상속을 허용하며 조회한 광범위 사용자 principal의 write allow는0개였습니다. 이는 완전한 보안 감사나 Scheduler에서 controller를 실행한 검증이 아닙니다. runner Scheduler action의 supervisor/RunnerDirectory는 실행 중인 listener 경로와 일치하며 Interactive/Limited입니다. Listener1개, Worker0개, deployment.lock 없음, 복구 task Disabled를 확인했습니다. recovery state에는 recoveryEnabled 필드가 없어 그 값은 미확인입니다. 현재 approval은 source987/schema54와 compose/bootstrap hash를 가지지만 testEvidence/provenance/controllerSha256은 없습니다. 현재 도구 process의 provenance token 환경변수는 부재하며 새 repo Actions 읽기 권한은 미확인입니다.

후속 DB 조회는 기존 passwordless local socket과 READ ONLY transaction만 사용했습니다. 기대 DB 일치, PostgreSQL17.11, migration54행/최대055/047없음/056없음을 확인했고54개 checksum은 Git 원본 blob과 모두 일치했습니다. 단, Windows checkout의54개 SQL은 CRLF 변환 때문에 운영 checksum과 다르므로 Windows Docker build에서는 Git 원본 LF 바이트를 보존한 별도 context가 필요합니다. 이 문제를 migration 재적용으로 해결하지 않습니다. dump/restore/migration/일반 startup은 실행하지 않았습니다. 운영 프론트 `cfc9892a2a180a33b177a8689bcdfa8f0b5607f7` 0.2.9 및 실제 HTML/19자산 검증 완료는 FE 담당 전달 사항입니다. 기존 dev/Vercel은 변경하지 않았습니다.

### 비공개 자료와 비활성 build 제안

실제 semantic bundle은 `C:\Users\INNOGRID\Documents\Codex\2026-10-28\task-2\api-ci-validation\private-textbook-semantic-data`에 있으며 파일 수298개를 확인했습니다. 내용·해시·container node 사용자의 읽기 가능 여부는 이번에 검증하지 않았습니다. 원본 자료를 복사하거나 image context에 넣지 않았습니다.

`ops-prep/Dockerfile.runtime-mount.disabled`와 전용 `.dockerignore`를 준비했습니다. 원본 Dockerfile은 유지하고 제안 파일에서만 private bundle COPY와 build-time bundle 검사를 분리했습니다. pinned base/non-root/bootstrap CMD/migrations는 보존했고 source label만 새 repo로 지정했습니다. 전용 ignore는 비공개 bundle을 context에서 제외합니다. pinned base image가 로컬에 없고 새 pull/설치/운영 접근 없이 마치는 소스 준비 단계이므로 Docker build·container 실행·기능 검증은 미실행입니다. production image가 아닙니다.

향후 승인된 격리 검사에서 실제 bundle을 `/app/private-textbook-semantic-data`에 readonly bind하여 `scripts/check-textbook-bundle.cjs`를 실행하고 node 사용자의 접근을 검증해야 합니다. 고정 경로와 realpath 검사 때문에 다른 환경변수나 symlink로 대체하지 않습니다. 이 검사 분리는 교재 검증 생략이 아니며 배포 증거에 성공 결과를 반드시 포함해야 합니다. 기존 음원 readonly mount는 semantic bundle과 별개로 유지합니다.

### 저녁 전환 순서와 승인 대상

1. FE `prep/windows-fe-029`의 17파일 delta(16 일반 파일 + held CI1개)를 새 web에 동기화합니다. 초기931 snapshot에서 0.2.9 소스로 갱신하는 단계입니다. `.github/workflows-held/ci.yml.disabled`만 갱신하고 활성 workflow는 만들지 않았습니다. 새 README 이관 안내도 보존했습니다. 기존 FE 담당 CI/배포는 독립적으로 유지합니다.
2. API 비활성 Dockerfile 후보를 검토하고 secret 없는 clean build·교재 mount 검사·별도 격리 DB/bootstrap 검수를 준비합니다. 운영 DB·키를 시험 실행에 연결하지 않습니다. schema54 SQL hash/055 반영을 확인하고 Growth/056은 별도로 둡니다.
3. controller 신뢰 원본은 현재 `blockmonkey1992/hanq_api`와 `.github/workflows/functional.yml`에 고정되어 있습니다. 새 snapshot SHA/source label/workflow/evidence와 배포 도구의 provenance 정책을 함께 검토·테스트해야 합니다. repo 주소만 치환한 apply는 허용되지 않습니다. 현재 controller는 schema 변경을 거절하므로 migration056은 이 전환에 포함하지 않습니다.
4. **승인 필요:** 새 API repo의 Actions/Contents 읽기 인증 수단, `hddooo` runner 등록/접근 범위(기존 runner 이동은 기존 제어 영향 포함), environment 보호 규칙, controller 설치의 정확 bundle/hash. 이번에 생성·등록·설치하지 않았습니다. 일반 소스 CI는 secret 없이 GitHub-hosted로 분리하고, self-hosted 배포는 신뢰한 수동 workflow만 대상으로 설계합니다.
5. **별도 승인 필요:** API image 교체 대상 `hanq-api-staging`, 고정 후보 image/SHA와 기존 DB/JWT/CA/음원 mount 재사용, rollback image/compose/bootstrap hash. 실제 변경 직전 native controller와 현재 baseline을 재확인합니다. env-file·키 rotation은 선제적으로 만들지 않습니다.
6. 정적서버는 기존 NPM을 HTTPS proxy 후보로 재사용할 수 있습니다. 공개 허용 asset만 별도 폴더에 readonly mount하고 loopback8082 후보를 검사하는 설계를 검토합니다. `HanQPrivateMedia`나 semantic 자료를 public root로 사용하지 않습니다. **승인 필요:** 정확 domain·NPM proxy host·인증서·포트·방화벽/DNS 변경. 기존 노출 설정이 새 static 공개 승인이 되지 않습니다.
7. 새 FE hosting 연결은 별도 항목입니다. **승인 필요:** 새 `hddooo/file-island-web`에 대한 GitHub/Vercel 연결과 실제 전환 대상. 전환 후 새 commit의 version/HTML/자산 hash, API 인증/CORS/cookie/교재/음원과 rollback을 검증합니다. 기존 dev/Vercel 연결 해제는 그 검증과 별도 승인 이후입니다.

준비/조회는 끝났지만 새 CI/CD는 연결하지 않았습니다. 추가 비밀값 입력은 현재 단계에 필요하지 않습니다. 신규 인증이 실제로 필요하면 대상·권한·안전한 사용자 입력 위치부터 확정합니다.

원본 저장소: `blockmonkey1992/hanq_api`

원본 SHA: `987be5798893b0023674a194626704a9d5033a37`

방식: 새 저장소의 초기 README 커밋을 부모로 하는 소스 snapshot commit으로 이관합니다. 원본 Git history를 mirror하지 않습니다. 원본 저장소 이름·소유자·브랜치·remote·운영 배포는 변경하지 않습니다.

원격 `dev=c15858cae5d48dbea60118c3f854d6b79fab712a`를 운영 기준으로 사용하지 않았습니다. 개발 후보 `3654b914ab7b3fe956d102bf46ae8960b1934dd7`와 `migrations/056_admin_partner_xp.sql`은 이 main 스냅샷에 섞지 않습니다. 후보의 원본 Git 객체와 작업 폴더는 그대로 보존했습니다.

운영 `schema54`는 적용된 versioned SQL 파일이 54개라는 뜻입니다. 파일 번호는 최대 `055`이고 `047`이 없는 구성입니다. 앞선 운영 검증에서 원본 54개 SQL의 해시 일치와 `055_coin_eggs_timed_hatch.sql`의 운영 반영을 확인했습니다. 따라서 `055`는 미적용 파일이 아니며 이번 이관을 위해 추가 migration할 필요가 없습니다. `056_admin_partner_xp.sql`은 별도 미배포 Growth 후보입니다. 이번 문서 정정에서는 운영 DB를 조회하거나 migration을 실행하지 않았습니다. `npm start`는 일반 migrator를 호출할 수 있으므로 운영 연결 전에 실행하지 않습니다. Dockerfile의 `/run/hanq-production/bootstrap.mjs`는 외부 운영 마운트이며 이 저장소에 복사하지 않았습니다.

제외한 비공개 `private-textbook-semantic-data/` 자료 298개는 정답·파생 교재·이미지입니다. 해당 교재 기능, `scripts/check-textbook-bundle.cjs`, 현재 Dockerfile COPY/build 검사는 별도 비공개 자료 연결 없이는 통과하지 않습니다. 접속·인증 fixture를 내장한 `test/local/native*.cjs` 7개도 제외했으며 일반 소스 컴파일과 환경변수를 사용하는 테스트는 유지했습니다.

## 제외 및 검증 경계

`.env`, 개인 접속 정보, 토큰·개인키, DB dump, 원본 교재·음원을 추가하지 않았습니다. `assets/home-server/hanq-db-connection.txt`는 이 SHA의 추적 목록에 없습니다. 기존 로컬 환경 파일·운영 호스트·Secrets 값은 읽거나 복사하지 않았습니다. 값 없는 경로/키 검사로 후보 문자열을 검토했고 테스트 fixture와 예제만 유지했습니다. 이는 전문 비밀 탐지 도구의 완전한 보증이 아닙니다.

## 자동화 보류

이관 push로 Actions가 실행되지 않도록 모든 원본 workflow를 실행 경로 밖에서 `.disabled` 확장자로 보존합니다. 원본은 GitHub-hosted `ubuntu-latest`를 사용하며 `secrets.*` 참조는 없었습니다. Actions/runner/보호 규칙/Secrets 권한 설정은 변경하지 않습니다.

- `.github/workflows/ci.yml` → `.github/workflows-held/ci.yml.disabled`

## 검사

- `npm run typecheck`, `npm run build` 통과.
- config/credentials/token/session/retention/startup 단위 테스트 63개 통과.
- 기존 로컬 node_modules를 읽기 전용으로 재사용했습니다. clean npm install, Docker build, 전체 unit/integration/DB 검사는 수행하지 않았습니다. 실제 DB 연결·migration·서버 시작은 수행하지 않았습니다.

이 기록은 snapshot commit과 함께 보존합니다. 원격 main SHA와 파일 checksum을 별도로 재조회하여 push 결과를 검증합니다. 기존 공백 문제는 원본 그대로 유지했으며 staged diff --check 경고를 이관 코드 수정과 섞지 않았습니다.

## 외부 마운트와 Docker 전환 조건

현재 Docker build는 완결되지 않습니다. 제외한 `private-textbook-semantic-data/`를 Dockerfile이 build stage에서 COPY한 뒤 `check-textbook-bundle.cjs`로 검사하므로, runtime 마운트만 추가해서는 이 build 실패가 해결되지 않습니다. 실제 Docker build는 실행하지 않았습니다.

아래 host 경로는 새 배포 설계를 위한 제안이며 기존 홈서버의 실제 위치를 조회하거나 생성한 것이 아닙니다. 사용 가능한 기존 자료 위치와 권한을 사용자가 확정한 뒤 연결해야 합니다.

| 용도 | 제안 host 위치 | container 내 정확한 소비 위치 | 다음 해결 단계 |
|---|---|---|---|
| semantic 교재 bundle | `/srv/file-island/private-textbook-semantic-data/` | `/app/private-textbook-semantic-data/` 읽기 전용 mount | 소스 `readSemanticFile()`이 project root 아래 고정 디렉터리를 사용함. `HANQ_TEXTBOOK_DATA_DIR`만으로 이 위치가 바뀌지 않음. symlink 대신 실제 bind mount 필요 |
| 일반 비공개 textbook 자료 | `/srv/file-island/private-textbook-data/` | `/run/file-island/private-textbook-data/` 읽기 전용 mount | 필요한 자료가 있는 경우 runtime에 `HANQ_TEXTBOOK_DATA_DIR=/run/file-island/private-textbook-data` 설정. semantic bundle과 별개 |
| CBT private assets | `/srv/file-island/cbt-assets/` | `/run/file-island/cbt-assets/` 읽기 전용 mount | `HANQ_CBT_ASSET_DIR=/run/file-island/cbt-assets` 설정 |
| CBT manifest | `/srv/file-island/cbt-manifest.json` | `/run/file-island/cbt-manifest.json` 읽기 전용 mount | `HANQ_CBT_ASSET_MANIFEST=/run/file-island/cbt-manifest.json` 설정. manifest 실제 bytes는 Git 외부 |
| 검증된 production bootstrap | `/etc/file-island/bootstrap.mjs` | `/run/hanq-production/bootstrap.mjs` 읽기 전용 mount | 현재 Docker CMD의 정확한 경로. 운영에 적용된 54개 SQL(최대 번호 055, 047 없음)의 검증된 해시를 유지하도록 bootstrap을 검토. 055 추가 적용은 불필요. 기존 host 파일을 무단 복사하지 않음 |
| runtime 환경값 | `/etc/file-island/api.env` | container process environment 주입 | 제안 env-file을 container 실행 관리 설정에서 읽도록 연결. 파일을 image/Git/Actions artifact에 넣지 않음 |

후속 작업은 (1) private 자료 소유·경로·읽기 권한 확정, (2) 비공개 자료를 image build context에 넣지 않는 Dockerfile/runtime mount 방식으로 별도 변경·검수, (3) bundle 검사를 격리된 비공개 검증 작업에서 수행, (4) non-root container 사용자에게 필요한 읽기 권한만 확인, (5) 격리 DB와 staging에서 bootstrap·이미지·기능 검사 순서입니다. 그 전에는 이 저장소를 바로 production 배포 가능한 image로 간주하지 않습니다. 원본 Dockerfile과 기존 운영 bootstrap/이미지는 이번에 변경하지 않았습니다.
