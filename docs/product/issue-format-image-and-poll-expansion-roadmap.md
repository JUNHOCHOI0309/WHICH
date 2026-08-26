# Issue Format, Image, and Poll Expansion Roadmap

- Status: v1 candidate backlog — Public v0 beta evidence pending
- Last updated: 2026-08-26
- Notion plan: [Issue 형식·이미지·질문 품질 확장 계획 v1](https://app.notion.com/p/3c828b27a55981b99e9bcd461fd62d41?pvs=204)
- Accepted architecture decision: [`ADR-0003: Issue format and media policy`](../architecture/adr/0003-issue-format-and-media-policy.md)
- Related roadmap: [`post-v0-discovery-recommendation-ai-roadmap.md`](./post-v0-discovery-recommendation-ai-roadmap.md)
- Release boundary: this document does not expand the Public v0 launch gate.

## 문서 목적

이 문서는 다음 두 검토 자료를 WHICH의 현재 Production 구조에 적용하기 위한 제품 결정, 기술
경계, 출시 순서와 Notion Backlog를 저장소에 함께 보관한다.

- `WHICH_IMAGE_AND_POLL_FORMAT_POLICY_REPORT_v0.1.md`
- `WHICH_YOUTUBE_COMMUNITY_POLL_BENCHMARK_REPORT_v0.1.md`

원본 보고서의 문장, 채널 콘텐츠, 이미지나 임의 점수식을 그대로 제품에 이식하지 않는다. 보고서의
제안은 가설과 참고 자료로 다루고, WHICH 내부 행동 데이터와 운영 증거로 검증한다.

## 요약 결정

1. WHICH의 대표 경험과 기본 형식은 텍스트 A/B `VS`로 유지한다.
2. 첫 시각 형식 확장은 운영자 전용 `OPTION_IMAGES` A/B로 제한한다.
3. 이미지 등록은 실제 비교에 시각 정보가 필요한 질문에만 사용한다.
4. `PICK` 3~4지선다와 사용자 이미지 업로드는 이미지 A/B와 분리된 후속 프로젝트로 추진한다.
5. `TOURNAMENT`와 `PREDICTION`은 일반 Issue의 옵션 수만 늘리는 기능으로 취급하지 않는다.
6. YouTube 사례는 질문 문장이 아니라 질문 원형과 참여 구조를 학습하는 참고 자료로만 사용한다.
7. 추천과 논쟁 후보는 50:50 또는 절대 참여 수만으로 결정하지 않는다.
8. 이미지와 형식 확장은 feature flag, 관찰 가능성, fallback, rollback 없이 공개하지 않는다.

WHICH-81에서 위 결정의 데이터 소유권, 상태축, A/B 호환과 Migration boundary를 ADR-0003으로
확정했다. 이 로드맵의 후속 Task는 ADR을 바꾸지 않으며, 경계를 변경해야 할 경우 새 ADR로
대체 결정을 남긴다.

## 현재 WHICH 구조와 적용 경계

### 재사용 가능한 기반

- `issues -> issue_versions -> issue_choices`로 Issue와 선택지가 분리되어 있다.
- Vote는 `choice_id`를 참조하므로 선택 자체는 안정적인 Choice ID를 기준으로 기록한다.
- Issue에는 lifecycle, visibility, participation, result visibility, feed eligibility, risk level이
  분리되어 있다.
- 아바타 업로드에 R2, Sharp, 입력 크기 제한, 방향 보정, WebP 재인코딩과 삭제 흐름이 있다.
- 댓글에는 신고, 자동·수동 Moderation, 가시성 상태와 결정 이력이 있다.
- 운영 콘솔에는 Editorial 승인·수정 필요·반려와 Audit Log 기반이 있다.

### 현재 A/B 고정 지점

- `choice_code` PostgreSQL enum은 `A`, `B`만 허용한다.
- Vote aggregate와 result snapshot은 `accepted_a_count`, `accepted_b_count`로 고정되어 있다.
- API 계약과 Web·Mobile 결과 UI는 `acceptedA`, `acceptedB`를 사용한다.
- 댓글의 선택 snapshot과 공유 카드의 shared choice도 A/B enum을 사용한다.
- Issue Pack manifest는 A와 B가 정확히 하나씩 존재하는 tuple을 요구한다.
- Member 작성기는 `choiceA`, `choiceB`를 받고 LOW-risk 질문을 곧바로 게시한다.

따라서 운영자 이미지 A/B는 기존 핵심 Vote 계약을 유지한 채 확장할 수 있지만, 3~4지선다는 DB,
집계, API, 댓글, 공유, 분석, Web·Mobile을 함께 바꾸는 횡단 Migration이다.

## 제품 형식 정책

### `VS`

- 선택지 수: 정확히 2개
- 위치: 메인 Feed와 논쟁 Surface의 대표 형식
- 결과: 기존 Balance Result 표현 유지
- 기본 media mode: `TEXT_ONLY`
- 선택적 media mode: `OPTION_IMAGES`

### `PICK`

- 선택지 수: 3~4개, 단일 선택
- 적합 범위: 자기분류, 메뉴·후보 선택, 행동 강도, 실제 복수 원인
- 상태: Migration Spike와 제한 실험 전까지 사용자 노출 금지
- 논쟁 Surface: 초기에는 제외

### `TOURNAMENT`

- 5개 이상 후보를 한 카드에 나열하지 않고 A/B 라운드로 진행한다.
- Series, Round, advancing Choice, 종료 상태와 다음 라운드 생성 규칙이 필요하다.
- 단발 Issue와 분리된 재방문·시즌 성과 지표를 사용한다.

### `PREDICTION`

- `closesAt`, resolution status, resolved Choice, `VOID`, 적중 여부가 필요하다.
- 상시 취향 Issue와 추천, 만료, 결과 확정 및 성과 측정을 분리한다.
- 스포츠·시상식 등 실제 수요가 확인되기 전에는 구현하지 않는다.

## 이미지 정책

### 첫 지원 범위

```text
작성자: 운영자만
형식: VS
미디어: 선택지별 이미지 1장
라벨: 필수
외부 URL: 금지
GIF·영상: 금지
일반 사용자 업로드: 비활성
```

이미지 로딩 실패, 저속 연결, 접근성 도구 사용 시에도 텍스트 라벨만으로 질문을 이해하고 투표할 수
있어야 한다. 두 이미지의 비율, 크기, 화질, crop과 시각적 강조는 가능한 한 대칭이어야 한다.

### 권장 데이터 개념

기존 Issue 모델을 확장하고 별도 `polls` 도메인을 병행하지 않는다.

#### Issue Version format metadata

- `poll_mode`: `VS`, 향후 `PICK`
- `media_mode`: `TEXT_ONLY`, `OPTION_IMAGES`
- 형식과 미디어 모드는 versioned content로 관리한다.

#### Issue media asset

- owner와 storage key
- MIME, file size, width, height
- SHA-256과 perceptual hash
- source type과 rights attestation
- 검사 정책·모델 버전과 검수 상태
- 게시, 블라인드, 삭제 시각

#### Choice media link

- issue ID, issue version, choice ID
- media asset ID
- 대체 텍스트
- crop·표시 정보

현재 Issue 상태축과 중복되는 단일 `status`를 새로 만들지 않는다. 미디어에는 자산 처리와 검수에
필요한 독립 상태를 두고, Issue의 공개·참여 가능 여부는 기존 상태축을 유지한다.

### R2 수명주기

아바타의 공개 immutable object 정책을 Issue 이미지에 그대로 사용하지 않는다.

```text
issue-media/staging
  -> 비공개 원본 또는 검수용 변형
  -> 승인·반려·고아 객체 정리

issue-media/published
  -> 승인된 게시용 WebP 변형
  -> 블라인드·권리침해·삭제 시 접근 차단 또는 purge
```

- JPEG, PNG, WebP만 허용한다.
- 서버에서 MIME/signature, 용량, pixel count를 검사한다.
- 방향을 보정하고 EXIF·GPS를 제거한 뒤 WebP로 재인코딩한다.
- 원본 보존 여부와 보존 기간을 정책으로 고정한다.
- 업로드와 Issue 연결은 2단계로 처리하고 서버에서 소유권과 승인 상태를 다시 검증한다.

### 사용자 업로드 선행 Gate

운영자 이미지 Pilot이 안정되어도 다음 조건을 충족하기 전에는 사용자 업로드를 열지 않는다.

- 이미지별 신고와 즉시 블라인드
- 개인정보·명예훼손·저작권 전용 접수 경로
- 파일 signature, 유해성, OCR 개인정보, QR, 중복 hash 검사
- 승인, 검토 대기, 거절 threshold와 사람 검토 Queue
- 작성자 통지, 소명, 복원과 반복 위반 권한 회수
- 운영자가 실제 검토량을 처리할 수 있다는 지표

이미지 권한은 Member status와 분리된 capability 또는 entitlement로 관리한다.

## 질문 원형과 Editorial 품질

외부 사례의 공개 문장을 저장해 재사용하기보다 다음 원형을 관리한다.

- 생활 습관형
- 직접 취향형
- 상황 판단형
- 손익 충돌형
- 자기분류형
- 결과 후속형
- 공동제작형

작성기 Linter와 운영자 Rubric는 최소한 다음을 검사한다.

- 선택지 의미 중복
- 문법, 길이, 추상화 수준의 대칭성
- 한쪽만 긍정적으로 표현하는 유도 문구
- 외부 사실 확인이 필요한 전제
- 민감 집단, 실제 인물, 사건의 부당한 대상화
- `기타/모르겠다` 선택지가 실제로 필요한지
- 외부 원문과의 유사도, provenance와 권리 검수
- 독립 맥락에서 1~2초 안에 이해 가능한지

임의의 100점 배점이나 외부 참여 수를 운영 상수로 고정하지 않는다. Rubric 항목, 정책 버전과
판정 결과를 저장하고 WHICH의 실제 성과와 비교해 가중치를 정한다.

## 품질 분석 계약

기존 노출, 투표 제출, 결과 확인, 다음 질문, 공유 이벤트에 다음 신호를 보강한다.

- 선택까지 걸린 시간
- 결과 화면 체류
- 댓글 작성 완료
- 다음 카드 이동
- skip, hide, report
- 이미지 로드 성공·실패
- canonical Choice와 실제 shown position

핵심 파생 지표:

- Impression -> Vote conversion
- Vote -> Result와 Vote -> Next conversion
- Qualified votes per session
- 댓글·공유율
- 빠른 이탈·건너뛰기율
- 신고·숨김률
- 반복 노출과 주제·작성자 집중도
- 이미지 제작·검수 시간과 운영 비용

Analytics Session 생성 실패는 Vote의 필수 조건이 아니며, 계측 장애가 투표를 막지 않는 기존 원칙을
유지한다.

## 추천과 논쟁 후보

목표 구조:

```text
Eligibility
  -> Candidate retrieval
  -> Quality-aware ranking
  -> Policy and diversity re-ranking
  -> Exploration and deterministic fallback
  -> Feed slate
```

Eligibility에서 이미 투표한 Issue, 비공개·위험·중복 Issue와 집중 공격 의심 후보를 제거한다.
Retrieval은 명시 관심사, 신선한 Editorial 콘텐츠, 품질 후보와 제한된 탐색 Pool을 혼합한다.

논쟁 후보는 다음 신호를 함께 사용한다.

```text
최소 유효 참여
+ 일정 범위의 결과 균형
+ 댓글 참여
+ 질문 품질 통과
+ 낮은 신고·이탈·부정 피드백
```

50:50 결과, 절대 Vote 수 또는 자극성만으로 Trending·논쟁·추천 자격을 얻을 수 없다. 모든 자동
판단은 후보 출처, 점수 구성, 정책 버전과 fallback reason을 운영자가 추적할 수 있어야 한다.

## 단계별 출시 순서

### Phase 1 — 기반과 측정

- 형식·미디어 ADR과 상태 모델
- 질문 원형·Editorial Rubric와 Authoring Linter
- 품질 분석 이벤트와 Data Quality 검증

### Phase 2 — 운영자 이미지 A/B

- 비공개 staging과 게시용 R2 자산
- WebP 재인코딩과 메타데이터 제거
- 권리 출처·검수·블라인드·삭제
- Web·Mobile Feed, Detail, Result, Share 지원
- 제한 노출 실험과 운영 비용 측정

### Phase 3 — 추천 품질

- 내부 행동 신호 기반 품질 Score
- 다양성 Re-ranking과 deterministic fallback
- 운영자 Preview와 Shadow mode
- 기존 관심사 기반 Ranker 대비 guarded rollout

### Phase 4 — 형식·커뮤니티 확장

- `PICK` 3~4지선다 Migration Spike
- 신뢰 사용자 이미지 Capability Pilot
- Series, Tournament, Prediction 도메인 연구

## Notion Backlog

| Task                                                                          | Priority | Phase             | 목적                                               |
| ----------------------------------------------------------------------------- | -------- | ----------------- | -------------------------------------------------- |
| [WHICH-81](https://app.notion.com/p/3c828b27a55980ebbefaed277d7a266f?pvs=204) | P1       | Data Architecture | Issue 형식·미디어 정책 ADR 및 상태 모델 확정       |
| [WHICH-82](https://app.notion.com/p/3c828b27a559815a9795dc8ed8849765?pvs=204) | P1       | Editorial         | 질문 원형·편집 품질 Rubric와 Authoring Linter 설계 |
| [WHICH-83](https://app.notion.com/p/3c828b27a55981ecbb91c6d5b47d321a?pvs=204) | P1       | Personalization   | Issue 품질 분석 이벤트와 데이터 계약 확장          |
| [WHICH-84](https://app.notion.com/p/3c828b27a55981458752e9418d7d39d3?pvs=204) | P1       | Data Architecture | 운영자 전용 이미지 A/B 미디어 자산 기반 구축       |
| [WHICH-85](https://app.notion.com/p/3c828b27a559817cb501e46561aed7c3?pvs=204) | P1       | Integrity         | Ops 이미지 권리·검수·블라인드 워크플로 구축        |
| [WHICH-86](https://app.notion.com/p/3c828b27a559816992f4e4b049ccb8c2?pvs=204) | P2       | Core Vote         | Web·Mobile 이미지 A/B 카드와 제한 노출 실험        |
| [WHICH-87](https://app.notion.com/p/3c828b27a55981758337dfdf9bd9b103?pvs=204) | P1       | Personalization   | 품질 기반 Feed 추천과 논쟁 후보 선정 v1            |
| [WHICH-88](https://app.notion.com/p/3c828b27a55981258ed8c6ca277e7925?pvs=204) | P2       | Data Architecture | PICK 3~4지선다 데이터·API Migration Spike          |
| [WHICH-89](https://app.notion.com/p/3c828b27a55981dfad36c9126672a919?pvs=204) | P3       | Community         | 신뢰 사용자 이미지 업로드 Capability Pilot 설계    |
| [WHICH-90](https://app.notion.com/p/3c828b27a559816389a5d4fc4e36f1d4?pvs=204) | P3       | Core Vote         | Series·Tournament·Prediction 도메인 경계 연구      |

권장 Critical Path:

```text
WHICH-81
  -> WHICH-82 + WHICH-83
  -> WHICH-84
  -> WHICH-85
  -> WHICH-86 + WHICH-87
  -> evidence review
  -> WHICH-88~90 중 필요한 항목만 승격
```

## Go/No-Go 기준

### 운영자 이미지 A/B 공개

- 승인 전 자산이 공개되지 않는다.
- 이미지 실패 시 텍스트 fallback으로 Vote가 성공한다.
- Issue와 이미지별 블라인드·삭제·복원이 가능하다.
- 권리·검수·운영자 결정 이력이 남는다.
- TEXT_ONLY 대비 성과 개선이 신고·지연·운영 비용 악화보다 크다.

### 신뢰 사용자 이미지 Pilot

- 운영자 이미지 검수 Queue가 안정적으로 운영된다.
- 이미지별 신고와 권리 요청이 SLA 안에서 처리된다.
- 자동 검사가 오탐·미탐을 포함해 측정 가능하고 사람 검토 fallback을 가진다.
- capability 회수, 작성자 통지, 소명과 복원이 검증된다.

### `PICK` 사용자 노출

- per-choice aggregate와 generic tally의 A/B backfill이 일치한다.
- 댓글·공유·분석·Web·Mobile이 가변 Choice 계약을 지원한다.
- 기존 A/B read/write와 rollback이 유지된다.
- `PICK`이 A/B로 표현할 수 없는 문제를 실제로 해결한다는 사용 근거가 있다.

## 의도적으로 보류하는 항목

- 일반 사용자 이미지 전면 개방
- GIF, 영상과 외부 이미지 URL
- 선택지당 여러 이미지
- 복수 응답, 5점·10점 척도 설문
- 선택지 5개 이상을 한 카드에 직접 표시
- 모든 Issue의 자동 AI 이미지 생성
- 타인 얼굴과 외모를 비교하는 Issue
- 외부 플랫폼 원문·고유 IP·이미지의 재사용
- 이용약관·보관 정책 검토 전 대량 Scraping
