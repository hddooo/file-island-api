# File Island API · 개발·디자인 ChatGPT 작업 인계

서버 계약·자료/권한·로컬 실행은 [README](README.md), [설계](docs/design-development.md), [API](docs/api.md)가 기준이다. 제품 흐름·디자인 상세는 [FE README](https://github.com/hddooo/file-island-web/blob/main/README.md), 공통 규칙 원본은 [FE COLLABORATION](https://github.com/hddooo/file-island-web/blob/main/docs/COLLABORATION.md)(hanq-collaboration-2026-11-01-v5)다. 옛 호스트/운영 dev 설명은 현재 홈서버/main과 구분한다. 새 디자이너가 서버 데이터/권한을 직접 바꾸지 않도록 API 의존성을 먼저 합의한다.

## 빠른 실행과 검수 경계

Node24, PostgreSQL15+가 필요하다. 저장소 루트에서 실행하며 실제 프런트 카탈로그 위치를 `HANQ_FRONT_DIR`로 지정한다. PowerShell 예시는 `$env:HANQ_FRONT_DIR = (Resolve-Path ../file-island-web).Path`다. 비공개 자료 의존 검사는 승인된 fixture가 없으면 미검증으로 보고한다.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
# 개인 로컬 .env/DB 설정을 준비한 뒤:
npm run start:dev
```

전체 unit은 공개 checkout만으로 전부 통과한다고 보장하지 않는다. [baseline CI](.github/workflows/ci.yml)의 제외 목록과 [전체 qualification](docs/functional-producer.md)은 별개다. `npm run integration`은 오직 loopback의 이름이 `_test`로 끝나는 폐기 가능한 DB와 `HANQ_TEST_DATABASE_URL`을 사용한다. helper가 `hanq` schema를 DROP하므로 운영 URL을 사용하지 않는다. 테스트는 `.env`를 읽지 않는다. 로컬 `migrate`/`seed`/`start:dev`는 .env를 읽고 DB를 변경할 수 있으며 운영 Docker bootstrap 절차와 다르다.

현재 API에는 VERSION/RELEASE_VERSION/app-version.json 기준 파일이 없다. package0.1.0·schema54/056·원문 SHA·quiz digest·숫자 CAS는 서로 다른 값이다. README의 릴리스 증거와 기존 버전 기록을 따른다. API health는 버전 증거가 아니다. feature push는 현재 main-only baseline CI를 실행하지 않으며 수동 image 빌드도 배포 완료가 아니다. 운영987/schema54,056 미적용, 새147 기본 OFF와 준비된 history/auth capability 후보를 구분한다.

## 작업 시작과 파일 소유권

1. [README](README.md), [AGENTS](AGENTS.md), [CLAUDE](CLAUDE.md), 해당 설계/버전 기록을 읽는다. 사용자 후속 지시와 실제 코드·검사·운영 상태를 대조한다. 이 파일은 기존 지침을 대체하거나 새 권한을 부여하지 않는다.
2. 저장소 루트에서 아래 명령으로 branch/기준 SHA/작업 흔적을 확인한다. 다른 담당자의 변경·미추적 파일을 보존한다. 별도 feature branch/worktree에서 맡은 파일만 수정한다.

```sh
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
```

3. 수정 파일·의존 계약·검사 범위를 통합 담당과 정한다. 같은 화면의 CSS/JS가 다른 파일이어도 host·라우트·공통 선택자를 공유하면 조율한다. 담당자 대화 ID 대신 아래 파일 경계를 지속 기준으로 사용한다.

| 작업 영역 | 우선 소유하는 파일/결정 | 조율이 필요한 경계 |
|---|---|---|
| 한국사 원문·독서 | FE `media/textbook-*`, `media/private-textbook.js`, `scripts/*history*`; API `src/textbook/`과 관련 검사 | 원문 자료 담당과 reader 담당의 세부 파일 분리, source SHA·digest·구판 복구 |
| 영어 | FE `media/toeic-*`, `media/lc-*`, `media/audio-player-ui.*`, 단어/문법 자료와 관련 검사 | API TOEIC 계약·공유 자료/개인 답안, 기출/정답/음원 추가 |
| ADMIN·기록 | FE `media/admin-*`, `media/my-records.js`, `media/hall-of-fame.*`; API 관련 도메인/검사 | 권한·감사·개체 XP·056 release gate; 실제 회원 정보 |
| 장면·디자인 | FE `media/world-*`, `media/island-harbors.*`, `media/*scene*`와 승인된 에셋/검사 | 지도 hit 영역·원화·다른 영역의 공통 header/route/스타일 |
| 인프라·릴리스 | workflow·빌더·승인된 release 설정과 검증 | 실제 runner/배포·DB·자료 mount는 승인 범위와 통합 순서 확인 |
| 문서 인계 | 두 저장소의 `README.md`, `CHATGPT.md` | API 계약/semantic 문서 변경은 해당 담당과 별도 조율 |
| 공통 통합 | `index.html`, `ops/index.html`, `inquiries/index.html`, API client, 공통 CSS, manifest, RELEASE_VERSION, CHANGELOG | 통합 담당 한 명이 변경·main 반영·배포 순서를 조율 |

이 표는 영역별 출발점이며 디렉터리 전체에 대한 독점 권한이 아니다. 실제 착수 시 정확 파일 목록을 나눈다. 디자이너는 한국사 모바일·데스크톱 시안, 디자인 명세, 적용 파일 목록을 먼저 준비하고 구현 담당과 조율한다. 별도 시안 단계가 실제 코드 적용·main 배포를 뜻하지 않는다. 외부 상대에게 메시지를 보내거나 저장소·서비스 권한을 설정하는 행동은 이 문서 작성 범위에 포함되지 않는다.

## 데이터·기능 보존

기존 route·안정 ID·보기/정답·content version·읽음/체크·attempt·중단 workspace·개인 저장 키를 보존한다. 로그인 전환/화면 이탈/늦은 응답·재시도/CAS/멱등 키를 검수한다. XP·HP·부화·장착·정답은 서버가 확정한 계약만 표시하고, 미확인/null을 0이나 성공으로 채우지 않는다. 새 API가 필요하면 요청/응답·권한·오류·fallback·배포 순서를 API 담당과 먼저 맞춘다. 현재056와 새147 판본의 기본 OFF 경계를 디자인 정리로 해제하지 않는다.

비밀번호·토큰·쿠키·DB 접속값·개인정보·회원 답안·교재 원문·비공개 추출물·내부 비공개 지침이나 개인 메모 경로를 공개 문서/로그/프런트에 추가하지 않는다. 합성 fixture와 실제 원본/운영 검증을 구분한다. 콘텐츠 추가·원문 재현은 README의 기존 매뉴얼 링크를 따른다.

## 디자인·모바일·접근성

- 사용자에게 필요 없는 반복 안내/TIP·중복 제목·상시 성공 문구는 화면에서 줄인다. 실제 오류·자료 없음·접근 제한·저장 복구, 출처/권리 고지와 원문 내용은 보존한다. 구현 내부 설명을 제품 화면 안내로 추가하지 않는다.
- 물·파도·구름·안개·배 내부 움직임은 원화·고정 지형·메뉴 hit 영역을 보존하는 독립 레이어/국소 마스크로 자연스럽게 만든다. **전체 배경 이미지나 페이지를 흔들거나 확대/축소하는 것으로 내부 움직임을 대체하지 않는다.** 전체 루프의 이음새·위상·화면 이탈·숨김·로드 실패·축소 모션을 검수한다. 이 항목은 다음 디자인 작업 기준이며 모든 배 장면 구현 완료를 뜻하지 않는다.
- 원본 alpha·실루엣·비율·registration을 먼저 확인한다. 별도 후보로 작업하고 포요몬 머리를 가로로 잘라 회전하는 rig를 재도입하지 않는다. 학습 본문 복사·세로 스크롤·pinch 확대를 보존한다.
- 320/390/1440px와 낮은 가로 화면, 긴 이름/문장/표, safe-area·footer·실제 44px hit를 확인한다. semantic control·label·focus-visible·dialog 닫기/Escape/초점 복귀·뒤로/새로고침·색 외 단서·reduced-motion을 검사한다. 합성 Chromium/WebKit 결과를 실제 iPhone/Safari 확인으로 표시하지 않는다.

## 검수·main 통합·인계 완료

기능 → 회귀 → 모바일/시각의 순서로 변경에 맞는 검사를 수행한다. 문서 전용 변경은 내용·명령·링크·파일 경로 검사로 검증한다. 다른 담당자 코드를 덮어쓰거나 검사를 약화해 통과시키지 않는다. feature push 후 정확 SHA CI 상태를 확인하고 main 병합/배포는 통합 담당과 조율한다. 이 작업자가 독립적으로 main을 바꾸지 않는다. 새 main에 다른 작업이 들어왔으면 재통합·필요 검사 후 진행한다. force push를 사용하지 않는다.

인계에는 목표, 기준/결과 branch·전체 SHA, 실제 변경 파일, 보존 계약, 실행한 명령·결과·자료/브라우저 한계, 정확 SHA CI URL/상태, 운영 domain/version/build SHA/자산 대조, 남은 의존성과 다음 한 단계를 적는다. 구현·검사·push·CI·image 빌드·운영 배포를 구분한다. 실행하지 않은 검사나 미배포 후보를 완료로 쓰지 않는다. 자동 승인/접근 제한으로 차단되면 행동·대상·이유·완료 범위·denied/pending/uncertain을 그대로 전달한다.
