# Luna 이미지 정책 검사 — 비용 통제형 Shadow 도입

작성일: 2026-08-30

상태: 운영 OFF 배포·0054 마이그레이션 적용 완료. 모델 조회 200 확인.
실제 유료 추론과 자동 공개는 미활성. [배포·검증 기록](./luna-off-release-2026-08-30.md).

## 결정과 범위

- 사용자 결정: `gpt-5.6-luna`, Render의 기존 `OPENAI_API_KEY` 재사용.
- 기존 `omni-moderation-2024-09-26` 무료 안전 검사를 대체하지 않는다.
- Luna는 성공한 무료 검수의 **현재 사용자 A/B 이미지 질문 revision**만 정밀 검사한다.
- 이미지 단독·댓글·텍스트 전용 질문에는 유료 판정기를 호출하지 않는다.
- 질문, A/B 선택지, 두 이미지, 최소화된 OCR를 한 요청에 넣는다.
- 이번 단계는 측정·비용 제어·Shadow 연결까지다. 시각 검사 보완, Golden Set 실측,
  선택적 라우팅 보정, 제한적 자동 공개는 후속 단계다.
- ALLOW도 공개 권한이 아니다. Issue/이미지 상태, 회원 제재·알림, 기존 안전 검사 결과를
  변경하지 않는다. 어떤 실패도 미검수 자동 게시로 이어지지 않는다.

## 요청과 정보 최소화

- endpoint: `POST /v1/responses`
- model: `gpt-5.6-luna` (임의 모델 대체 없음)
- `store: false`, `reasoning.effort: none`, `max_output_tokens: 384`
- strict JSON Schema, 자유 서술·신원 추론·정확한 연령/민감 속성 추론 금지.
- 기본 입력은 긴 변 최대 512px, 비율 유지, WebP, `detail: low`.
- 저장용 파일은 기존 정책을 유지한다. 512px 검사용 파일은 메모리에서만 만들며 R2에
  업로드하지 않는다. 새 버킷/원본 추가 보관이 필요하지 않다.
- OCR는 기존 해시 검증된 저장용 픽셀에서 수행한다. PARTIAL/UNAVAILABLE/WITHHELD_PII는
  Luna로 보내지 않는다. 512px에서 판단하기 어려운 경우 ABSTAIN으로 남긴다.
- DB에는 enum 판단, 모델/프로필, 해시, 토큰 수, 지연·비용·정제된 오류 코드만 기록한다.
  이미지 데이터, OCR 원문, 질문 프롬프트, 공급자 원응답·오류 본문은 기록하지 않는다.
- `store: false`는 ZDR이나 무보존 보증이 아니다. `/moderations`와 `/responses`의
  데이터 통제 조건은 다르므로, 기존 증빙에 더해 Responses 사용 범위 승인을 별도로 요구한다.

## 라우팅과 캐시

1. 기존 개인정보/킬 스위치와 Luna OFF/SHADOW·별도 승인·canary·예산 조건 확인.
2. 현재 revision/해시/소유권/이미지 상태와 성공한 무료 안전 검사 근거 확인.
   현재 회원 상태·유효한 업로드 권한·해당 버전의 미철회 동의·차단 해시도 재확인한다.
3. 무료 검수가 위반을 표시하거나 OCR 근거가 불완전하면 유료 호출 없이 검수 대기 유지.
4. canary에 포함된 질문만 재해석·정규화한다. 작은 안전 점수는 안전 증명이 아니다.
5. A/B 맥락 캐시 조회 → 동일 조합 in-flight 중복 방지 → 예산 예약 → Luna 1회 호출.
6. 응답 후 현재 revision과 삭제·권리 상태를 다시 잠금/검증한 뒤 Shadow 결과만 저장.

캐시는 기존 `moderation_provider_call_cache`의 별도 `OPENAI_POLICY_JUDGE` namespace를 쓴다.
질문·선택지·OCR, **순서 있는** 두 픽셀 해시, 모델, 정책, 프롬프트/스키마,
전처리·스캐너 버전을 포함한다. 이미지 단독 안전 캐시와 혼용하지 않는다.
TTL은 24시간. 오류·ABSTAIN·stale 결과는 재사용하지 않는다.
캐시 hit도 현재 대상 상태 검증을 통과해야 한다. 유사 이미지 해시는 승인 근거로 쓰지 않는다.

현재 시각 범주 보완/라우터 교정이 미완성이므로 일반적인 낮은 점수의 이미지도
`COVERAGE_GAP` 후보로 남긴다. `LOW_SIGNAL_AUDIT` 표본도 별도로 기록한다.
**유료 5~~15%, 사람 0.5~~3%는 달성된 수치가 아니다.** 이 단계의 canary는 검증 비용만
통제하며, 제외된 질문을 자동 승인하지 않는다.

