# WHICH Moderation Run·Case·Action 운영 모델

WHICH-94는 기존 도메인 판정 원장을 교체하지 않는다. 댓글의 최종 판정은
`comment_moderation_decisions`, Issue 이미지는 `issue_media_review_decisions`가 계속 원본이다.
새 테이블은 하나의 불변 콘텐츠 버전에 대해 자동 검사, 운영 검토, 실제 도메인 조치를
연결하고 재현하는 용도다.

## 데이터 흐름

```text
Immutable content revision
        ↓
moderation_targets ── moderation_runs (동일 실행·비용 중복 차단)
        ↓
moderation_cases ─── moderation_case_references (신고·권리·이의·정합성)
        ↓
canonical domain decision ── moderation_actions (ID만 참조)
        ↓
moderation_audit_events
```

### Target

- `COMMENT_VERSION`, `ISSUE_VERSION`, `ISSUE_MEDIA_ASSET`, `PROFILE_VERSION`을 지원한다.
- `targetType + targetId + targetVersion`은 하나만 등록할 수 있다.
- 같은 버전에 다른 `inputHash`나 증거 위치가 들어오면 덮어쓰지 않고 충돌로 중단한다.
- 원문이나 판정 상태를 복사하지 않고 불변 스냅샷 위치만 보관한다.

### Run

- 정책·모델·규칙 버전, 실행 단계, 정규화 입력 해시, 지연 시간, 비용, 오류와 판정 출처를 기록한다.
- `Target + Policy + Stage + NormalizedInputHash`가 같으면 기존 실행을 반환한다.
- 비용은 통화 부동소수점 대신 `cost_micros` 정수로 기록한다.
- 정책 변경 재검수는 기존 `moderation_recheck_requests`를 `recheck_request_id`로 연결할 수 있다.

### Case

- 위험 레인, 우선순위, SLA, 담당자와 상태를 운영 큐 단위로 보관한다.
- 수정은 `expected_revision` 낙관적 잠금을 통과해야 한다. 충돌 시 다시 조회한 뒤 판단한다.
- 신고, 댓글 신고, 권리 요청, Appeal, 정합성 점검은 `moderation_case_references`로 연결한다.

### Action

- 실제 조치는 반드시 기존 댓글 또는 Issue 이미지 판정 ID를 참조해야 생성된다.
- 조치 전후 상태, 기간·만료, 되돌림 대상, 사용자 안내 키를 보관한다.
- 도메인 판정 payload나 판정 이력을 새 테이블에 복제하지 않는다.

## R2·DB 정합성 복구

1. 불변 Target과 기대 object reference를 확정한다.
2. 실제 DB/R2/CDN reference를 읽고 `moderation_reconciliations`에 기록한다.
3. 불일치면 운영 Case에 `RECONCILIATION` reference를 연결한다.
4. 수리 작업 reference를 남기고 상태를 `REPAIRED` 또는 `FAILED`로 기록한다.
5. 같은 트랜잭션에서 `moderation_audit_events`가 생성됐는지 확인한다.

삭제·재업로드로 원본 판정 원장을 고치지 않는다. 복구 결과는 새 정합성 기록과 감사 이벤트로
추가하고, 보존·권리·Appeal 지시는 `content_retention_directives`의 우선순위를 따른다.

## 운영 점검 SQL

중복 실행 및 중복 비용이 없는지 확인한다.

```sql
SELECT moderation_target_id, policy_version, stage, normalized_input_hash, COUNT(*)
FROM moderation_runs
GROUP BY moderation_target_id, policy_version, stage, normalized_input_hash
HAVING COUNT(*) > 1;
```

SLA를 넘긴 열린 Case를 확인한다.

```sql
SELECT moderation_case_id, risk_lane, priority, sla_due_at, assigned_to_member_id
FROM moderation_cases
WHERE status IN ('OPEN', 'TRIAGED', 'IN_REVIEW')
  AND sla_due_at < now()
ORDER BY priority, sla_due_at;
```

정합성 수리 기록과 감사 이벤트가 함께 존재하는지 확인한다.

```sql
SELECT r.moderation_reconciliation_id, r.status, r.repair_reference, a.moderation_audit_event_id
FROM moderation_reconciliations r
LEFT JOIN moderation_audit_events a
  ON a.entity_type = 'RECONCILIATION'
 AND a.entity_id = r.moderation_reconciliation_id
WHERE r.status IN ('REPAIRED', 'FAILED');
```

## 배포 및 롤백

- `0042_left_cerise.sql`은 신규 테이블만 추가하는 additive migration이다.
- 기존 댓글·이미지 처리 경로는 새 모델을 읽지 않으므로 단계적 연동이 가능하다.
- 배포 직후에는 테이블과 제약 생성 여부만 확인하고 자동 판정을 활성화하지 않는다.
- 문제가 생기면 새 기록 생성을 중단한다. 기존 원장과 사용자 기능은 계속 동작한다.
- 생성된 운영 기록은 감사 자료이므로 운영 중 임의 삭제하지 않는다.
