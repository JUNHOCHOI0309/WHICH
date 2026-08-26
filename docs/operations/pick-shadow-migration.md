# PICK shadow migration runbook

- Status: Design-only runbook; do not execute during `WHICH-88`
- Date: 2026-08-27
- Architecture: [`ADR-0004`](../architecture/adr/0004-pick-multichoice-migration.md)

## 목적

이 Runbook은 후속 PICK Vertical Slice에서 A/B 원장과 generic per-choice 집계가 일치하는지 검증하고
안전하게 rollback하기 위한 순서를 정의한다. 현재 Production schema에는 아직 generic table과
`PICK` format이 없으므로 아래 post-migration query를 지금 실행하지 않는다.

## 1. Preflight — 현재 VS 정합성

### Choice 수와 code

```sql
SELECT
  iv.issue_id,
  iv.version,
  COUNT(ic.choice_id) AS choice_count,
  ARRAY_AGG(ic.choice_code ORDER BY ic.choice_code) AS choice_codes
FROM issue_versions iv
LEFT JOIN issue_choices ic
  ON ic.issue_id = iv.issue_id
 AND ic.issue_version = iv.version
GROUP BY iv.issue_id, iv.version
HAVING COUNT(ic.choice_id) <> 2
    OR ARRAY_AGG(ic.choice_code ORDER BY ic.choice_code) <> ARRAY['A', 'B']::choice_code[];
```

예상 결과는 0 row다.

### Vote 원장과 legacy aggregate

```sql
WITH source AS (
  SELECT
    v.issue_id,
    v.issue_version,
    COUNT(*) FILTER (WHERE ic.choice_code = 'A')::int AS accepted_a,
    COUNT(*) FILTER (WHERE ic.choice_code = 'B')::int AS accepted_b,
    COUNT(*)::int AS accepted_total
  FROM votes v
  JOIN issue_choices ic ON ic.choice_id = v.choice_id
  WHERE v.integrity_state = 'ACCEPTED'
  GROUP BY v.issue_id, v.issue_version
)
SELECT
  va.issue_id,
  va.issue_version,
  va.accepted_a_count,
  COALESCE(s.accepted_a, 0) AS source_a,
  va.accepted_b_count,
  COALESCE(s.accepted_b, 0) AS source_b,
  va.accepted_vote_count,
  COALESCE(s.accepted_total, 0) AS source_total
FROM vote_aggregates va
LEFT JOIN source s USING (issue_id, issue_version)
WHERE va.accepted_a_count <> COALESCE(s.accepted_a, 0)
   OR va.accepted_b_count <> COALESCE(s.accepted_b, 0)
   OR va.accepted_vote_count <> COALESCE(s.accepted_total, 0);
```

차이가 있으면 migration 전에 기존 `points:reconcile`과 Vote integrity 절차로 원인을 해소한다.

## 2. Backfill 원칙

- Current aggregate는 legacy aggregate를 복사하지 않고 accepted Vote 원장에서 다시 계산한다.
- Snapshot child row는 해당 immutable `result_snapshots.accepted_a_count/accepted_b_count`를 A/B
  Choice ID에 매핑한다.
- 댓글 `choice_id`는 `(issue_id, issue_version, choice_snapshot)`으로 backfill한다.
- 공유 `shared_choice_id`도 `(issue_id, issue_version, shared_choice_code)`으로 backfill한다.
- Batch는 issue/version key 순서로 실행하고 cursor와 처리 수를 audit log에 남긴다.
- `ON CONFLICT DO UPDATE`를 사용하여 재실행 가능하게 한다.

## 3. Post-backfill 검증

### Generic aggregate와 Vote 원장

```sql
WITH source AS (
  SELECT
    v.issue_id,
    v.issue_version,
    v.choice_id,
    COUNT(*)::int AS accepted_count
  FROM votes v
  WHERE v.integrity_state = 'ACCEPTED'
  GROUP BY v.issue_id, v.issue_version, v.choice_id
), compared AS (
  SELECT
    COALESCE(s.issue_id, g.issue_id) AS issue_id,
    COALESCE(s.issue_version, g.issue_version) AS issue_version,
    COALESCE(s.choice_id, g.choice_id) AS choice_id,
    COALESCE(s.accepted_count, 0) AS source_count,
    COALESCE(g.accepted_count, 0) AS generic_count
  FROM source s
  FULL OUTER JOIN vote_choice_aggregates g
    USING (issue_id, issue_version, choice_id)
)
SELECT *
FROM compared
WHERE source_count <> generic_count;
```