같은 무료 Run/프로필에는 한 번만 평가한다. canary에서 제외되어 SKIPPED로 기록된
과거 Run을 canary 확대만으로 재검사하지는 않는다. 과거 샘플 재평가는 별도 계획으로 수행한다.

## 영속 예산 원장

새 migration: `0054_luna_policy_judge.sql`.
운영 main의 `0053_tiktok_identity_provider.sql` 뒤에 추가한다. 배포 전 번호 충돌을
해소하여 기존 TikTok migration/snapshot은 그대로 보존했다.

- `policy_judge_budgets`: UTC 일자별 시도 수·보수적 확정/예약 금액.
- `policy_judge_evaluations`: source Run/프로필별 처리 이력·예약·실사용 토큰.
- PostgreSQL 원자적 조건 UPDATE로 **호출 수와 예상 최대 비용을 동시에 예약**한다.
  여러 worker에서도 두 한도를 넘어 예약하지 않는다.
- 텍스트 UTF-8 크기, 스키마/메시지 여유, 512px 두 장의 입력 상한과 출력 상한을 사용한다.
  너무 큰 입력은 축약해 승인하지 않고 거부한다.
- 표시 비용: 비캐시 입력 $0.20/MTok, 캐시 입력 $0.02/MTok, 출력 $1.20/MTok 기반 추정.
- 예산 금액: 입력 전체에 $0.25/MTok를 적용하여 1.25배 cache-write 가격도 보수적으로 포함.
- 정상 응답은 실 토큰에 따라 예약을 정산한다. 날짜가 넘어도 **예약한 UTC 일자**에 정산.
- 비용이 확인된 malformed/refusal/incomplete/stale 응답도 비용을 기록한다.
- TIMEOUT/네트워크/HTTP 오류/사용량 누락은 예약을 유지하고 UNKNOWN으로 남긴다.
  자동 재시도로 비용을 중복 발생시키지 않는다.
- 5분 넘게 RUNNING인 작업은 다음 batch에서 UNKNOWN으로 정리하되 예약을 환불하지 않는다.
- 최근 5분 5회 이상 시도 중 실패/UNKNOWN 50% 이상이면 일시 중단. 인증 오류는 즉시 중단.
- 결제 명세가 아닌 운영 추정치다. 실제 청구서·모델 가격 변화와 대조해야 한다.
- 무료 Moderation의 `costMicros: 0`은 유지하며 유료 원장/캐시 비용과 혼합하지 않는다.

## 운영 설정

키를 새로 만들거나 로컬로 복사하지 않는다. 기존 Render `OPENAI_API_KEY`를 사용한다.
모델은 코드에 Luna로 고정되어 있다. 기존 `OPENAI_MODERATION_MODEL`을 Luna로 바꾸지 않는다.

안전한 기본값(설정 생략 시도 동일):

```dotenv
MODERATION_POLICY_JUDGE_MODE=OFF
MODERATION_POLICY_JUDGE_KILL_SWITCH=true
MODERATION_POLICY_JUDGE_RESPONSES_APPROVED=false
MODERATION_POLICY_JUDGE_CANARY_PERCENT=0
MODERATION_POLICY_JUDGE_AUDIT_PERCENT=5
MODERATION_POLICY_JUDGE_DAILY_CALL_CAP=0
MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP=0
MODERATION_POLICY_JUDGE_TIMEOUT_MS=15000
```

장기 Pilot 확대 예시(지금 적용할 값이 아님):

```dotenv
MODERATION_POLICY_JUDGE_MODE=SHADOW
MODERATION_POLICY_JUDGE_KILL_SWITCH=false
MODERATION_POLICY_JUDGE_RESPONSES_APPROVED=true
MODERATION_POLICY_JUDGE_CANARY_PERCENT=10
MODERATION_POLICY_JUDGE_DAILY_CALL_CAP=100
MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP=1000000
```

`1000000` microdollars = USD 1. 원화/센트 단위가 아니다.
승인 플래그는 확인된 증빙을 표현해야 하며, 키 재사용 동의를 증빙 승인으로 대신하지 않는다.
이 문서 작성 시 위 활성화 값은 운영에 적용하지 않았다.

2026-08-30 최초 검증은 이 예시보다 작은 **5회 / USD 0.05** 한도로 제한하며,
상시 OFF를 유지한 일회성 실행만 허용한다. Responses 범위의 v2 회원 동의가 필수다.
현재 상태와 실제 적용값은 [제한 검증 기록](luna-shadow-validation-2026-08-30.md)을 따른다.

