# File Island 환경 설정 및 Secrets 계획

실제 등록: 아직 0개. 기존 GitHub Secret 값은 재조회할 수 없으며 파일/브라우저/프로세스에서 추출하지 않습니다. 새 credential도 생성하지 않았습니다.

## GitHub Actions

원본 FE workflow 3개와 API workflow 1개는 `secrets.*`를 참조하지 않습니다. 코드 보관과 현 CI의 독립 검사에는 Actions Secrets가 필요하지 않습니다. workflow는 `.github/workflows-held/*.disabled`에 보류합니다. `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, SSH key/host/user, AWS key 같은 배포용 이름은 현재 workflow의 요구가 아니므로 선제 등록하지 않습니다.

## API 실행 시 필요한 비밀 항목

| 이름 | 용도 | 필수 여부 | 제안 대상 | 승인할 정확한 작업 |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL 앱 연결 정보 | API 실행 필수 | 향후 확정할 API runtime의 비밀 저장소 | 특정 DB/계정/권한 범위와 runtime을 정한 뒤 그 runtime에 저장. 새 GitHub repo에 기존 운영 DB credential을 지속 사용하게 할지 별도 결정 |
| `HANQ_JWT_ACCESS_SECRET` | access JWT 서명 | production 필수 | 같은 API runtime | 최소 32자, refresh 키와 다른 임의값을 안전한 입력으로 등록. 생성/기존 키 재사용을 먼저 결정 |
| `HANQ_JWT_REFRESH_SECRET` | refresh JWT 서명 | production 필수 | 같은 API runtime | access 키와 별개 값 등록. 기존 키 변경 시 세션 영향 검토 |
| `HANQ_TEST_DATABASE_URL` | loopback `*_test` 격리 DB | DB 통합 테스트에만 필수 | 개발자 로컬; 원격 CI DB가 정해지면 별도 테스트 environment | 운영 DB와 다른 테스트 값 사용. 현재 CI는 요구하지 않음 |
| `HANQ_TEST_DB_PASSWORD` | 선택 local docker-compose 테스트 DB | compose 사용 시 필수 | 개발자 로컬 shell/로컬 비밀 저장 | 실제 사용할 때 사용자 직접 설정. GitHub에 불필요 |

`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`는 기존 별칭이며 신규 등록에는 canonical `HANQ_JWT_*`만 사용합니다. 중복 값 등록은 피합니다.

## 비밀이 아닌 runtime 설정

production 필수: `HANQ_JWT_ISSUER`, `HANQ_CORS_ORIGINS`, `HANQ_COOKIE_SAMESITE`. `NODE_ENV`, `PORT`, `HANQ_COOKIE_SECURE`, `HANQ_DB_SSL_MODE`, CA 경로, pool/TTL/rate limit, trust proxy, 기능 flag는 환경에 맞게 검토할 설정이며 비밀값으로 취급할 이유는 없습니다. CORS·cookie·premium·신뢰 proxy 정책을 이번 이관에서 변경하지 않았습니다.

외부 파일·자료 경로: `HANQ_TEXTBOOK_DATA_DIR`, `HANQ_CBT_ASSET_DIR`, `HANQ_CBT_ASSET_MANIFEST`. 공개 URL 설정: `HANQ_CBT_PUBLIC_ASSET_BASE_URL`. 해당 자료의 실제 bytes·manifest·경로 자격정보는 Git에 넣지 않습니다. API 소스는 미설정 시 기존 frontend 공개 asset URL을 기본값으로 사용하므로 새 운영 연결 전에 확인해야 합니다.

## 안전한 등록 경로

현재는 배포 workflow와 대상 environment가 없어 GitHub Secrets를 등록할 구체적 필요가 없습니다. 향후 Actions에서 runtime 주입이 필요해지면 대상 environment와 읽을 workflow/job을 확정하고 항목별 action-time 승인을 받은 다음, 사용자가 GitHub의 New secret 입력란에서 직접 값을 입력하거나 승인된 안전한 credential 입력 수단을 사용합니다. 채팅에 값을 보내도록 요청하지 않습니다.

GitHub 등록 화면(필요가 확인된 뒤 사용자 직접 사용):
- https://github.com/hddooo/file-island-api/settings/secrets/actions
- https://github.com/hddooo/file-island-web/settings/secrets/actions

새 environment, 접근 권한, runner, deploy key, token, Vercel 연결은 만들지 않았습니다. Secret 등록은 runtime 연결/배포 전환과 별도 승인 단계입니다.

## 집에서 연결할 정확한 설정 위치

| 항목 | GitHub CI | 홈서버 runtime / 로컬 위치 | 필수 시점 |
|---|---|---|---|
| `DATABASE_URL` | 현재 독립 CI에는 불필요 | 제안 `/etc/file-island/api.env`의 `DATABASE_URL` → container process env | API 실행 전 필수. 실제 DB 계정과 권한 확정 후 입력 |
| `HANQ_JWT_ACCESS_SECRET` | 현재 CI에는 불필요 | 같은 env-file의 동명 항목 → container process env | production 실행 전 필수 |
| `HANQ_JWT_REFRESH_SECRET` | 현재 CI에는 불필요 | 같은 env-file의 동명 항목 → container process env | production 실행 전 필수 |
| `HANQ_TEST_DATABASE_URL` | 현재 독립 CI에는 불필요. 향후 DB 통합 CI 정의 시 별도 검토 | 개발자 shell 또는 로컬 API root `.env`의 동명 항목. loopback `*_test` DB 전용 | DB 통합 테스트를 실행할 때만 |
| `HANQ_TEST_DB_PASSWORD` | 현재 CI에는 불필요 | local `docker compose` 실행 shell의 동명 항목 | 선택 local 테스트 DB를 만들 때만 |
| `HANQ_JWT_ISSUER`, `HANQ_CORS_ORIGINS`, `HANQ_COOKIE_SAMESITE` | 비밀이 아닌 runtime 설정, 현재 CI에 불필요 | 제안 `/etc/file-island/api.env` → container process env | production 실행 전 필수. 승인한 실제 도메인 기준 |
| 교재·CBT 경로 변수 | 현재 CI에는 불필요 | 같은 env-file에 이관 기록의 container mount 경로 지정 | 해당 비공개 자료 기능을 사용할 때 |

`/etc/file-island/api.env`는 제안 위치입니다. 기존 홈서버 env-file 경로를 확인하거나 읽지 않았고 파일도 만들지 않았습니다. Docker CMD가 env-file을 자동으로 읽는다고 가정하지 않습니다. 후속 container 실행 설정에서 env-file → process environment 주입을 명시해야 합니다. `.env.example`은 키·형식 참고용이며 비밀값 저장 대상이 아닙니다.

향후 배포 workflow를 작성하여 GitHub에 비밀값을 저장할 필요가 확정되면 정확한 UI 위치는 저장소의 **Settings → Secrets and variables → Actions → New repository secret**입니다. environment 범위를 선택하면 **Settings → Environments → 선택한 environment → Environment secrets**를 사용하며, environment 이름·보호 규칙·접근 주체부터 승인받습니다. 현재 environment를 만들지 않았습니다. runtime DB/JWT 값을 GitHub에 복제할 이유는 현 workflow에 없으며 홈서버에만 보관하는 설계를 우선 검토합니다.

## CI/CD 전환 순서

1. 새 private 저장소 main의 이관 commit과 원본 SHA를 확인합니다. 기존 운영 연결은 그대로 둡니다.
2. GitHub App/Vercel/runner가 새 repo를 읽어야 하는지, deploy job이 무엇을 쓰는지 설계합니다. 접근 권한·새 credential·등록 대상별 승인을 받은 뒤 필요한 항목만 설정합니다. 저장소 생성이나 코드 push로 자동 승인된 것으로 보지 않습니다.
3. 비공개 자료의 외부 mount와 Docker build 제약을 먼저 해결하고 격리된 검사로 image를 검증합니다. 운영 schema54는 54개 versioned SQL이 적용된 상태이며 최대 파일 번호는 055, 047은 없습니다. 앞선 운영 검증에서 54개 원본 SQL 해시와 055의 반영을 확인했으므로 055 추가 적용은 필요하지 않습니다. migration은 자동 실행하지 않습니다. Growth/056은 별도 미배포 후보로 유지합니다.
4. 홈서버 runtime env-file에 필요한 세 비밀 항목과 비밀이 아닌 설정을 안전한 입력/사용자 직접 입력으로 준비합니다. 기존 DB credential·JWT key를 재사용할지, 세션 호환·권한 범위가 무엇인지 명시한 action-time 승인 뒤 수행합니다. 값은 채팅·Git·README·로그에 넣지 않습니다.
5. workflow 보류 경로를 실제 `.github/workflows/`로 복구하기 전에 검토합니다. 현재 independent CI는 secret 없이 동작하도록 설계됐지만 교재/원본 fixture 의존 검사의 경계를 다시 확인해야 합니다. 배포 job은 새 repo SHA·artifact·runtime을 명확히 고정한 별도 변경으로 준비합니다.
6. 격리 staging에서 인증·CORS·cookie·교재·asset·version/schema를 검수하고 rollback할 기존 image/SHA·연결을 확보합니다. API npm start가 일반 migrator를 부를 수 있으므로 기존 운영 DB를 연결한 상태로 시험 시작하지 않습니다.
7. 사용자가 집에서 준비를 확인한 뒤 승인한 배포 연결만 새 GitHub repository로 전환합니다. 운영 점검과 rollback 가능 상태를 확인한 후 기존 자동 배포의 중복 실행 여부를 정리합니다. 기존 연결 해제나 도메인·DB·권한 변경을 이번 코드 이관에 포함하지 않았습니다.
