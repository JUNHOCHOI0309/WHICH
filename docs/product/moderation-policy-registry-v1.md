# WHICH Moderation Policy Registry v1

- Status: Active policy contract
- Policy ID: `which-moderation`
- Policy version: `1.0.0`
- Implementation: [`policy-registry.ts`](../../apps/api/src/modules/moderation/policy-registry.ts)
- Parent roadmap: [`ai-moderator-implementation-roadmap.md`](./ai-moderator-implementation-roadmap.md)

## Decision

WHICH의 Issue, 댓글·답글, Profile, Issue 이미지와 Vote integrity는 각자의 상태 원장을 유지한다.
Moderation Policy Registry는 그 상태를 대체하는 새 원장이 아니라, 판정 사유와 조치 권한을 같은
언어로 해석하기 위한 Versioned 계약이다.

모델 출력은 Signal이며 정책 판정이 아니다. 낮은 Confidence, 문맥 부족, 모델 불일치와 지원하지
않는 Slice는 안전으로 간주하지 않고 `REVIEW`로 보낸다. 신고 개수도 Severity나 영구 조치의
근거가 될 수 없다.

## Independent policy axes

| Axis                 | 범위                                                        | 자동 결정 경계                                        |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `TECHNICAL_SECURITY` | signature, decode, 형식, malware, verified known-block hash | 아래 세 결정론적 실패만 비공개 자동 반려              |
| `CONTENT_SAFETY`     | 괴롭힘, 혐오, 위협, 성적 착취, 폭력, 자해                   | 검토 라우팅과 출시 Gate를 통과한 가역 조치만 가능     |
| `PRIVACY`            | PII, 신분증, 얼굴, 위치, 미성년 가능성                      | 탐지는 보조 Signal이며 불확실한 신원 판단은 사람 전용 |
| `RIGHTS`             | 출처, 라이선스, 초상, 저작권·명예훼손 요청                  | AI가 `CLEARED`를 만들 수 없음                         |
| `RELEVANCE`          | 질문·이미지 적합성, Spam, 오해를 부르는 문맥                | Nudge, 검토 또는 노출 축소 후보                       |
| `VISUAL_FAIRNESS`    | A/B crop, 정보량, 현저성, 화질과 존재 대칭                  | 안전 위반과 분리하며 검토 보조만 수행                 |

## Canonical reasons and compatibility

현재 댓글 Report API는 즉시 마이그레이션하지 않고 다음 파생 Mapping을 사용한다.

| Current API reason     | Canonical reason       |
| ---------------------- | ---------------------- |
| `SPAM`                 | `SPAM`                 |
| `HARASSMENT`           | `INSULT_OR_HARASSMENT` |
| `HATE_OR_ABUSE`        | `HATE`                 |
| `PERSONAL_INFORMATION` | `PRIVACY`              |
| `OTHER`                | `OTHER`                |

댓글의 `싫어요`는 선호 반응이며 Reason, 신고 또는 Policy Event가 아니다. `OTHER`는 자동 위반
확정에 사용하지 않고 상세 문맥과 함께 검토한다.

이미지 전용 Reason은 축을 Prefix로 드러낸다. 예를 들어 `TECHNICAL_DECODE_FAILED`,
`PRIVACY_PII_DETECTED`, `RIGHTS_CHALLENGED`, `RELEVANCE_MISLEADING_CONTEXT`,
`VISUAL_CHOICE_BIAS`를 사용한다. 코드의 Registry가 Canonical 전체 목록과 기본 Severity,
지원 Target, 문맥 필요 여부를 고정한다.

## Severity

| Severity        | 의미                     | 기본 처리                                             |
| --------------- | ------------------------ | ----------------------------------------------------- |
| `S0_CLEAR`      | 정책 위반 아님           | 유지; 악성·중복 신고 Signal은 별도 분석               |
| `S1_DISRUPTIVE` | 경미한 질서·품질 훼손    | Nudge, Deprioritize, Collapse 후보                    |
| `S2_HARMFUL`    | 명확한 정책 위반         | Hide/Remove 검토와 반복 위반 연결                     |
| `S3_SEVERE`     | 높은 피해 가능성         | 즉시 가역 격리와 P0/P1 검토                           |
| `S4_CRITICAL`   | 긴급·불법·회복 곤란 피해 | 즉시 격리, 증거 보존, Operator·Legal·Safety 최종 판단 |

