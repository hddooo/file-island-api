# File Island 저장소 이관 기록

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
