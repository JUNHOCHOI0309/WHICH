# Expanded Editorial Catalog 500 v2

이 디렉터리는 전달받은 `WHICH_Expanded_Issue_Catalog_500_v1_2026-08-25.zip`을 검수한 뒤
보정한 **편집 후보 재고**다. Production Issue Manifest가 아니며, 현재 상태로 게시하면 안 된다.

## 현재 상태

- 총 500개: Active 후보 72, Reserve 후보 108, Long-term 후보 320
- 기존 WHICH-19/49와 겹친 문항 25개: 새 의미와 새 UUID로 교체
- A/B가 함께 성립하거나 정답처럼 보인 문항 5개: 선택지 재작성
- 직접 근거가 확인된 공식 출처 재연결: 10개
- 사실 전제가 없는 문항의 억지 출처 제거 및 주관형 재분류: 20개
- 주제와 맞지 않는 커뮤니티 신호 연결 제거: 55개
- 커뮤니티 발견형: 목표 125개 중 현재 85개, 40개 부족
- 사람 승인: 0개, 모두 `PENDING_HUMAN_EDITORIAL_APPROVAL`

구조 검사를 통과했다는 사실은 편집 승인을 의미하지 않는다. 부족한 커뮤니티 신호를 직접 맞는
자료로 보충하고, 각 문항을 사람이 검토한 뒤에만 승인 상태를 기록한다.

## 파일

- `which-expanded-500-catalog-v2.json`: 보정된 500개 후보 원장
- `fact-source-registry-v2.json`: 공식 사실 출처 원장
- `community-source-registry-v2.json`: 커뮤니티 주제 발견 신호 원장
- `inventory-candidates-v2.json`: Active/Reserve/Long-term 후보 ID 분할
- `remediation-report-v2.json`: 교체·재작성·출처 보정 내역과 남은 차단 사유

Publication Calendar와 Production Manifest는 의도적으로 만들지 않았다. 사람 승인 전 파일이
운영 배포 경로에 놓이는 일을 막기 위한 조치다.

## Builder v2 승인 조건

Builder v2는 다음 조건을 모두 만족해야 Manifest를 만든다.

1. Catalog 전체가 `HUMAN_APPROVED` 상태다.
2. 선택된 후보마다 Binary Fit, A/B Parity, Duplicate, Source Review가 `PASSED`다.
3. Public 경로에는 `LOW`, 비정치 문항만 들어간다. `MEDIUM`은 별도 위험 승인 경로로 보낸다.
4. `SOURCE_REQUIRED` 문항은 등록된 공식 출처와 미래의 `reviewAfter`/`expiresAt`을 가진다.
5. 기존 승인 Manifest와 의미 지문이 겹치지 않는다.
6. 별도 승인된 Publication Plan이 후보 ID와 게시 시각을 지정한다.

사람 승인 후 사용 예시는 다음과 같다.

```bash
pnpm --filter @which/api issues:build \
  apps/api/content/editorial/expanded/which-expanded-500-catalog-v2.json \
  apps/api/content/issue-packs \
  --source-registry apps/api/content/editorial/expanded/fact-source-registry-v2.json \
  --publication-plan <approved-publication-plan.json> \
  --comparison-manifest apps/api/content/issue-packs/which-19-initial-low-v1.json \
  --comparison-manifest apps/api/content/issue-packs/which-49-active-expansion-v1.json
```

현재는 승인된 Publication Plan이 없으므로 위 명령을 실행할 단계가 아니다.

## 사람 편집 승인 콘솔

500개 원장을 직접 수정하지 않고 로컬 전용 검토 화면에서 승인 결정을 기록한다.

```bash
pnpm --filter @which/api issues:review
```

브라우저에서 `http://127.0.0.1:4317`을 열고 Active 72개부터 검토한다. 콘솔은
`127.0.0.1`에만 바인딩되며 Render나 운영 Web에는 노출되지 않는다.

- 재고·상태·범주·위험도·검색어로 후보를 필터링한다.
- 질문, 맥락, A/B, 자동 검증 상태, 공식 출처와 커뮤니티 발견 신호를 함께 확인한다.
- 승인하려면 Binary Fit, A/B Parity, Duplicate, Source Fit 네 항목을 모두 체크한다.
- `승인`, `수정 필요`, `반려`와 메모는 `editorial-review-decisions-v1.json`에 원자적으로 저장된다.
- 승인 후보 내보내기는 원본 500개 카탈로그를 변경하지 않고 `approved/` 아래에 승인된 부분
  카탈로그와 Publication Plan 초안을 생성한다.
- 내보낸 파일도 곧바로 게시하지 않는다. Diff 검토, Builder v2, 전체 테스트, Manifest Digest 승인,
  Publisher dry-run을 순서대로 통과해야 한다.

Active 72개를 먼저 완료한 뒤 Reserve 108개, Long-term 320개 순서로 진행한다. MEDIUM 후보는
승인 결정을 기록할 수 있어도 Public Publication Plan에서는 제외된다.

## 원본 재생성

보정 결과를 재생성해야 한다면 압축을 안전하게 푼 디렉터리를 입력으로 사용한다.

```bash
node scripts/remediate-expanded-catalog.mjs \
  <extracted-source-root> \
  apps/api/content/editorial/expanded
```

스크립트는 500개 원본을 바탕으로 동일한 교체·출처 보정 규칙을 적용한다. 생성 후 전체 API 테스트를
통과해야 한다.