Severity는 신고 수나 의견의 강도가 아니라 피해, 표적성, 반복성, 도달 범위와 긴급성으로 정한다.
Confidence와 Context sufficiency는 별도 필드이며 Severity를 낮추는 용도로 사용하지 않는다.

## Canonical action matrix

| Action           | Rule                                 | Model                                | Operator | 원칙                                  |
| ---------------- | ------------------------------------ | ------------------------------------ | -------- | ------------------------------------- |
| `PRIVATE_REJECT` | 아래 결정론적 Reason만 가능          | 권고만                               | 가능     | 공개 전 반려, 복구 가능               |
| `REVIEW`         | 가능                                 | 가능                                 | 가능     | 불확실하면 항상 이 상태로 Fallback    |
| `PROVISIONAL`    | 불가                                 | Release Gate 후 가역 범위만          | 가능     | Rights `CLEARED`를 의미하지 않음      |
| `PUBLISHED`      | 직접 결정 불가                       | 권고만                               | 가능     | 실제 게시기는 별도 도메인 계약을 실행 |
| `QUARANTINED`    | Automated Containment Gate 후만 가능 | Automated Containment Gate 후만 가능 | 가능     | TTL·Kill Switch·완전 복구 필수        |
| `PURGED`         | 불가                                 | 불가                                 | 가능     | 영구 파일 삭제, 사람 판단 필수        |

Rule이 자동 `PRIVATE_REJECT`를 확정할 수 있는 Reason은 정확히 세 가지다.

1. `TECHNICAL_DECODE_FAILED`
2. `TECHNICAL_PROHIBITED_FORMAT`
3. `TECHNICAL_KNOWN_BLOCK_EXACT_HASH`

단순 perceptual-hash 유사도, malware 의심, OCR 일부 결과, 모델 단독 판단은 결정론적 반려가
아니므로 `REVIEW`로 보낸다.

## Human-only decisions

다음 결정은 점수, Rule 또는 Model 결과만으로 확정할 수 없다.

- 정책 위반 콘텐츠의 영구 삭제
- 24시간을 초과하는 기능 제한, 계정 제한과 계정 종료
- Appeal 판정과 파생 상태의 완전 복구
- 개인정보·명예훼손·저작권 등 Rights 판정
- 유효 Vote 무효화와 결과 정정
- 신원·실존 인물·미성년 여부의 최종 판단

## Existing ledger mapping

Mapping은 조회·Case 생성 시 파생하며 기존 행을 복제하거나 덮어쓰지 않는다.

### Comment

| Existing state/action                                          | Canonical action |
| -------------------------------------------------------------- | ---------------- |
| `PENDING_AUTOMOD`, `PENDING_HUMAN_REVIEW`, integrity `REVIEW`  | `REVIEW`         |
| `PUBLISHED`이며 숨김·정책 삭제가 아님                          | `PUBLISHED`      |
| visibility `HIDDEN`, `REMOVED_POLICY`, integrity rejected 계열 | `QUARANTINED`    |
| Operator `COLLAPSE`                                            | `REVIEW`         |
| Operator `HIDE`, `REMOVE_POLICY`                               | `QUARANTINED`    |
| Operator `RESTORE`                                             | `PUBLISHED`      |
| `REMOVED_BY_AUTHOR`                                            | Moderation 외부  |

`REMOVED_POLICY`는 DB와 증거를 보존하므로 `PURGED`가 아니다. 댓글 `FAILED`는 정책 위반이 아닌
운영 실패일 수 있으므로 자동 반려하지 않고 `REVIEW`로 보낸다.

### Issue media

