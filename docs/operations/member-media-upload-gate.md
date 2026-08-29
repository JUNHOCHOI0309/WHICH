# Member media upload gate

> The post-normalization rule, signal, and routing layer is documented in [issue-media-rule-signal-gate.md](./issue-media-rule-signal-gate.md).

Task: WHICH-98

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

## Rule pipeline

- 텍스트: NFC, 줄바꿈·공백 정규화 후 길이, URL, 반복 문자·토큰, 혼합 Script, 이메일·전화·계좌형 패턴을 공통 Reason Signal로 만듭니다.
- 이미지: 기존 MIME/signature, byte/pixel, decode, 방향 보정, EXIF 제거, WebP, SHA-256와 dHash 처리를 재사용합니다.
- 정확히 확인된 known-block SHA-256만 `AUTO_REJECT_PRIVATE`입니다.
- dHash 유사도, QR/barcode, OCR 개인정보, 얼굴·문서·스크린샷과 일부 검사 실패는 `REVIEW_REQUIRED`입니다.
- 검사 완료와 모든 규칙 통과만 `REVIEW_READY`이며 Pilot 중 자동 공개를 뜻하지 않습니다.

## 운영 전환

기본값 `OFF`를 유지합니다. Pilot 시작 전 capability·consent를 운영 승인으로 생성하고, staging CORS·bucket listing 차단·`nosniff`·원본 TTL과 worker CPU/memory/wall-clock 제한을 인프라에서 함께 검증해야 합니다. 일부 검사나 Provider가 실패하면 자산은 비공개 검수 상태로 남아야 합니다.
