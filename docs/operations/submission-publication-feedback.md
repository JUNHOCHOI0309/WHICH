# 질문 게시 결과·제출 기반 자동 검사 (2026-09-01)

## 사용자 흐름

- 작성 버튼은 텍스트/Library/직접 업로드 모두 `질문 게시`다.
- 직접 업로드는 비공개 제출 → A/B 업로드 → 수정본 연결의 접수가 성공하면 모달을 닫는다. 업로드 오류는 모달에 남겨 재시도할 수 있다.
- 전역 결과 추적기는 본인 제출 ID/revision만 sessionStorage에 보관한다. 이동·모달 닫힘 이후에도 조회하며 실제 `PUBLISHED + publishedIssueId`일 때만 성공 toast를 표시한다.
- NEEDS_CHANGES/REJECTED/QUARANTINED에는 게시 실패 toast, 취소에는 결과 toast 없음. 네트워크 실패나 시간 경과를 게시 거절로 오인하지 않는다.
- `/me/submissions`: 게시 완료 항목은 상태·수정본·검수 문구 없이 `글 바로가기`; 실패 항목은 사유 및 기존 다섯 버튼을 바로 표시한다. 최종 거절처럼 API가 변경을 허용하지 않는 경우 변경 버튼은 비활성화한다.
- 화면의 `게시 상태 확인`은 GET만 수행한다. 공개를 실행하는 기존 CHECK action은 자동 조회에 사용하지 않는다.
- 조회 API의 선택적 `submissionId` 필터는 인증된 회원 소유권 조건 안에서 적용한다. 최근 20건 밖으로 밀려도 대상 결과 조회가 가능하다.

## 제출 기반 실행

1. 두 이미지가 연결된 새 제출/수정본과 같은 트랜잭션에 `MODERATION_JOB_REQUESTED` 내부 outbox 이벤트를 저장한다. 텍스트 초안·단일 이미지 업로드에는 만들지 않는다.
2. 웹의 경량 `moderation-job-dispatcher`가 저장된 요청만 확인하고 기존 Cloud Run Job을 깨운다. OCR/AI는 웹 프로세스에서 실행하지 않는다. Cloud Scheduler나 Codex 자동실행 예약은 사용하지 않는다.
3. 한 번에 최대 2건을 묶고 DB lease로 배포 중복 실행을 막는다. Job 실행은 고정 리소스에 서비스 계정으로 요청하고 클라이언트가 job/환경변수/한도를 전달할 수 없다.
4. Job은 현재 claim된 요청, 허용 회원, 현재 revision/hash, 동의·활성 권한을 재확인한다. 과거 대기 질문이나 취소 질문을 일괄 재검사하지 않는다.
5. 로컬 OCR/QR → 기본 안전검사(이미지별 요청) → Luna 문맥 판단 → 기존 명시적 PILOT 공개 정책을 따른다. 기권·미지원/누락 근거·충돌·고위험 신호를 통과로 취급하지 않는다.
6. 공개는 두 이미지·최신 수정본을 재검증하고 기존 DB/R2 복구·감사·회원 알림 경로로 실행한다. 애매한 판단은 비공개 NEEDS_CHANGES와 이해할 수 있는 사유로 반환한다. 계정 제재나 자동 영구 삭제는 하지 않는다.
7. Job 완료 처리에서 outbox를 확인한다. HTTP 호출 성공만으로 게시 성공을 기록하지 않는다. 시작 결과 불명은 12분 lease(10분 Job 제한보다 길게) 만료 후 재시도한다. 최대 5회 시도 후 기술적 실패 사유를 남긴다.
8. 비용 한도 소진은 다음 UTC 날짜로 연기하며 게시 실패나 승인으로 바꾸지 않는다. Provider/Luna 원장은 초기화하지 않는다.

범용 outbox 전달기는 위 내부 이벤트를 외부로 전송하지 않는다. 기존 테이블을 사용하므로 신규 migration은 없다.
Job 실행 API는 [Google Cloud Run jobs.run](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run)을 사용한다.