| Existing decision/state      | Canonical action |
| ---------------------------- | ---------------- |
| `PENDING` 또는 `STAGED`      | `REVIEW`         |
| `APPROVED` + `PUBLISHED`     | `PUBLISHED`      |
| `REJECTED` + 비공개 저장     | `PRIVATE_REJECT` |
| `REVOKED` 또는 `QUARANTINED` | `QUARANTINED`    |
| Review `RESTORED`            | `PUBLISHED`      |
| storage `PURGED`             | `PURGED`         |

Rights state `ASSERTED | CHALLENGED | CLEARED | WITHDRAWN`은 이 Mapping과 독립이다. Safety 통과나
게시 승인만으로 `ASSERTED`를 `CLEARED`로 바꾸지 않는다.

## Korean boundary cases

| 사례                                                         | 처리                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| 강한 반대 의견·비꼼이 있으나 표적 반복 공격은 아님           | 즉시 괴롭힘 확정 금지; `S0` 또는 `S1`, 문맥 검토            |
| 보호 대상 비판인지 혐오·비인간화인지 문장만으로 불명확       | `HATE` 후보 + `INSUFFICIENT` context, `REVIEW`              |
| 공개 기사에 있던 이름·사진을 다른 위치 정보와 결합           | 공개 정보라는 이유로 허용하지 않고 `PRIVACY` 검토           |
| 그림·애니메이션 인물의 나이 표현이 불명확                    | `PRIVACY_IDENTITY_OR_MINOR_UNCERTAIN`, 사람 최종 판단       |
| 안전 모델은 통과했지만 업로더의 사용 권한 증거가 없음        | `RIGHTS_ASSERTION_MISSING`; 게시 승인이나 Rights clear 금지 |
| A만 고화질 인물 사진이고 B는 작은 로고·저화질 이미지         | 안전 위반과 분리해 `VISUAL_MEDIA_ASYMMETRY` 검토            |
| 같은 문구 신고가 짧은 시간에 집중되지만 원문은 명백하지 않음 | Severity를 신고량으로 올리지 않고 Report Cluster 검토       |
| 한국어 은어가 폭력 위협인지 친근한 과장인지 불명확           | Target·대화 흐름이 없으면 `INSUFFICIENT`, `REVIEW`          |

## Versioning, notice and rollback

- 모든 결정은 `policy_id`, `policy_version`, `reason_code`, `source`, `content_version_id`와
  입력 Hash를 저장한다.
- 사용자 안내 Key는 `moderation.v1.<action>.<reason>` 형식을 사용한다. 번역 문구가 바뀌어도
  Key 의미를 재사용하지 않는다.
- 자동화 기본 모드는 `OFF`이고 `SHADOW -> REVIEW_ASSIST -> LIMITED_ACTION` 순서만 허용한다.
- 제한 자동화 전 최소 30일 Shadow와 A/B Side, 신규 사용자, Reply, Issue media Slice를 검증한다.
- Canary에는 Policy Version pinning, Kill Switch, TTL과 복원 Runbook이 필요하다.
- Rollback은 자동 판정을 중지하고 새 항목을 `REVIEW`로 보내며 기존 Audit·Evidence를 삭제하지 않는다.
- 정책 의미가 바뀌면 Patch가 아니라 Minor/Major Version을 올리고 새 Notice Key와 Golden Set을 검토한다.

## Follow-up boundaries

이 Registry는 데이터베이스 원장이나 실제 AI Worker를 만들지 않는다. 다음 작업에서 순서대로
연결한다.

- `WHICH-92`: Report cluster와 신고 조작 방어
- `WHICH-93`: immutable content version
- `WHICH-94`: Moderation Case·Policy Event·Action 원장
- `WHICH-98`: 결정론적 Rule과 Rate Limit
- `WHICH-100`: 한국어 Golden Set
- `WHICH-103`: Action Matrix를 실행하는 Decision Engine
- `WHICH-108`: 이미지 OCR/QR·Safety Shadow Gate
