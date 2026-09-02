# WHICH-105·111 Member 자동 공개 감사

작성일: 2026-09-02  
상태: 운영 자동 공개 활성, 정식 Go/No-Go 근거는 `COLLECTING`

## 현재 운영 기준

- 웹 기준 배포: `91c489ad7dd89426e6dff2dc9255112da50733be`, Cloud Run
  `which-web-00031-9j7`, 트래픽 100%.
- Moderation Job 기준 기능 이미지: `8efc30ad6cc7c4d460f378651ac6867bd709e0a9`.
- 웹과 Job 모두 `ISSUE_MEMBER_MEDIA_UPLOAD_MODE=MEMBER`,
  `ISSUE_MEDIA_AUTO_PUBLICATION_MODE=MEMBER`, 자동 공개 kill switch OFF.
- `GET /api/health`, `/create` HTTP 200과 새 리비전 ERROR 로그 부재를 확인했다.
- 이 기준은 Member 자동 공개 활성화 증빙이다. WHICH-111의 14일·표본 수·품질 기준을 충족했다는
  의미는 아니다.

## 공개 후 감사 선택

자동 공개 트랜잭션이 성공할 때 `which-111-post-publication-audit-v1` 정책을 적용한다.

1. 첫 500개 자동 공개 이미지마다 SHA-256 기반 고정 bucket으로 20%를 무작위 선택한다.
2. 가입 30일 이내 Member의 자동 공개 이미지는 표적 감사로 모두 선택한다.
3. 선택된 각 이미지의 `ISSUE_MEDIA_ASSET` Moderation Target에 Ops Case를 열고
   `RANDOM_AUDIT` reference로 연결한다.
4. 신규 Member 표적 감사는 P2·24시간, 일반 무작위 감사는 P3·72시간 SLA를 사용한다.
5. `AI_MEMBER_MEDIA_POST_PUBLICATION_AUDIT_SELECTED` 감사 이벤트에 Case, submission, 공개 Issue,
   source Run, Luna evaluation, 선택 이미지와 선택 사유를 연결한다.

감사 Case 생성은 게시 후 관찰을 위한 것이며 게시를 되돌리거나 사용자에게 실패로 표시하지 않는다.
Case 생성까지 같은 DB 트랜잭션에 포함되므로 감사 기록 없이 공개 DB commit만 남기지 않는다. R2
준비 후 DB rollback이 발생하면 기존 reconciliation이 공개 객체를 정리한다.

## 읽기 전용 집계

Cloud Run Job과 동일한 런타임에서 다음 명령을 사용한다.

```sh
node apps/api/dist/moderation-worker.js diagnose-runtime
node apps/api/dist/moderation-worker.js auto-publication-audit-summary
```

두 번째 명령은 원문·이미지·OCR·Member 식별자를 출력하지 않고 다음만 집계한다.

- 자동 공개 submission/asset 수와 최초·최근 시각
- 감사 선택 Case/asset 수
- 20%/500개/신규 Member 30일 정책 버전
- `formalGateDecision=COLLECTING`

이 명령은 자동으로 GO를 선언하지 않는다.

## WHICH-111 진행 판정

현재는 `Doing / COLLECTING`이다. 아래 조건을 실제 운영 데이터로 채운 뒤 별도 결정을 기록한다.

- Gate A: 최소 14일·10명·30개, R2 lifecycle·notice·appeal·quarantine·restore와 운영시간.
- Gate B: Golden Set과 운영 Shadow를 분리한 action/slice 품질, abstain, override, 비용, 지연.
- Gate C: 대표 표본 300개 zero-critical-miss 참고선, 첫 500개 20% 감사와 표적 감사 결과.
- 한 건의 신뢰할 수 있는 critical public miss가 있으면 영향 범주의 자동 공개를 즉시 중지한다.
- Rights·Appeal·영구 조치는 계속 사람 판단으로 유지한다.

## 중지와 롤백

1. 즉시 중지: Moderation Job의 `ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH=true`로 변경한다.
2. 필요 시 `ISSUE_MEDIA_AUTO_PUBLICATION_MODE=OFF`로 변경한다. 업로드 접수 자체를 함께 막을 필요는
   없으며 비공개 제출과 수정 경로는 유지할 수 있다.
3. 진행 중 작업은 현재 revision/hash·계정·동의·권리·R2 상태를 다시 확인하므로 과거 ALLOW만으로
   게시하지 않는다.
4. 감사 Case와 이벤트, 검사 Run, Luna 비용 원장, reconciliation 이력은 삭제하지 않는다.
5. 복구 전 영향 범주, 공개 Issue, 신고·Appeal, R2 public/private 객체를 대조하고 새 정책 버전으로
   재개한다.
