# Trusted image uploader Pilot runbook

WHICH-89는 신뢰 사용자 이미지 업로드 Pilot의 운영 계약을 정의한다. 이 문서는 운영자가 실제
Pilot을 시작하기 전 확인할 체크리스트이며, 현재 Production Member/Guest 업로드를 활성화하지
않는다.

## 선행 조건

- 운영자 이미지 등록·승인·반려·블라인드·삭제·복원 QA가 통과했다.
- staging과 published R2 bucket이 분리되어 있다.
- 이미지별 결정 이력과 개인정보·명예훼손·저작권 요청이 `/ops`에서 조회된다.
- 검수 Queue의 oldest age, p95 처리 시간, 자산당 처리 시간과 주간 운영 시간을 측정할 수 있다.
- Member capability grant/event migration과 operator grant 도구가 준비되어 있다.
- 사용자 업로드 mode 기본값과 배포 환경값이 `OFF`다.

하나라도 충족하지 못하면 Pilot을 시작하지 않는다.

## Cohort 등록

1. 후보 Member에 대해 `evaluateTrustedUploaderEligibility`와 원장 수치를 확인한다.
2. 운영자가 콘텐츠 이력과 권리 동의 버전을 최종 검토한다.
3. `ISSUE_IMAGE_UPLOAD` grant를 30일 만료로 생성한다.
4. grant action과 운영자, reason, policy version, request ID를 audit event에 남긴다.
5. 한 번에 10명부터 시작하며 cohort를 늘릴 때도 Pilot Gate를 다시 평가한다.

조건 충족은 자동 grant 사유가 아니다. `LIMITED`, `SUSPENDED`, `DELETED` Member와 Guest는 항상
거절한다.

## 제출과 자동 검사

- 하루 3개, open asset 10개를 서버에서 강제한다.
- 본인의 미게시·미잠금 LOW-risk VS Issue 외에는 거절한다.
- 외부 URL, GIF, SVG, 영상은 받지 않는다.
- 기술 실패는 비공개 `AUTO_REJECT`; 불확실한 안전 신호는 `REVIEW_REQUIRED`; clean은
  `REVIEW_READY`로 기록한다.
- rule/model version, OCR·QR·유해성 finding, hashes와 처리 시간을 저장한다.
- 자동 판정만으로 공개 승인하거나 binary를 영구 삭제하지 않는다.

## 사람 검수

운영자는 권리 근거, 질문과 이미지의 관련성, 선택지 간 시각적 대칭, alt text, 개인정보·QR,
유해성과 중복을 확인한다. 모든 승인·반려에는 reason code, 10자 이상 근거, policy version과
request ID를 남긴다.

- 승인: normalized WebP를 published bucket으로 이동하고 Issue 연결 가능 상태로 만든다.
- 반려: staging에서 비공개 유지하고 작성자에게 사유와 소명 기한을 알린다.
- 블라인드: published object를 quarantine하고 공개 URL을 제거한다.
- 삭제: 소명 기간과 권리 보존 조건을 확인한 뒤 object를 purge한다.

## 신고와 소명

1. 자산별 신고를 접수하고 중복 신고는 한 사건에 묶되 신고자 수는 보존한다.
2. 개인정보·명예훼손·저작권 또는 심각한 안전 신고는 즉시 quarantine한다.
3. 작성자에게 조치·reason code·14일 소명 기한을 통지한다.
4. 소명은 원 결정과 분리된 event로 접수한다.
5. 운영자는 `UPHELD` 또는 `OVERTURNED`를 기록한다.
6. `OVERTURNED`도 자동 공개하지 않고 별도 restore 판단을 실행한다.
7. 확정 위반을 capability event에 반영한다.

반복 위반 기본 조치:

- 첫 확정 위반: 경고와 재동의
- 90일 내 두 번째: 30일 capability 정지
- 180일 내 세 번째: 무기한 회수 검토
- 중대한 개인정보·성적 착취·불법 콘텐츠: 횟수와 관계없이 즉시 정지 및 운영자 심사

계정 자체 제한·탈퇴는 기존 Member 정책에서 별도로 결정한다.

## 일일 운영 점검

- PENDING/REVIEW_REQUIRED 수와 가장 오래된 대기 시간
- 지난 24시간 제출·검수·승인·반려·블라인드 수
- 이미지 load failure와 공개 object 상태
- 신고, 권리 요청, 열린 소명
- 정지·만료 예정 grant
- 실제 검수 분과 운영 시간

oldest pending 48시간 또는 review p95 24시간을 넘으면 신규 제출을 멈추고 원인을 기록한다.

## 주간 Go/No-Go

`evaluateTrustedImagePilot`에 집계값을 입력하고 결과와 원시 수치를 함께 보관한다.

- `INSUFFICIENT_EVIDENCE`: 계속 제한 관찰하며 cohort를 넓히지 않는다.
- `GO`: 같은 안전 경계에서 제한 cohort 확대를 별도 승인할 수 있다.
- `HOLD`: 신규 grant·cohort 확대를 멈추고 품질·검수 효율을 개선한다.
- `NO_GO`: mode를 `OFF`로 전환하고 active grant를 정지한다.

심각한 안전·개인정보 공개 누락은 표본이나 비율과 관계없이 즉시 `NO_GO`다.

## Rollback

1. `ISSUE_MEMBER_MEDIA_UPLOAD_MODE=OFF` 배포
2. active `ISSUE_IMAGE_UPLOAD` grant 일괄 정지 event 기록
3. 진행 중 업로드를 더 이상 연결·게시하지 않고 Queue를 보존
4. 안전 문제가 있는 공개 자산만 quarantine
5. staging/quarantine object, hashes, decisions, reports, appeals를 보존
6. incident와 비용을 정리한 뒤 재개 여부를 새 승인으로 결정

Rollback 중에도 text-only Issue, Vote, 댓글과 기존 운영자 이미지 기능은 유지한다.
