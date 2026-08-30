# Luna 제한 Shadow 검증 · 2026-08-30

## 승인 범위

- 기존 Render 키를 그대로 사용한다. 키를 로컬이나 문서에 복사하지 않는다.
- 기존 무료 `/v1/moderations` 증빙과 유료 `/v1/responses` 승인을 구분한다.
- Owner는 Responses의 `store:false`와 별개인 기본 최대 30일 악용 방지 로그,
  법적·서비스/제3자 보호 예외, 최대 24시간 암호화 캐시, 의심 이미지 수동 안전 검토
  예외를 안내받고 제한된 Shadow 검증을 승인했다. Global, ZDR/MAM 미활성화 조건이다.
- 계약 원문·개인 연락처·제한된 증빙 대장 URL은 공개 저장소에 복제하지 않는다.
- 내부 Owner 검토이지 독립 법률자문 또는 자동 공개·제재 승인이 아니다.

## 개인정보·동의

- 공개 `/legal/privacy`에 두 API의 목적·입력·지역·보존·거부/권리 경로를 구분한다.
  기존 TikTok 등 소셜 로그인 고지는 유지한다.
- 동의 버전은 `which-media-consent-v2`. 신규 가입 동의에 현재 안내가 포함되고,
  기존 회원은 직접 업로드 전 한 번 확인한다. 게시물마다 추가 동의를 받지 않는다.
- 기존 v1 동의 행을 v2로 바꾸거나 대신 동의하지 않는다. Luna는 v2 미철회 동의를
  직접 요구하므로 오래된 환경변수나 v1 동의만으로 외부 전송하지 않는다.
- 회원의 업로드 권한·현재 revision·무료 검사·로컬 OCR·개인정보 검사 조건은 유지한다.

## 검증 한도와 중단

- 유료 Luna: 하루 최대 **5회**, 보수적 예약 포함 **USD 0.05**(50,000 microdollars).
- 무료 Moderation: 하루 최대 5회. 정해진 소량 검증만 실행한다.
- 상시 worker는 새로 시작하지 않는다. 운영의 지속 설정은 `OFF`와 kill switch `true`로
  유지하고, 승인된 일회성 검증 프로세스 안에서만 SHADOW 값을 적용한다.
- 하나의 batch만 실행한 후 기본 OFF 진단을 재확인한다. 오류/불명 비용은 예약을 유지하며
  임의 재시도·예산 초기화·cap 상향을 하지 않는다.
- 대상이 없으면 `processed: []`를 사실대로 기록한다. 이는 모델 추론 성공이 아니다.
  동의·권한을 임의 생성하거나 일반 사용자 데이터를 테스트 자료로 복제하지 않는다.
- 결과는 Shadow 이력만 저장한다. 게시·차단·제재·회원 알림·R2 공개 상태를 바꾸지 않는다.

## 운영 사전 점검

2026-08-30 운영 DB 읽기 전용 집계: 대기 이미지 A/B 질문 0건, 성공한 무료 안전 검사
0건, 미철회 이미지 동의 0건, 유효한 이미지 업로드 Pilot 권한 0건.
따라서 실제 이미지 추론 검증에는 승인된 테스트 계정의 직접 동의·이미지 질문이 필요하다.

진단 명령:

```sh
node apps/api/dist/moderation-worker.js diagnose-provider
node apps/api/dist/moderation-worker.js diagnose-policy-judge
node apps/api/dist/moderation-worker.js policy-judge-summary
```

외부 호출 전에 제한된 증빙 대장의 정확한 11개 승인 key, Responses 승인,
current v2 동의와 테스트 범위를 확인한다. API 키 존재나 모델 조회 HTTP 200만으로
실제 추론 성공·검수 품질·게시 허용을 판단하지 않는다.

## 확인할 결과

- 고지 배포와 v1 동의 차단 회귀 테스트
- 진단의 `requiredConsentVersion`, cap, Responses 승인·privacy gate
- 처리 건수, 유효 JSON 여부, 토큰 수·추정 비용/보수적 예약, 정제 오류 코드
- `publicationChanged: false`, 검증 프로세스 종료 후 기본 OFF
- 실제 호출을 하지 못했다면 사유와 필요한 사용자 작업을 별도로 남긴다.

공식 근거: [OpenAI 데이터 관리](https://developers.openai.com/api/docs/guides/your-data).
