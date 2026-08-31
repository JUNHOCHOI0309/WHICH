# Cloud Run 이미지 검사 제한 검증 — 2026-09-01

## 범위

- 기존 OpenAI 키 재사용: 기본 `omni-moderation-2024-09-26`, 정밀 `gpt-5.6-luna`.
- 운영자 테스트 계정의 기존 비공개 이미지 질문 2건만 대상. 계정 UUID·이메일은 이 문서에 복제하지 않는다.
- 현재 동의 버전과 업로드 권한을 조회했으며 신규 동의나 권한을 만들지 않았다.
- 일회 실행에만 cohort, LOCAL 검사, SHADOW 모드를 적용했다. 공유 Secret Manager 설정은 변경하지 않았다.
- 기본 검사 일일 상한 5회, Luna 5회 및 50,000 microdollars($0.05). 자동 공개·제재 실행·상시 스케줄은 OFF.

## 실제 관찰

1. 기존 Job은 생성만 되어 있었고 실행 이력이 없었다. 운영 이미지와 동일한 digest로 Job을 정렬했다.
2. R2 비공개 이미지 읽기와 로컬 OCR/QR 단계 이후 기본 API가 HTTP 400으로 실패했다.
3. 첫 배치 `which-moderation-jmtx8`: 2건 모두 DEAD_LETTERED. Cloud Run 실행 자체의 성공과 업무 성공은 다르다.
4. 동일 실패 run 하나만 정상 requeue 경로로 진단했다. 예산·전체 시도 이력은 초기화하지 않았다.
5. `which-moderation-sh57g`와 `which-moderation-8trlc`에서 각각 추가 기본 요청 1회. 최종 확인 코드는 `too_many_images`, type은 `invalid_request_error`, parameter는 `input`이었다.
6. 여기까지 기본 요청 4회 모두 실패, Luna 요청 0회, 자동 공개 0건이다. 질문은 비공개로 유지된다.
7. 별도로 정상 CLI requeue가 기본 DB 연결 제한 2초에서 반복 실패했고, 동일 경로의 연결 제한만 10초로 늘린 실행은 성공했다. 이를 냉간 외부 DB 연결의 취약점으로 보완한다. DB·리전·TLS 인증 검증은 변경하지 않는다.

키, 원본 이미지, OCR 원문, 질문 본문, 제공자 오류 본문은 로그에 남기지 않았다. HTTP 상태·기술 코드·정해진 진단 키워드만 확인했다.

## 코드 보완

- A/B 두 이미지를 한 moderation 요청에 넣던 구현을 각 이미지별 요청으로 변경한다. 질문·선택지·최소화된 OCR 문맥은 각 요청에 함께 전달한다.
- 두 응답 모두 유효한 고정 모델 결과여야 합산한다. 각 항목의 flag는 OR, 점수는 최댓값, 적용 모달리티는 합집합이다. B 실패·잘못된 응답·모델 변경·항목 불일치 시 부분 A 결과를 성공이나 캐시로 저장하지 않는다.
- 결과에 `requestStrategy=PER_IMAGE_V1`, `requestCount=2`를 기록하고 캐시 profile을 분리한다. 오래된 단일 요청 결과를 재사용하지 않는다.
- 배치 시작 전 두 요청을 감당할 일일 잔여량을 확인하고 각 HTTP 요청 직전에도 gate를 재확인한다. 시도·성공·실패 감사 기록은 실제 요청 단위로 기록한다.
- 워커의 DB 연결 한도만 10초로 늘린다. 웹 기본 2초와 pool 크기, 인증된 TLS는 유지한다.
- 워커 lease 검증에 두 번째 API 요청 시간도 포함한다.

API의 일반 입력 형식은 [OpenAI Moderations API reference](https://developers.openai.com/api/reference/resources/moderations/methods/create)를 참고했다. 이 운영 입력의 다중 이미지 제한은 실제 `too_many_images` 응답으로 확인했으며 문서 예제만으로 통과를 가정하지 않는다.

## 완료 판단과 후속 검증

코드 테스트·배포와 실제 AI 검사 성공은 구분한다. 현재 원래 한도 5회 중 4회를 사용했으므로 두 장 재검증에는 최소 2회가 필요하다. 상한을 임의로 초기화하거나 올리지 않는다.

수정 후 운영 검증 순서:

1. PR 필수 CI → main Cloud Build → 웹 정상 revision 확인 → Job 이미지와 release를 동일 digest로 정렬.
2. 키·원문을 출력하지 않는 읽기 전용 CLI 점검으로 냉간 DB 연결 확인.
3. 승인된 추가 기본 호출 한도 또는 다음 UTC 일자의 한도 내에서 정확한 실패 run만 requeue. 재제출·삭제·동의 철회 여부는 실행 시 다시 확인.
4. 기본 A/B 각 1회 성공, 실패 코드 없음, 결과 바인딩 및 OCR COMPLETE 2건을 확인한 후 Luna SHADOW 결과와 사용량을 확인.
5. 자동 공개는 계속 OFF. 실제 검사 근거를 검토한 뒤 별도 단계에서 테스트 계정 자동 공개 및 알림을 검증하고, 그 이후에만 스케줄 도입을 판단.

이 문서는 테스트 착수와 발견된 문제의 기록이며, 아직 기본 검사/Luna/자동 공개의 운영 통과 증빙이 아니다.
