# Report Signal v2 운영 기준

WHICH-92는 기존 Comment 신고 원장에 더해 공개 Issue와 Issue Media Asset 신고를 저장하고,
신고 몰이(Brigading)를 판결과 분리된 Signal로 관찰하는 기반을 추가한다.

## 불변 원칙

- 신고 수는 Sensor이지 판결이 아니다.
- 일반 신고 수, 가중치, Cluster 분류만으로 콘텐츠 삭제, 영구 Hide, 계정 제재를 실행하지
  않는다.
- 원 신고는 병합 후에도 삭제하지 않는다. `counted=false`와 `merged_into_report_id`로 중복만
  제외한다.
- Guest가 Member로 연결되면 동일 대상 신고는 한 사람의 신고로 합쳐진다.
- Reporter Signal과 Cluster Signal은 `shadow_only=true`로 저장하며 피드 순위, 투표 결과,
  배지, 계정 제재에 사용하지 않는다.
- 개인정보·중대한 안전 신고의 자동화 상한은 P0 검토 라우팅과 가역 격리 권고다. 현재
  일반 Member/Guest 신고는 콘텐츠 상태를 직접 변경하지 않는다.
- 개인정보, 명예훼손, 저작권 Rights 요청은 일반 신고와 별도인 기존
  `issue_media_rights_requests` 증빙·처리 흐름을 사용한다.

## 데이터 구조

| 구조                        | 역할                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `report_cases`              | 동일 Issue/Asset의 활성 사건 단위와 P0 라우팅 상태                  |
| `report_clusters`           | 15분 단위 집중 유입 묶음                                            |
| `content_reports`           | 원 신고, 신고 주체, 최초 Guest 출처, 사유, 당시 가중치 보존         |
| `content_report_attempts`   | Idempotency 재실행과 충돌 방지                                      |
| `report_signal_snapshots`   | 신고자 수·가중치·15분/24시간 속도·Guest/신규 계정 비율·Cluster 분류 |
| `reporter_signal_snapshots` | 30일 신고량·병합 중복·계정 연령을 Shadow 상태로 보존                |

기존 Comment 신고는 `comment_reports`와 `comment_report_attempts`가 계속 원장 역할을 하며,
10점 Collapse·20점 가역 Hide 정책도 유지된다. WHICH-92는 해당 정책의 임계치를 변경하지
않는다.

## Cluster 해석

- `BASELINE`: 15분 내 신고가 0~2건이다.
- `CONCENTRATED`: 15분 내 신고가 3건 이상이지만 조직성 조건은 충족하지 않는다.
- `COORDINATED_SUSPECTED`: 15분 내 5건 이상이며 Guest 비율 80% 이상 또는 가입 7일 미만
  비율 60% 이상이다.

이 분류는 운영자에게 조사 우선순위를 제공할 뿐 신고를 무효화하거나 콘텐츠를 제재하지
않는다. 신고자 신뢰도도 판정 이력이 쌓이기 전에는 `UNKNOWN` 또는 `ESTABLISHING`만
사용한다.

## API

`POST /v1/reports`

- 대상: `ISSUE`, `ISSUE_MEDIA`
- 주체: 활성 Member 세션 또는 Guest subject
- Idempotency: `idempotency-key` UUID 필수
- 중복: 동일한 연결 주체가 같은 대상을 다시 신고하면 `409 REPORT_ALREADY_EXISTS`
- Rights 사칭 방지: 일반 `IMPERSONATION` 신고는 Asset을 삭제·격리하지 않는다. 정식
  저작권·개인정보 요청은 Rights Desk로 분리한다.

## 운영 확인

1. 마이그레이션 `0040_uneven_the_liberteens.sql` 적용 여부를 확인한다.
2. 5개의 신규 Guest 신고를 동일 대상에 15분 내 전송한다.
3. 최신 `report_signal_snapshots.cluster_classification`이
   `COORDINATED_SUSPECTED`인지 확인한다.
4. 대상 Issue/Asset 상태가 그대로인지 확인한다.
5. Guest 신고 후 해당 Guest를 기존 Member에 연결하고 `content_reports`에서 한 행만
   `counted=true`인지 확인한다.
6. 정식 Rights 요청은 `issue_media_rights_requests`에만 생성되는지 확인한다.

## 후속 작업

- WHICH-95/96: Shadow 신호의 정밀도·재현율과 운영 비용 측정
- WHICH-102/103: 운영자 Review Assist와 제한적 가역 조치 연결
- 충분한 판정 데이터 전에는 `RELIABLE`, `ABUSE_SUSPECTED`를 자동 산출하거나 정책 입력으로
  사용하지 않는다.
