# HanQ 서버 기획 범위

제품 전체 기획의 기준은 [FE 전체 기획](https://github.com/blockmonkey1992/hanq/blob/dev/docs/design-outline.md)이다. 이 문서는 서버 책임만 다룬다.

API는 기존 로그인, 공통 학습 자료와 개인 답안 분리, 채점·성장 이력, 얼음섬 초대/대결/리뷰 및 개인 전투 오답을 담당한다. 클라이언트 표시가 서버의 정답·소유권·마감·피해·XP 판정을 대신하지 않는다.

현재 Supabase PostgreSQL과 단일 Render 서비스를 사용한다. 이번 정리에는 DB 이전·요금제 변경·인증/권한 변경이 없다. 무지개마을 실제 기능, 전투 효과음, 다중 서버 pub/sub와 반복 대결 보상 악용 정책은 향후 별도 범위다.

[개발 설계](design-development.md), [서버 사용자 흐름](design-userflow.md), [현재 계획](versions/v0.1.0/plan.md), [진행](versions/v0.1.0/progress.md), [결과](versions/v0.1.0/report.md)를 입구로 한다. 사용 중인 계약·운영 매뉴얼은 연결하고 중복 설명은 현재 설계로 통합한다.