## 활성화 설정 (코드 배포와 별개)

키와 기존 개인정보 승인 증빙은 `which-runtime-env`를 재사용한다. 새 키 발급이나 증빙 값을 임의로 승인하지 않는다.

웹 서비스:

```text
MODERATION_WORKER_ENABLED=false
MODERATION_JOB_DISPATCH_ENABLED=true
MODERATION_CLOUD_RUN_JOB=projects/which-505908/locations/asia-southeast1/jobs/which-moderation
ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS=<기존 승인된 테스트 회원 UUID>
FEATURE_ISSUE_MEDIA_ENABLED=true
ISSUE_MEDIA_EXPERIMENT_PERCENT=100
```

마지막 두 설정은 이미 승인·게시된 이미지의 표시를 활성화하며 업로드 권한을 모든 회원에게 부여하지 않는다.

기존 moderation Job (검증된 동일 release 이미지):

```text
MODERATION_WORKER_ENABLED=true
MODERATION_SUBMISSION_WAKEUPS_ONLY=true
MODERATION_WORKER_BATCH_SIZE=2
MODERATION_WORKER_LEASE_MS=180000
ISSUE_MEDIA_LOCAL_SCANNER_MODE=LOCAL
MODERATION_PROVIDER_MODE=SHADOW
MODERATION_PROVIDER_KILL_SWITCH=false
MODERATION_PROVIDER_CANARY_PERCENT=100
MODERATION_PROVIDER_DAILY_CALL_CAP=10
MODERATION_POLICY_JUDGE_MODE=SHADOW
MODERATION_POLICY_JUDGE_KILL_SWITCH=false
MODERATION_POLICY_JUDGE_CANARY_PERCENT=100
MODERATION_POLICY_JUDGE_DAILY_CALL_CAP=5
MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP=50000
ISSUE_MEMBER_MEDIA_UPLOAD_MODE=PILOT
FEATURE_ISSUE_MEDIA_ENABLED=true
ISSUE_MEDIA_AUTO_PUBLICATION_MODE=PILOT
ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH=false
ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS=<동일 UUID>
```

`SHADOW`는 제공자 결과 저장 모드다. 별도의 명시적 `AUTO_PUBLICATION_MODE=PILOT` 실행부가 모든 조건을 통과했을 때만 공개한다. 일반 결정 엔진·제재 자동화는 OFF를 유지한다. 캡은 기존 운영 승인값이며, 두 장 기본 검사에는 캐시 미적중 시 기본 요청 2회가 필요하다.

웹 런타임 계정에 해당 Job 하나의 `roles/run.invoker`만 부여한다. 공개 웹 방문자에게 Job 실행 권한을 주지 않는다. Job 설정 변경/환경변수 override 권한도 부여하지 않는다.

## 검증·중단

- 로컬: 모달 접수 완료, 전역 toast 중복 방지/오류/취소/세션 만료, 상태별 버튼, 소유권 조회, durable dispatch/lease/revision/동의/예산/공개 복구 테스트.
- 배포: PR 필수 CI → main Cloud Build → 웹 Ready/traffic 확인 → 같은 이미지로 Job 갱신 → 설정 활성화 → `diagnose-runtime` 확인.
- 실제 AI 판정·게시 E2E는 허용받은 신규 테스트 질문으로만 진행한다. 설정 진단 성공을 실제 질문 게시 성공으로 보고하지 않는다.
- 중단: 먼저 웹 `MODERATION_JOB_DISPATCH_ENABLED=false`, Job의 provider/judge/auto-publication kill switch를 true로 설정한다. 이미 실행 중인 Job에는 시작 시 환경변수가 유지되므로 필요하면 해당 execution을 명시적으로 취소한다.
- 재시작 시 대기 이벤트는 보존되어 다시 처리 가능하다. 데이터나 비용 원장을 삭제하여 재시도하지 않는다.

이는 기존 테스트 회원 대상 제한적 자동 공개이며 WHICH-111 전체 출시/정확도 검증을 완료했다고 의미하지 않는다.
