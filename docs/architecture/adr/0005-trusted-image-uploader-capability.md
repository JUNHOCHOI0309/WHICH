# ADR-0005: 신뢰 사용자 이미지 업로드 Capability Pilot

- Status: Accepted for Pilot planning; Production disabled
- Date: 2026-08-27
- Task: `WHICH-89`
- Supersedes: none
- Extends: [`ADR-0003`](./0003-issue-format-and-media-policy.md)
- Operations: [`Trusted image uploader Pilot runbook`](../../operations/trusted-image-uploader-pilot.md)
- Automation boundary: [`Image Moderation Operating Strategy v2`](../../operations/image-moderation-operating-strategy-v2.md)

## Context

WHICH-84~87은 운영자가 이미지를 등록하고 검수·게시·블라인드·권리 요청을 처리하는 기반을
구축했다. 그러나 이 기반이 안정적이라는 이유만으로 일반 Member에게 업로드를 허용하면 개인정보,
유해 이미지, QR, 저작권과 검수량을 한 명의 운영자가 감당해야 한다.

Member의 `ACTIVE` 상태는 로그인과 일반 제품 사용 가능 여부일 뿐 이미지 게시 신뢰도를 뜻하지
않는다. 이미지 권한을 Member status에 섞으면 계정 제한과 이미지 제재가 결합되고, Guest나 모든
Member에게 의도치 않게 권한이 퍼질 위험이 있다.

## Decision

### 1. 별도 Capability

이미지 업로드 권한은 범용 capability `ISSUE_IMAGE_UPLOAD`로 관리한다. Member status나
`VERIFIED_MEMBER` subject kind로 추론하지 않는다.

권장 additive schema는 다음과 같다. WHICH-89에서는 설계와 판정 코드만 확정하며 Production
migration이나 공개 Route를 만들지 않는다.

```text
member_capability_grants
  grant_id
  member_id
  capability_code          ISSUE_IMAGE_UPLOAD
  state                    ACTIVE | SUSPENDED | REVOKED | EXPIRED
  policy_version
  granted_by_member_id
  reason
  granted_at
  expires_at

member_capability_events
  event_id
  grant_id
  action                   GRANTED | SUSPENDED | REVOKED | EXPIRED | APPEALED | RESTORED
  reason_code
  rationale
  actor_member_id
  request_id
  created_at
```

- 권한 부여는 운영자의 명시적 선정으로만 수행한다. 조건 충족만으로 자동 부여하지 않는다.
- 최초 grant는 30일이며 만료 전 재평가한다.
- 일반 Member와 Guest의 업로드는 계속 비활성화한다.
- 초기 Pilot의 하루 3개·검수 자산 10개 제한은 2026-09-01 사용자 결정으로 폐기했다.
  작성량이 아닌 권한·동의·안전 검사와 일회성 업로드 세션으로 통제한다. AI 호출 예산은 별도 유지한다.
- 업로드 대상은 본인이 만든 미게시·미잠금 `LOW` risk `VS` Issue로 한정한다.

### 2. 부여·회수 기준

권한 후보는 다음 조건을 모두 충족해야 한다.

- Member status가 `ACTIVE`
- 이메일 인증 완료
- 계정 생성 후 30일 이상
- 유효 투표 20개 이상
- 게시된 LOW-risk 텍스트 Issue 3개 이상
- 최근 90일 확정 위반 0건
- 현재 계정·정책 제한 없음
- 최신 이미지 권리·개인정보 약관 동의

실행 가능한 기준 구현은
`apps/api/src/modules/issue-media/trusted-uploader-policy.ts`의
`evaluateTrustedUploaderEligibility`에 둔다. 이것은 후보 판정이며 grant 자체를 생성하지 않는다.

중대한 개인정보·성적 착취·불법 콘텐츠·반복 권리침해는 즉시 권한 정지 후 운영자 확인 대상으로
보낸다. 일반 위반도 90일 내 2회 확정 시 30일 정지, 180일 내 3회 확정 시 무기한 회수 후보로
삼는다. 자동 시스템은 자산을 영구 삭제하거나 계정을 영구 제재하지 않는다.

### 3. 업로드 검사 Pipeline

모든 사용자 이미지는 공개 전 비공개 staging에서 다음 순서로 처리한다.

1. 요청자 Member, active capability, 대상 Issue 소유권·상태·risk 확인
2. 선언 MIME과 파일 signature 일치, 10 MiB, 4천만 pixel, decode bomb 검사
3. 방향 보정, EXIF/GPS 제거, 최대 1600px WebP 정규화
4. SHA-256 exact duplicate와 dHash 유사 이미지 비교
5. malware/signature, QR·barcode 탐지
6. OCR 후 전화번호·이메일·주소·계좌·신분증형 개인정보 탐지
7. 성적·폭력·혐오·미성년자 위험 등 이미지 안전 분류
8. 정책 결과와 모든 모델·rule version을 저장하고 사람 검수 Queue로 전달

판정은 다음 세 단계다.

- `AUTO_REJECT`: decode 실패, 허용되지 않은 형식, known-block hash처럼 결정적인 기술 실패.
  자산은 소명 기간 동안 비공개 보존하며 즉시 영구 삭제하지 않는다.
