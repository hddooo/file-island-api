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

### 67–69회 심화 CBT 자료 추가 (운영 절차)

- `066_cbt_rounds_67_69.sql`은 실전 응시와 복습의 회차 허용 범위만 67–80으로 넓힌다. 이미 배포된 마이그레이션이나 기록을 변경하지 않는다. 독립적인 복습 결과 동기화용 065를 적용하지 않아도 된다.
- 운영 반영은 기존 마이그레이션 검토 및 `approvedMigrationsTree` 절차를 따른다. 선행 작업은 출처·정답·배점·이미지 해시가 검증된 **67–69회 150문항 전용 비공개 JSON**과 대상 호스트에 대한 권한 확인이다.
- 전체 `seed`는 누락된 현재 문항을 비활성화할 수 있으므로 이 추가에는 쓰지 않는다. 전용 추가 명령은 정확히 150개 원래 문항/보기 ID만 받고, 기존 버전과 충돌하면 중단한다. 동일 입력 재실행은 무변경이며 기존 답안·별표·결과·XP를 쓰지 않는다.
- 비공개 입력 형식은 `{"questions":{"exam-67-01":{...},...}}`이며 문항 본체는 기존 `exam-pool`의 문항 형식이다. UTF-8 입력 파일과 검토된 SHA-256을 사용한다. 운영 자격증명이나 입력 파일을 저장소·로그에 넣지 않는다.
- 빌드 후 정상 운영 설정으로 먼저 `node dist/scripts/append-cbt-67-69.js --dry-run <비공개-파일> <SHA256>`을 실행해 예상 수량과 충돌을 확인한다. 검토·승인된 경우에만 동일 파일/해시로 `--apply`를 실행한다. 마이그레이션과 API 배포 후 인증된 목록에서 세 회차가 각각 50문항·100점·이미지 준비 완료인지 확인한다.
