# Member media upload gate

> The post-normalization rule, signal, and routing layer is documented in [issue-media-rule-signal-gate.md](./issue-media-rule-signal-gate.md).

Tasks: WHICH-98, WHICH-120

일반 Member 이미지 업로드는 기본적으로 비활성화되어 있습니다. 기존 운영자 검수 R2 기반이 있어도 로그인만으로 사용자 업로드를 허용하지 않습니다.

## 서버 게이트

모든 조건을 서버에서 통과해야 10분짜리 일회성 업로드 세션을 만들 수 있습니다.

1. `ISSUE_MEMBER_MEDIA_UPLOAD_MODE=PILOT`
2. 만료되지 않은 `ISSUE_IMAGE_UPLOAD` capability grant
3. `ISSUE_MEDIA_CONSENT_VERSION`과 일치하는 철회되지 않은 동의
4. 본인 소유의 `PENDING` 또는 `NEEDS_CHANGES` 제출
5. 최근 24시간 Member 세션 3개 미만, IP 세션 12개 미만
6. 동시에 열린 업로드 세션 1개 미만
7. 삭제되지 않은 Member 검수 자산 10개 미만

세션은 서버가 UUID, object key와 256-bit token을 생성합니다. DB에는 token 원문이 아닌 SHA-256만 저장하며 Member ID와 IP는 HMAC pseudonym bucket으로 별도 기록합니다. 세션은 한 번 소비되면 재사용할 수 없습니다.

## 동의 계약

- 신규 이메일·소셜 가입자는 회원가입의 필수 이용약관 동의와 함께 현재 이미지 권리·자동 안전
  검사 동의 버전이 기록됩니다.
- 현재 버전 이전에 가입한 Member는 Pilot이 활성화된 작성 화면에서 한 번만 약관을 확인하고
  동의합니다.
- 동의하지 않은 기존 계정을 일괄 동의 처리하거나 이미지마다 같은 체크박스를 반복하지 않습니다.
- 동의 버전이 바뀌거나 철회되면 새 직접 업로드 세션은 즉시 거절됩니다.

권한 조회와 기존 회원의 1회 동의 API는 각각
`GET /v1/member/issue-media-upload-access`, `POST /v1/member/issue-media-consent`입니다.

## Pilot 운영 제어

`/ops`의 `Upload Pilot` 탭은 계정 나이, 정상 투표, 공개된 LOW-risk 질문, 최근 90일 위반,
이메일 검증과 동의 버전을 함께 보여줍니다. 운영자는 10자 이상의 근거를 남겨 30일 grant를
부여·정지·회수·복원할 수 있으며 모든 변경은 `member_capability_events`에 기록됩니다.

웹과 Mobile 작성기는 서버의 access 응답이 `allowed=true`인 경우에만 직접 업로드 입력을
노출합니다. 화면을 우회해도 세션 생성 단계에서 동일한 mode·capability·consent·quota를 다시
검증합니다.

## Rule pipeline

- 텍스트: NFC, 줄바꿈·공백 정규화 후 길이, URL, 반복 문자·토큰, 혼합 Script, 이메일·전화·계좌형 패턴을 공통 Reason Signal로 만듭니다.
- 이미지: 기존 MIME/signature, byte/pixel, decode, 방향 보정, EXIF 제거, WebP, SHA-256와 dHash 처리를 재사용합니다.
- 정확히 확인된 known-block SHA-256만 `AUTO_REJECT_PRIVATE`입니다.
- dHash 유사도, QR/barcode, OCR 개인정보, 얼굴·문서·스크린샷과 일부 검사 실패는 `REVIEW_REQUIRED`입니다.
- 검사 완료와 모든 규칙 통과만 `REVIEW_READY`이며 Pilot 중 자동 공개를 뜻하지 않습니다.

현재 WHICH-120은 capability와 실제 업로드·제출 Vertical Slice를 제공하지만 자동 공개를 켜지
않습니다. 낮은 위험 이미지의 자동 공개는 WHICH-111의 Provider Privacy Gate, Shadow 평가,
Category Kill Switch와 Release Gate가 승인된 뒤 별도로 활성화합니다. 그 전에는 안전 검사를
통과한 이미지도 비공개 검수 상태에 머뭅니다.

## 운영 전환

기본값 `OFF`를 유지합니다. 제한 Pilot을 시작할 때만 API 환경의
`ISSUE_MEMBER_MEDIA_UPLOAD_MODE=PILOT`을 배포하고, API와 Web BFF의
`ISSUE_MEDIA_CONSENT_VERSION`이 같은지 확인합니다. 먼저 기존 회원의 1회 동의와 운영자 grant를
확인하고, staging CORS·bucket listing 차단·`nosniff`·원본 TTL과 worker CPU/memory/wall-clock
제한을 인프라에서 함께 검증해야 합니다. 일부 검사나 Provider가 실패하면 자산은 비공개 검수
상태로 남아야 합니다.