- `REVIEW_REQUIRED`: 개인정보·QR·유해성·유사 이미지 신호가 있거나 자동 판정이 불확실한 경우.
- `REVIEW_READY`: 기술·자동 검사에서 문제가 없지만 Pilot 동안에는 자동 승인하지 않고 사람이
  최종 확인한다.

사람 검수만 `APPROVED`를 만들 수 있다. 승인된 정규화 WebP만 published bucket으로 이동한다.

### 4. 신고·통지·소명·복원

공개 자산에는 자산 ID를 기준으로 신고를 받는다. 신고 사유는 `PRIVACY`, `DEFAMATION`,
`COPYRIGHT`, `SEXUAL_OR_VIOLENT`, `MISLEADING_OR_SPAM`, `OTHER`다.

- 개인정보·명예훼손·저작권 요청은 기존 Rights Desk처럼 즉시 quarantine한다.
- 중대한 안전 신고 또는 누적 위험 threshold도 즉시 hide하되 영구 삭제하지 않는다.
- 작성자에게 자산, 조치, reason code, 소명 기한을 알리고 신고자 정보는 노출하지 않는다.
- 작성자는 14일 안에 한 번 소명할 수 있다.
- 소명 기각은 hide를 유지하고, 인용은 별도 `RESTORED` 결정으로만 공개를 복원한다.
- 신고 기각이 자동 복원을 뜻하지 않는 기존 Ops 원칙을 유지한다.
- 결정, 신고, 통지, 소명, 복원은 append-only audit event로 보존한다.

삭제는 소명 기간이 끝났고 열린 권리 사건·법적 보존 의무가 없을 때 운영자 또는 보존 job이
실행한다. 삭제 후에도 hash와 판정 이력은 중복 방지와 감사 목적으로 보존한다.

### 5. Pilot Gate

최소 14일, 10명, 30개 제출 전에는 확장 결정을 내리지 않는다. 충분한 표본 이후 다음 기준을 쓴다.

| 지표                           | GO 기준     | 판정             |
| ------------------------------ | ----------- | ---------------- |
| 심각한 안전·개인정보 공개 누락 | 0건         | 1건 이상 `NO_GO` |
| 검수 완료 p95                  | 24시간 이하 | 초과 `NO_GO`     |
| 가장 오래된 대기 자산          | 48시간 이하 | 초과 `NO_GO`     |
| 권리 요청 / 게시 자산          | 1% 이하     | 초과 `NO_GO`     |
| 주간 운영 시간                 | 4시간 이하  | 초과 `NO_GO`     |
| 반려 / 검수 완료               | 30% 이하    | 초과 `HOLD`      |
| 신고된 게시 자산 / 게시 자산   | 2% 이하     | 초과 `HOLD`      |
| 소명 인용 / 해결된 소명        | 10% 이하    | 초과 `HOLD`      |
| 자산당 검수 시간 중앙값        | 5분 이하    | 초과 `HOLD`      |

실행 가능한 판정은 `evaluateTrustedImagePilot`에 둔다. `GO`도 일반 Member 공개를 의미하지 않고
다음 제한 cohort 또는 후속 Task로 이동할 수 있다는 뜻이다.

이 표본은 운영 Smoke Gate다. `30개에서 심각한 누락 0건`은 자동 공개의 안전성을 입증하지
않으므로 Fast Lane 또는 임시 자동 공개는 별도 Shadow 표본·Action별 통계·Random Audit와
Category Kill Switch를 요구한다.

### 6. Feature flag와 Rollback

후속 구현의 server control은 `ISSUE_MEMBER_MEDIA_UPLOAD_MODE=OFF|PILOT`를 사용한다. 업로드는
기존 `FEATURE_ISSUE_MEDIA_ENABLED`, `PILOT` mode, active capability, ownership gate를 모두
통과해야 한다. 기본값은 `OFF`다.

Rollback은 mode를 `OFF`로 바꾸고 active grant를 일괄 `SUSPENDED`로 전환한다. staging과
quarantine의 자산·검수 이력은 삭제하지 않는다. 이미 승인되어 게시 중인 자산은 안전 사건이 없는
한 유지하거나 기존 미디어 flag로 text fallback한다.

## Consequences

- 계정 상태와 이미지 권한을 독립적으로 운영하고 제한된 사용자만 Pilot에 참여한다.
- 자동 검사는 Queue 우선순위를 돕지만 공개 승인·영구 삭제·영구 제재를 결정하지 않는다.
- 권리 요청과 신고, 소명, 복원이 동일한 자산 이력으로 연결된다.
- OCR·QR·유해성 검사 공급자와 실제 비용은 후속 Vertical Slice에서 선정해야 한다.
- Production schema, Member upload API, Web·Mobile 작성 UI는 후속 Task 전까지 존재하지 않는다.

## Rejected alternatives

- `ACTIVE` Member 전체에 즉시 공개: 검수·권리 비용과 사고 반경을 제한할 수 없다.
- Member status에 `TRUSTED` 추가: 계정 수명주기와 이미지 권한을 결합한다.
- 자동 검사 통과 즉시 게시: 작은 Pilot에서도 오탐·미탐의 안전 장치가 없다.
- 신고 누적 시 즉시 영구 삭제: 소명과 권리 분쟁 증거를 잃고 복구할 수 없다.
