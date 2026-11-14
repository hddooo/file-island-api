# 홈서버 API 자동 배포

`release/source-grading-current-runtime` 브랜치에 push하면 홈서버 러너가 아래를 순서대로 실행한다.
워크플로: `.github/workflows/home-api-cd.yml`, 실행 스크립트: `deploy/home/deploy.ps1`.

1. **DB 안전 확인** — `migrations/`가 승인된 상태와 다르면 중단한다. DB는 절대 건드리지 않는다.
2. **빌드** — 커밋된 소스 그대로(`git archive`) 컴파일하고 단위 테스트를 돌린다. 실패하면 중단한다.
3. **모듈 로드 확인** — 네트워크·DB 없이 새 이미지의 모든 모듈이 로드되는지 확인한다.
4. **교체** — 기존 compose 설정에서 이미지만 바꿔 `hanq-api-staging`을 다시 띄운다.
5. **헬스체크** — 180초 안에 `/api/v1/health`가 200이 아니면 직전 이미지로 자동 복구하고 실패로 끝낸다.

## 이미지 구성

`Dockerfile.release`는 런타임 베이스 이미지(`node_modules`, 인증서, 비공개 교재 데이터 포함) 위에
이번 커밋의 `/app/dist`만 통째로 교체한다. 릴리스마다 베이스 + 2개 레이어로 일정하다.
`package.json`의 `dependencies`가 베이스와 다르면 빌드가 중단되므로, 의존성을 바꿀 때는 베이스를 먼저 새로 만든다.

## 서버 설정 (Git 밖)

`%LOCALAPPDATA%\HanQDeploy\simple-cd\config.json`

| 키 | 뜻 |
|---|---|
| `baseImage`, `baseImageId` | 런타임 베이스 이미지 태그와 그 이미지 ID |
| `composeFile` | 운영 컨테이너의 compose 설정 (이미지만 릴리스마다 덮어씀) |
| `project`, `service`, `container` | compose 프로젝트·서비스·컨테이너 이름 |
| `healthUrl` | 헬스체크 주소 |
| `approvedMigrationsTree` | DB가 이미 반영하고 있는 `migrations/`의 Git tree ID |

배포 기록은 같은 폴더의 `state\deployed.json`, `state\history.jsonl`, 빌드 로그는 `state\build-<커밋>.log`에 남는다.

## 수동 실행

```powershell
powershell -ExecutionPolicy Bypass -File deploy\home\deploy.ps1 -BuildOnly   # 빌드·테스트만, 운영 미변경
powershell -ExecutionPolicy Bypass -File deploy\home\deploy.ps1              # 배포까지
```

## DB 스키마를 바꾸는 릴리스

자동 배포는 `migrations/`가 바뀐 커밋을 거부한다. 마이그레이션을 직접 검토·적용한 뒤
`git rev-parse HEAD:migrations` 값을 `approvedMigrationsTree`에 넣으면 다시 자동 배포된다.

## 제외된 단위 테스트

`unit-test-exclusions.txt`의 두 파일은 이 저장소 밖 자료(프론트 저장소, 교재 원본)가 있어야 돌아서 빌드에서 제외한다.
