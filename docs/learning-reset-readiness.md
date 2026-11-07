# 개인·섬별 오답 기록 초기화 (2026-11-07)

## 확정 범위
역사섬/영어섬을 각각 선택해 기준 시점 이전의 오답 항목·누적 오답·나의 기록의 해당 오답 답변을 화면에서 제외한다. 원본 기록은 물리 삭제하지 않는다.
XP·보상원장, 일반 정답 답변(오답 문제를 다시 맞힌 답변 포함), 일반 진행, 문제 원본·교재·단어장, 다른 계정/섬, 배틀 기록은 보존한다.
원본 교재의 사전 오답 분류/문제 목록과 음원·PDF 자료 자체는 삭제하지 않는다.

## API/DB
- migration 060_wrong_history_resets.sql: 소유자+섬 기준일, 소유자+request UUID 중복 방지, SQL 가시성 함수/뷰만 추가.
- GET /api/v1/me/learning-resets: available, scope:wrong_answers_only, 두 섬 resetAt.
- POST 같은 경로: island(history|toeic), confirmation(RESET_HISTORY|RESET_TOEIC), requestId(UUIDv4).
- JWT의 userId만 사용. 소유자 잠금과 트랜잭션. 다른 사용자를 지정하는 필드는 whitelist 거절.
- resetAt은 서버 시각. 재시도는 초기화 시각을 연장하지 않음. 다른 섬에 같은 requestId 재사용 409.
- reset 이후 새 일반 역사/토익 practice 오답 제출은 답안 생성 때 캡처한 resetAt을 전달해야 한다. 구세대 미지정/다른 시각은 409 learning_reset_changed. 정답 및 기존 idempotency 재응답은 유지.
- 과거 역사 import 오답은 원래 ts 기준 제외. ts 없거나 reset 이전이면 before-wrong-history-reset skip. 정답 import는 유지.
- 이전 run/replay/CBT에서 늦게 제출된 오답은 부모 세션 생성 시점으로 제외. 원래 세션/정답 기록은 보존.
- growth_ledger·불변 트리거·기존 원본 행은 변경하지 않음. 일반 첫결과/활동달력은 원본 사실로 보존.

## 반영 경로
오답 repository(current/stale/cooldown), attempts 목록, CBT wrong-only 선택, 토익 studyHistory/Practice history, focus 오답 집계, MyRecords.
MyRecords 배틀·배틀복습은 source가 unknown이 아닌 별도 섬으로 보존.
일반 quizProgress는 기존 그대로 유지. 역사 오답 복습의 과거 세션 상세/점수는 보존된 역사적 사실이며 새 오답 풀과 구분.

## 검증과 상태
단위: 잘못된 섬 확인 차단(쿼리 0), stale generation 거절, owner override 거절.
격리 loopback 임시 PostgreSQL: 합성 A/B 사용자, 역사/영어 각각 초기화, 정답·원본행·다른 계정 보존, request 재시도/충돌, XP 원장 전체 불변, 오래된 오답 import skip, MyRecords 잘못된 답변만 제외, 영어 누적 오답 0 확인.
운영 DB/사용자 기록은 테스트하지 않았다. 실제 reset을 대신 실행하지 않는다.
기능·회귀·브라우저 통합과 정확 SHA CI/운영 배포는 별도 확인 후 보고해야 한다.

## 배포 주의
운영의 055+057 strict migration manifest를 보존하고 060만 추가하는 통합 배포 필요. 다른 작업의 058/059를 임의 적용하지 않는다. 일반 migrate/전체 main 이미지 교체 금지.
FE/API 양쪽 준비 및 브라우저 통합 전 운영 초기화 활성화 금지. 서버 migration/새 API 부재 시 FE fail-closed.