예상 결과는 0 row다.

### Control total

```sql
SELECT
  va.issue_id,
  va.issue_version,
  va.accepted_vote_count,
  COALESCE(SUM(vca.accepted_count), 0)::int AS generic_total
FROM vote_aggregates va
LEFT JOIN vote_choice_aggregates vca
  USING (issue_id, issue_version)
GROUP BY va.issue_id, va.issue_version, va.accepted_vote_count
HAVING va.accepted_vote_count <> COALESCE(SUM(vca.accepted_count), 0)::int;
```

### Snapshot total

```sql
SELECT
  rs.tally_snapshot_id,
  rs.displayed_vote_count,
  COALESCE(SUM(rsc.accepted_count), 0)::int AS generic_total
FROM result_snapshots rs
LEFT JOIN result_snapshot_choices rsc
  ON rsc.tally_snapshot_id = rs.tally_snapshot_id
GROUP BY rs.tally_snapshot_id, rs.displayed_vote_count
HAVING rs.displayed_vote_count <> COALESCE(SUM(rsc.accepted_count), 0)::int;
```

### 댓글·공유 canonical Choice 누락

```sql
SELECT 'comments' AS source, COUNT(*) AS missing_count
FROM comments
WHERE deleted_at IS NULL AND choice_id IS NULL
UNION ALL
SELECT 'share_cards', COUNT(*)
FROM share_cards
WHERE shared_choice_code IS NOT NULL AND shared_choice_id IS NULL;
```

두 count 모두 0이어야 generic read로 전환할 수 있다.

## 4. Shadow verification gate

최소 7일 동안 모든 VS read에서 다음을 비동기로 비교한다.

- legacy A/B와 generic A/B count가 정확히 일치
- legacy displayed total과 generic Choice 합이 정확히 일치
- latest result version과 snapshot choice 합이 일치
- 댓글·공유 canonical Choice 누락 0
- dual-write 실패 0, outbox dead letter 0

불일치 응답은 사용자에게 노출하지 않고 issue/version/result version과 차이만 구조화 로그로 남긴다.
개인 식별자와 댓글 본문은 비교 로그에 넣지 않는다.

## 5. Internal PICK QA

- 3개·4개 Choice 작성, C/D 삭제와 재추가
- A/B는 제거 불가, 4개에서 add 불가
- Web·Mobile에서 A/B/C/D 각각 Vote 가능
- 중복 Vote, Guest→Member merge, 탈퇴 Member와 무효화 정합성
- 결과 percentage 합 100, 0표 처리, 동률과 1표 edge case
- Choice별 댓글 filter·대표 댓글·수정·삭제·공감·신고
- 선택 포함/미포함 공유 카드와 이미지 render
- 관심사 추천, 이미 투표한 Issue 제외, analytics shown position 0~3
- PICK을 모르는 Client와 flag OFF 환경에는 PICK이 반환되지 않음

## 6. Rollback

1. `ISSUE_PICK_WRITE_MODE=OFF`
2. `ISSUE_TALLY_READ_MODE=LEGACY`
3. `ISSUE_TALLY_DUAL_WRITE=false`
4. Feed/detail eligibility에서 `format_mode = 'PICK'` 제외 확인
5. VS Vote·댓글·공유 smoke test
6. generic table과 PICK Vote는 보존하고 불일치 원인 조사

다음 query가 0이어야 public rollback이 완료된 것이다.

```sql
SELECT COUNT(*) AS publicly_eligible_pick_count
FROM issues i
JOIN issue_versions iv
  ON iv.issue_id = i.issue_id
 AND iv.version = i.current_version
WHERE iv.format_mode = 'PICK'
  AND i.lifecycle = 'PUBLISHED'
  AND i.visibility = 'VISIBLE'
  AND i.participation = 'VOTING_OPEN'
  AND i.feed_eligibility = 'ELIGIBLE';
```

Rollback 시 C/D enum, generic aggregate나 stored PICK Vote를 삭제하지 않는다. 데이터 삭제가 아닌
노출·write 차단으로 복구 가능성을 유지한다.
