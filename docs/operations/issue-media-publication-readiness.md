# WHICH-105 — 제출별 자동 공개 준비 진단

작성일: 2026-08-30
상태: 검사 근거 연결·진단 구현. 자동 공개 실행 및 운영 활성화는 미완료.

## 목적과 범위

목표는 정상 저위험 이미지를 자동 공개하고 애매한 사례만 운영자가 검토하는 것이다.
이번 단계는 낮은 유해성 점수를 전체 검사 통과로 오인하지 않도록 **실제 검사 범위와 보류 사유**를 연결한다.
추가 유료 모델·API 호출, 새 키, Render 환경변수 변경, 새 DB migration은 없다.
사용자에게 출처/alt/crop/OCR 항목을 하나씩 입력시키는 폼도 추가하지 않는다.

`moderation_runs.result.publicationReadiness`는 새 제출 검사 완료 시 기록하는 관찰 결과다.
`executionAuthorized`는 항상 `false`, 상태는 `PRIVATE_REVIEW_REQUIRED`다.
이는 실행 토큰이나 사용자 제재가 아니며 R2 공개·승인·알림을 발생시키지 않는다.
지연된 수정본·취소·격리 또는 lease 상실 결과에는 새 진단을 현재 근거로 저장하지 않는다.

## 확인하는 근거

- 제출의 현재 revision/hash, PENDING 여부, 미게시 여부, 서로 다른 A/B 이미지.
- 각 이미지의 작성자 소유권, MEMBER_SUBMISSION 종류, READY/PENDING/STAGED 상태, 사용 권리 확인 상태.
- 원본 SHA-256과 불변 asset version 1의 정규화 SHA-256 연결, 현재 활성 known-block hash.
- 해당 두 hash와 규칙 버전에 결합된 정규화/해시/라우팅 근거 및 로컬 검사 상태.
- 로컬 규칙 ENFORCE 여부, 등록된 detector 버전, QR/바코드/OCR/visual 완료 여부와 실패 코드.
- Provider 성공·고정 모델·입력 계약·두 이미지 및 제출 문맥 결합, 기권/충돌/검토 신호.
- 공식 카테고리별 지원 범위와 실제 `category_applied_input_types`를 교차 확인한 TEXT/IMAGE 커버리지.