API/worker 배포와 migration 적용 후 Render에서:

```sh
node apps/api/dist/moderation-worker.js diagnose-policy-judge
node apps/api/dist/moderation-worker.js policy-judge-summary
```

조건 충족 후 의도적으로 한 batch 실행:

```sh
node apps/api/dist/moderation-worker.js policy-judge-once
```

기존 `moderation-worker run/once`도 무료 검사 후 Luna batch를 처리한다.
Luna batch 내부 장애는 정제된 `POLICY_JUDGE_WORKER_FAILED` 상태로 기록하며 무료 worker를 중단시키지 않는다.
OFF 상태에는 Luna 테이블 조회나 유료 요청이 없으므로 migration 전 비활성 배포도 방해하지 않는다.
`policy-judge-summary`는 migration 후 사용한다. 항상 publicationChanged=false를 확인한다.
중단은 Luna kill switch=true 또는 mode=OFF로 변경 후 worker 재시작한다.
원장·이력은 삭제하지 않는다. 미확인 청구 예약은 공급자 명세 확인 없이 수동 환불하지 않는다.

## 다음 단계와 수용 조건

1. 동의/데이터 통제 기록 확인과 배포 후 소량 Shadow 실행, 사용량·비용 대조.
2. 실제 Golden Set(일반 사진·인물·텍스트/QR·혐오/위협 맥락·권리 위험·낮은 해상도)을
   정책별로 라벨링하고 Luna 누락률/오탐률/ABSTAIN/지연/사람 전환률 측정.
3. 정밀 검사로 분기된 샘플뿐 아니라 낮은 신호·분기되지 않은 샘플도 무작위 검증.
4. 무료 이미지 미지원 범주와 로컬 시각 근거를 보완하고 라우팅 기준 교정.
5. 그 후 별도 승인으로 작은 자동 승인 구간 개방. 예산 부족·불확실·장애는 대기 유지.

이번 자동화 테스트는 연결·계약·실패·동시성 검증이며 모델의 실제 판정 품질 평가가 아니다.
Luna가 ChatGPT와 동일한 검열/정책을 보장한다는 의미도 아니다.

## 로컬 검증 결과

- 새 단위·PostgreSQL 통합 테스트: 29개 통과.
- 최신 main/TikTok 병합 후 전체 API 회귀 테스트: 66개 파일 / 477개 테스트 통과
  (`vitest run --maxWorkers=2`).
- 웹 회귀 테스트: 52개 파일 / 292개 테스트 통과.
- API/웹 lint, TypeScript typecheck, build 통과. 웹의 기존 img lint 경고 8개는 유지.
- 빌드된 worker 진단: Luna / OFF / MODE_OFF / publicationChanged=false 확인.
- 첫 전체 병렬 실행은 로컬 PostgreSQL `out of shared memory` / 잠금 한도 문제로 실패했다.
  DB 설정을 변경하지 않고 worker 수를 2로 제한하여 전체 재검증했다.
- 테스트 전용 DB와 합성 이미지·가짜 공급자 응답만 사용했다. 실제 유료 API 호출 없음.
- 최초 로컬 검증 시점에는 운영 변경을 수행하지 않았다. 이후의 OFF 배포 결과는
  [운영 배포 기록](./luna-off-release-2026-08-30.md)에 구분하여 남겼다.

## 배포 전 운영 확인 (2026-08-30)

- 대상: Render `which-web`, `srv-da2vjmbncjis73d3g3kg`, GitHub main.
- 배포 전 release: `74993b20ae5803ef192fb8d3def6b8f59741a9f7`.
- DB 최신 migration timestamp `1788087589251`: 기존 TikTok 0053 적용 확인.
- 기존 키 존재 확인. 키 원문을 읽거나 로컬로 복사하지 않았다.
- 실제 무료 provider 진단: OFF, kill switch=true, canary=0, 일 호출/비용 한도=0.
- `privacyGateAllowed=false`, `missingEvidence` 11개. 사용자에게 전달받은 DPA 완료와
  운영 시스템의 증빙 등록 상태는 구분한다. 미등록을 계약 미체결로 단정하지 않는다.
- 이 상태에서는 Luna 유료 Shadow를 열지 않는다. 승인 증빙/Responses 사용 범위 확인 후
  별도 활성화하며, 이번 배포는 코드·추가 테이블·OFF 진단 범위다.

## 공식 근거

- [Luna 모델·요금·지원 기능](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [이미지 처리·토큰 계산](https://developers.openai.com/api/docs/guides/images-vision)
- [Moderation 지원 범주](https://developers.openai.com/api/docs/guides/moderation)
