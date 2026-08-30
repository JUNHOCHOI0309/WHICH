# WHICH-105 — 이미지 속 텍스트 안전 검사

작성일: 2026-08-30. 구현 범위: 기존 Shadow 요청에 로컬 OCR 문맥 결합. 자동 공개는 미활성화.

## 처리 흐름

1. 기존 privacy·canary·호출 한도 Gate를 통과한 worker가 불변 이미지 버전의 WebP를 읽고 SHA-256을 대조한다.
2. `ISSUE_MEDIA_LOCAL_SCANNER_MODE=LOCAL`일 때 제한된 자식 프로세스에서 로컬 한국어·영어 OCR을 수행한다.
3. 이메일·전화·주민번호·계좌형 개인정보 후보가 탐지되면 해당 OCR 전체 전달을 `WITHHELD_PII`로 막는다. URL은 치환하고 제어문자/공백을 정리한다.
4. 이미지당 최대 2,000자의 최소화된 텍스트를 메모리에서만 받아 질문·설명·A/B 선택지 및 두 이미지와 **기존 1회 Moderations 요청**에 함께 전달한다. A/B 순서를 보존한다. Asset-only는 해당 이미지의 OCR만 포함한다.
5. Run/캐시/Ops에 저장하는 것은 `embeddedText.version`과 이미지별 정규화 hash·추출 상태·전달 글자 수뿐이다. 추출문, raw response, 이미지 바이트는 복사하지 않는다.

텍스트·이미지 입력 계약 및 기존 `omni-moderation-2024-09-26` 모델을 사용한다. 추가 Provider 요청 또는 유료 생성 모델은 도입하지 않는다.
근거: [OpenAI Moderations API](https://developers.openai.com/api/reference/resources/moderations).

## 상태와 한계

- COMPLETE: 로컬 OCR 과정 완료 및 길이 제한 이내. **안전 판정, 완벽한 인식/개인정보 제거를 보증하지 않는다.**
- PARTIAL: 일부 언어 실패·낮은 신뢰도·길이 제한 등. 최소화 텍스트를 보조 검사에 활용하되 완전 검사로 인정하지 않는다.
- UNAVAILABLE: OFF/timeout/crash/busy/잘못된 출력/추출 오류. 텍스트 전달 없음.
- WITHHELD_PII: 개인정보 후보로 해당 OCR 문자열 전체 전달 보류. 텍스트 전달 없음.

개인정보 검출은 휴리스틱이며 이름·주소·오인식된 개인정보를 모두 제거한다고 보증하지 않는다.
이 조치는 **OCR 문자열 전달**에 관한 것이다. 기존 이미지 파생본을 추가 익명화했다는 뜻이 아니다.
이미지 전송은 기존 동의·권리·privacy Gate 및 미지원 시각 검사의 제약을 유지한다.
OCR 검사는 추출 텍스트에 대한 지원만 추가하며 텍스트 전용 모델 카테고리에 이미지 이해 능력을 부여하지 않는다.
응답은 질문과 A/B/OCR의 합산 결과다. 개별 이미지/문장만의 확정 판정으로 분리하지 않는다.

## 캐시·운영 안전

- 공통 입력 계약 `which-provider-input-v2`에 profile `which-embedded-text-v1:<local-scanner-version>:OFF|LOCAL`을 더해 cache hash를 구분한다. 구 이미지 전용/OFF 캐시를 LOCAL에서 사용하지 않는다.
- LOCAL에서는 이미지별 COMPLETE 근거가 없는 결과를 저장하거나 재사용하지 않는다. 동일 입력의 유효 COMPLETE 캐시는 재사용한다.
- 기존 호출 감사/한도 처리와 수정·취소·격리·lease 상실 방어를 유지한다. 원문을 결과에 포함하지 않고 메타데이터만 명시적으로 투영한다.
- 일반 업로드 scanner 반환 계약에는 OCR text가 없다. 별도 `moderation-text` IPC 모드에만 최소화 텍스트가 존재한다.
- 자식 프로세스에 API/DB/R2 키를 넘기지 않고 stderr를 버린다. 응답 제한은 일반 검사 8 KiB, text IPC 16 KiB이다.
- LOCAL에서 worker lease는 `2 × OCR timeout + Provider timeout + 5초` 이상이어야 하며 부족하면 시작을 거절한다. 기본 lease 60초 / OCR 15초 / Provider 10초는 충족한다.

새 환경변수는 없다. 기존 로컬 스캐너 기본 OFF와 Provider/공개 Gate를 유지했다.
Render CPU/RSS 검증 없이 LOCAL로 켜지 않는다. 업로드 검사와 Provider 입력 준비 시 재검사로 자원을 추가 사용한다.
`diagnose-publication <submission-id>`는 이미지별 OCR 보류 사유를 반환하며 원문/텍스트를 반환하지 않는다.

## 검증 및 후속

실제 픽셀 문장 추출·이메일 전달 보류, 개인정보/잘림 최소화, 오류 IPC, A/B 결합·raw text 미저장,
캐시 재사용/미완료 미캐시, 공개 준비 hash/상태 확인을 자동 테스트한다. API/R2는 mock이며 운영 이미지 E2E가 아니다.

미지원 시각 분류, 검증된 저위험 판정 근거, 가역 공개 실행/회수·TTL·알림·감사 연결,
실제 호스트 검증 및 WHICH-111 승인은 남아 있다. WHICH-105는 Doing으로 유지한다.