공식 API가 `sexual/minors`, harassment, hate, illicit 계열에 제공하는 것은 텍스트 지원이다.
이미지를 함께 보냈다고 해당 항목을 이미지 검사 완료로 취급하지 않는다.
얼굴/신분증/권리 판단 및 보정된 clear 판정은 현재 구현으로 제공되지 않는다.
이미지 속 OCR 본문은 [텍스트 안전 검사 연결](./issue-media-embedded-text-safety.md) 이후 기존 Shadow 입력에 결합한다.
누락·실패·개인정보 전달 보류·불완전 Provider 텍스트 결과는 이미지별 보류 사유로 남긴다.
`1 - 최고 위험 점수`를 안전 확률로 변환하지 않는다.
근거: [OpenAI Moderations API](https://developers.openai.com/api/reference/resources/moderations).

## 운영 조회

운영 Shell에서 실제 **제출 ID**를 넣는다. asset ID나 이미 게시된 Issue ID가 아니다.

```bash
node apps/api/dist/moderation-worker.js diagnose-publication <submission-id>
```

개발 환경에서는 `pnpm --filter @which/api moderation:diagnose-publication <submission-id>`를 사용한다.
DB 조회만 수행하며 OpenAI/R2 호출, 재검사, 게시, 데이터 변경은 하지 않는다.
최신 Run이 없으면 `NO_SUBMISSION_RUN`; 존재하면 최신 Run과 현재 제출·이미지·규칙 상태로 다시 계산한다.
실패/대기 중인 Run은 `PROVIDER_NOT_SUCCEEDED` 등으로 표시한다.
저장 당시 진단과 현재 진단은 수정·취소·known-block 추가 등으로 달라질 수 있다.
여러 조회 사이 상태가 바뀔 수도 있는 운영 진단이며, 원자적 실행 허가로 사용할 수 없다.

대표적인 코드:

| 코드                                         | 의미                                             |
| -------------------------------------------- | ------------------------------------------------ |
| `SUBMISSION_BINDING_MISMATCH`                | 검사한 수정본/hash와 현재 제출이 다름            |
| `A_…` / `B_…`                                | 해당 선택지 이미지의 소유권·상태·규칙·검사 누락  |
| `IMAGE_COVERAGE_INCOMPLETE`                  | 필요한 이미지 지원 카테고리 결과가 불완전함      |
| `VISUAL_ENGINE_NOT_IMPLEMENTED` (A/B 접두사) | 등록된 로컬 엔진에 시각 분류 기능이 없음         |
| `EMBEDDED_TEXT_EVIDENCE_MISSING`             | OCR 검사 근거가 없거나 구버전 결과임             |
| `SHADOW_IS_NOT_EXECUTION_AUTHORITY`          | 현재 Run은 관찰용이며 공개 권한이 없음           |
| `CALIBRATED_CLEAR_EVIDENCE_REQUIRED`         | 저위험 공개를 뒷받침할 보정·검증된 근거가 필요함 |

진단에는 원문, 이미지, OCR/QR 내용, Provider raw payload, 비밀키를 복사하지 않는다.
제출별 진단은 재사용 Provider 캐시에 저장하지 않고 캐시 적중 시 현재 상태에서 새로 계산한다.
과거 Run에 일괄 backfill하거나 자동 재호출하지 않는다.

## 결정 엔진 계약 보강

`which-decision-engine-v2`는 PROVISIONAL 요청에 `which-provisional-evidence-v1`을 요구한다.
TECHNICAL / KNOWN_BLOCK / LOCAL_PII / LOCAL_VISUAL / IMAGE_SAFETY / CONTEXT_SAFETY /
RIGHTS / CAPABILITY / CONSENT 각각에 정확히 하나의 PASS 근거가 필요하다.
근거는 동일 입력 hash·현재 정책·출처 버전·근거 ID·관찰 시각·유효 기한을 가져야 한다.
누락/중복 검사, 비정상·만료·미래 근거, 경쟁 위험 신호, 중복 근거 ID 및 근거 개수 불일치는 PRIVATE_PENDING으로 보낸다.
양의 정수 TTL이 없으면 거절하며 공개 유효 기한은 필수 근거 중 가장 이른 만료보다 늦을 수 없다.

이 계약은 내부의 신뢰 가능한 근거 해석기 전용이다. 클라이언트 JSON이나 Provider 응답으로 생성하면 안 된다.
이번 관찰 결과는 위 계약을 충족하는 PASS 증빙을 발급하지 않는다.
엔진의 `EXECUTE` 반환도 순수 판정 값이며 실제 게시를 실행하는 함수가 아니다.
현재 threshold 값이 운영 Golden Set 보정을 완료했다는 의미도 아니다.

## 남은 단계

1. 미지원 시각 검사 보완, 연결된 OCR 본문 안전 검사의 실제 호스트 자원 검증 및 카테고리별 정확도/기권 평가.
2. 검증된 근거를 생성하는 내부 해석기와 현재 capability/consent·privacy·예산·출시 승인 재검증.
3. WHICH-105에서 판정→가역 공개 실행 연결: DB/R2 부분 실패 복구, TTL/회수/캐시 무효화/알림/감사 및 경합 테스트.
4. WHICH-111의 대표 샘플·Shadow 증빙·카테고리 승인 후 제한적 활성화.

사용자 목표를 운영자 매번 승인으로 변경한 것이 아니다. 현재의 관찰 모드와 아직 없는 검사 능력을
명확히 구분하며 최종 자동 공개까지 완료했다고 기록하지 않는다. WHICH-105는 Doing으로 유지한다.
