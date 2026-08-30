# 이미지 최적화·Luna OFF 배포 기록

작성일: 2026-08-30 (KST)

상태: 운영 OFF 배포·DB 적용·공개 경로 검증 완료. 유료 Shadow 활성화는 승인 범위 확인 전 보류.

## 범위와 변경

- [PR #3](https://github.com/JUNHOCHOI0309/WHICH/pull/3)
- 기존 TikTok 로그인/개인정보 변경 보존.
- 신규 이미지: 긴 변 최대 1280px WebP, 기존 R2 파일 재압축 없음.
- 웹 이미지 표시: 모바일 4:5 / PC 16:9, 비율 유지, 전체 보기.
- Luna: 512px A/B 통합 검사·캐시·영속 호출/비용 원장. OFF 기본값 유지.
- migration: `0054_luna_policy_judge.sql`. 새 원장 테이블 2개 및 제약·인덱스만 추가.
- 기존 무료 Moderation, 권리/검수 이력, 회원 권한, 자동 게시 설정을 변경하지 않는다.

## 배포 전 확인

- 대상: Render `which-web` / `srv-da2vjmbncjis73d3g3kg` / GitHub `main`.
- 이전 release: `74993b20ae5803ef192fb8d3def6b8f59741a9f7`.
- 운영 DB: 최신 migration timestamp `1788087589251` (TikTok 0053).
- Render의 기존 `OPENAI_API_KEY` 사용. 원문 열람·복사·회전 없음.
- OpenAI `GET /v1/models/gpt-5.6-luna`: HTTP 200. 모델 조회 성공만 의미한다.
  Responses 생성 권한·결제 가능 여부·실제 이미지 판정 품질은 아직 실측하지 않았다.
- 모델 조회에 사용자 이미지/질문을 전송하지 않았으며 유료 추론 요청은 실행하지 않았다.
- 기존 provider: OFF, kill switch=true, canary=0, 한도=0, 개인정보 증빙 11개 미등록.
- Luna 전용 환경변수는 없음. 코드 기본값 OFF/kill switch=true/한도=0 적용 대상.
- 외부 공개 경로 사전 smoke: 2026-08-30 21:46 KST, 15개 PASS / GO.

## 검증

- 최신 main 병합 후 로컬 API: 477개 PASS; 웹: 292개 PASS.
- API/웹 lint·typecheck·build, 전체 Prettier 통과. 기존 웹 img 경고 8개 유지.
- 최초 Linux CI: 이미지 압축 비교 테스트 1개가 Vitest 기본 5초를 초과.
  샘플 생성·신구 인코딩·PSNR 계산을 포함하는 해당 테스트만 30초로 조정.
  서비스의 10초 처리 제한, 파일 크기·화질 단언, 시간 제한 회귀 테스트는 유지.
- 수정 후 로컬 이미지 테스트 10개 PASS.
- [PR Linux CI](https://github.com/JUNHOCHOI0309/WHICH/actions/runs/33312365485): PASS.
  API 477개, 웹 292개, 모바일 39개 및 lint/typecheck/build 모두 통과.
- 2026-08-30 21:50 KST merge: `4aa774ed1355b63d448e02aebc18dded9d9d95f5`.
- [main CI](https://github.com/JUNHOCHOI0309/WHICH/actions/runs/33312573072): PASS.
  808개 테스트 및 12개 검증 작업 성공.

## 활성화 조건 / 롤백

- 사용자가 알려준 DPA 완료와 운영 시스템 증빙 등록은 구분한다.
  미등록만으로 계약 미체결이라고 단정하지 않는다.
- 개인정보 증빙 등록과 Responses 사용 범위 검토·승인 전 유료 Shadow를 열지 않는다.
- 기존 Moderation 범위의 승인 대장과 Responses 승인을 혼용하지 않는다.
  `store:false`는 Responses 응답 저장 제어이며, 기본 악용 방지 로그의 최대 30일 보관
  (법령·서비스/제3자 보호상 더 긴 보관 예외), 최대 24시간 prompt cache 상태,
  이미지 안전 수동 검토 예외까지 없애는 보장이 아니다.
- 실제 유료 검사·자동 공개는 이번 OFF 배포 수용 조건이 아니다.
- 장애 시 이전 앱 release로 되돌릴 수 있다. 추가 원장 테이블은 삭제하지 않는다.
  새로 생성된 1280px 파일을 이전 앱으로 배포해도 1600px로 복원되지는 않는다.

## 운영 배포 결과

- Render deploy: `dep-daa2ga7lk1mc738g2ib0`.
- 배포 release: `4aa774ed1355b63d448e02aebc18dded9d9d95f5`.
- 21:55 KST 자동 배포 시작 → 21:56 빌드 성공 → 21:57:14 migration 성공
  → 21:58:35 Live.
- 운영 DB 읽기 전용 확인: 최신 migration `1788093404634` (0054),
  `policy_judge_budgets`와 `policy_judge_evaluations` 존재.
- 교체된 운영 인스턴스에서 `policy-judge-once` 실행: `MODE_OFF`, `processed=[]`.
- 이어서 `policy-judge-summary`: 모델 `gpt-5.6-luna`, mode=OFF, allowed=false,
  apiKeyConfigured=true, calls=0, committedMicros=0, totals=[], publicationChanged=false.
- 배포 후 public smoke: 2026-08-30 21:58:59 KST, 15개 PASS / GO.
- 새/기존 환경변수, 키, 회원 권한, 실제 사용자 이미지·질문은 변경하지 않았다.
- 외부 모델 조회 1회 외에 유료 추론·사용자 콘텐츠 전송은 없었다.
- 실제 사용자 이미지 업로드/R2 저장 E2E·실제 Luna 판정 품질은 이번 OFF 검증에 포함하지 않았다.

운영 절차: [Luna Shadow 도입 문서](./issue-media-luna-policy-judge.md).
모델 조회 근거: [OpenAI Retrieve model](https://developers.openai.com/api/reference/resources/models/methods/retrieve).
보존 조건 근거: [OpenAI Data controls](https://developers.openai.com/api/docs/guides/your-data).
