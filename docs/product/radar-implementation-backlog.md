# WHICH Radar × 선택 경험 구현 백로그

작성: 2026-09-19

[Notion 실행 계획](https://app.notion.com/p/3e028b27a55981c698e6d4d235586b85) — 실행 상태의 기준. R 번호는 이 확장의 순서이며 Notion의 자동 Task ID와 별개다.

## 제품 결정

트렌드와 놀이형 선택은 각각 독립적으로 유용해야 한다. 주제/사건을 통해 양방향 연결한다. 트렌드 갱신은 질문 검수를 기다리지 않는다. 모든 트렌드에 질문을 만들지 않는다.

첨부 v2 제품 방향과 v1 출처 무결성 설계를 채택. TTI 표본의 가중식은 가설이며 공식 산식/원천 지수로 사용하지 않는다. Google RSS는 연결 확인; Naver/YouTube 인증 및 권한은 R02에서 확인한다.

## 출시 단계

- R1 Connected Radar: R01–R21. 공개 트렌드와 실제 질문 참여 연결.
- R2 검증된 지수·자동 편집: R22–R26. 운영 자동 공개 승인은 별도.
- R3 Reasons & Learning: R27–R30.
- R4 확장 검토: R31–R32.

## 공통 완료 기준

2026-09-19 사용자 지시로 로컬 우선 개발로 변경했다. 단위/통합/회귀 검증 및 필요한 localhost 확인을 마친 개발 Task는 **로컬 완료 / 운영 미반영**으로 기록한다. 작업마다 PR 병합·main push·운영 배포를 하지 않는다. R21/R26처럼 운영 검증이 본래 목적인 Task는 별도 배포 확인 전 완료로 처리하지 않는다.

배포를 요청받으면 누적 변경을 묶어 요청 범위만 PR → 필수 CI → 정상 main 배포 → 운영 확인을 진행한다. 새 유료 자원·서비스 약관 수락·자동 발행 활성화는 별도 확인한다. 비용/납기는 실측 전 확정하지 않는다. 실행 방법은 [로컬 개발 환경](../development/radar-local-workflow.md)을 참고한다.

## 작업

### R01. Radar 도메인·관측 데이터 계약과 정규화 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a5598110b6aef224be3dfc5f?pvs=204)
- 단계/우선순위: R1 Connected Radar / P0
- 선행: 없음
- 구현 영역: apps/api/src/modules/radar
- 완료 기준:
  - Topic·Event·Evidence·IssueVersion 연결 경계 문서화
  - 출처·시간·관측창·null/0·멱등키 런타임 검증과 단위 테스트
- 검증: 순수 함수 단위 테스트, 기존 poll 테스트 회귀

### R02. 소스별 이용 권한·보존 정책과 호출 예산 등록

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981ef9d22c4f492adfde4?pvs=204)
- 단계/우선순위: R1 Connected Radar / P0
- 선행: R01
- 구현 영역: source registry / 운영 문서
- 완료 기준:
  - Google/Naver/YouTube 수집·재표시·파생·보존 권한을 근거 URL/확인일과 기록
  - 알파 미승인·권한 미확인 소스는 비활성; 실행/일별 요청 상한 정의
- 검증: 권한 unknown/expired와 예산 소진 시 fail-closed 테스트
- 로컬 산출물: [소스 권한·보존·호출 예산 등록부](../development/radar-source-register.md). 운영 수집 비활성, 실제 계정 권한은 미확인 상태로 유지한다.

### R03. Topic·Event·Evidence·Observation 저장소와 마이그레이션

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981078bf2f9c661808173?pvs=204)
- 단계/우선순위: R1 Connected Radar / P0
- 선행: R01
- 구현 영역: apps/api/src/database
- 완료 기준:
  - 유일키·시간 인덱스·출처 FK·관측창 보존
  - 재실행 무중복; 기존 Issue/Vote 테이블 데이터 불변
- 검증: 신규 DB 및 업그레이드 migration, transaction integration 테스트
- 로컬 산출물: [Radar PostgreSQL 저장소](../development/radar-storage.md). 기존 질문·투표 데이터를 변경하지 않는 추가 migration이며 운영 미반영이다.

### R04. 수집 실행 원장·중복 방지·재시도 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981d496b2cf0421cefebc?pvs=204)
- 단계/우선순위: R1 Connected Radar / P0
- 선행: R02, R03
- 구현 영역: radar ingestion service
- 완료 기준:
  - 성공/정상빈결과/부분결과/실패를 구분하고 pagination 누락 기록
  - lease·timeout·backoff·동시 실행 잠금; 재수집 중복 방지
- 검증: 중복 dispatch, 중간 실패, lease 만료, 429/5xx 테스트
- 로컬 산출물: [수집 실행 원장·재시도](../development/radar-ingestion-ledger.md). 원자적 호출 예산 예약과 lease fencing까지 구현했으며 실제 provider/스케줄러는 비활성, 운영 미반영이다.

### R05. Google Trending RSS 수집 어댑터 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981dba862d17d9522c512?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R04
- 구현 영역: radar/providers/google
- 완료 기준:
  - KR feed 제한 시간·크기·항목수·XML 안전 파싱
  - 원문 시각·수집 시각·검색량 구간 의미 보존; 빈결과와 파싱 실패 구분
- 검증: 고정 XML fixture, 악성 XML/redirect/큰응답 테스트와 공개 피드 smoke
- 로컬 산출물: [Google Trending RSS 어댑터](../development/radar-google-trending-rss.md). KR 고정 URL, timeout/stream 크기/항목/중첩/redirect/entity 경계와 R04 원장 연결을 구현하며 자동 수집은 비활성, 운영 미반영이다.

### R06. Naver 검색·DataLab 어댑터 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a559811f8484d76d2bcb275b?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R04
- 구현 영역: radar/providers/naver
- 완료 기준:
  - 발견 키워드 관련 뉴스와 일간 상대 검색 추이를 분리 저장
  - 최대값100의 비교 범위·검색어 묶음 보존; 인증정보 서버 전용
- 검증: mock 인증/쿼터/빈응답/상대비율 테스트; 승인된 설정으로 smoke

### R07. YouTube 공식 API 영상 신호 어댑터 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981d18305f9a348fa8b2b?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R04
- 구현 영역: radar/providers/youtube
- 완료 기준:
  - 관련 영상 검색/통계와 차트 범위를 명확히 구분
  - 기존 YouTube.js 커뮤니티 투표 수집과 독립; 파생/장기보존 권한 적용
- 검증: 정책 미승인·삭제영상·quota·중복video 테스트; 키 설정 후 smoke

### R08. 주제 정규화·동명이인·사건 연결 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981488500ff8ddb6ac4e8?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R05
- 구현 영역: radar/entity-resolution
- 완료 기준:
  - 별칭/언어/시간/출처를 이용해 Topic과 Event 분리
  - 불확실한 동명이인은 강제병합 금지; merge/split 이력 보존
- 검증: 동음이의어·같은주제 다른날 사건·잘못된 병합 복구 fixture

### R09. 수집 스케줄·worker 격리·비용 제한 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a559818d9d33e51377c54eb1?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R04, R05
- 구현 영역: radar worker / cloud-run
- 완료 기준:
  - 소스별 주기와 daily poll job 분리, moderation 자원 격리
  - 기능 기본 off·kill switch·예산 상한; 추가 유료 리소스 활성화 별도 승인
- 검증: 중복예약·호출한도·worker 장애 시 기존 투표/검수 회귀

### R10. 출처별 추이·최신성·자료 부족 표시 계산

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a559810ea9ebe4f010beb9a1?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R06, R07, R08
- 구현 영역: radar projections
- 완료 기준:
  - null과0, 지연과관심하락을 구분; 비교 가능한 관측창만 계산
  - 외부 관심도와 내부 참여율 분리; 미검증 종합점수 금지
- 검증: zero/missing/stale/window 불일치와 최소 표본 테스트

### R11. 공개 트렌드 목록·상세 읽기 API 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981ebad8ac9805294ff08?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R08, R10
- 구현 영역: apps/api radar routes / web bridge
- 완료 기준:
  - pagination·category/source filter·출처시각·stale 상태 제공
  - 숨김 데이터·내부키 제외, 캐시·요청제한·서버단 조회
- 검증: API schema/권한/캐시/페이지 경계/숨김 통합 테스트

### R12. 트렌드 탭·PC/모바일 목록 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981d6ba0bd7d546430918?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R11
- 구현 영역: apps/web trends
- 완료 기준:
  - 기존 선택 피드를 유지하며 독립 트렌드 진입점 추가
  - loading/empty/error/stale·출처·기준 시각과 키보드 접근 제공
- 검증: 375/390/768/1440px 반응형·접근성·목록 테스트

### R13. 트렌드 상세·출처·관측 이력 화면 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981578bcbce71fe84a204?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R12
- 구현 영역: apps/web trend detail
- 완료 기준:
  - 사건 설명·출처 링크·소스별 추이를 표시
  - 질문 0개여도 유용; 수집 실패/자료 부족을 가짜0으로 표시하지 않음
- 검증: 질문 유무·혼합 갱신주기·위험 URL·모바일 화면 테스트

### R14. /ops Radar 수집 상태·출처·노출 관리 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a559818bbb65f86b80e63306?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R08, R11
- 구현 영역: ops Radar panel
- 완료 기준:
  - 관리자만 수집 상태 조회·merge/split·노출중단/복구 가능
  - 조작 감사로그·동시수정 충돌·숨김 캐시 무효화
- 검증: 비관리자 차단·작업 중복·공개 화면 숨김 반영 테스트

### R15. Trend–IssueVersion 다대다 연결·양방향 카드 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981e28489c162705c26ba?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R13, R14
- 구현 영역: radar links / issue detail
- 완료 기준:
  - 기존 질문 재사용·0개/여러개 연결 및 연결 해제
  - 질문 버전·노출상태 존중; 투표 결과/기록 재작성 금지
- 검증: 숨김/수정 질문·버전전환·미연결 기존 놀이질문 회귀

### R16. Editorial 출처 타입 확장·Review Center 전달

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981de842bd8ef11fe8d58?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R03, R14
- 구현 영역: operations / issue-publication
- 완료 기준:
  - PollSource와 TrendSource 판별 가능한 계약 도입
  - 기존 YouTube URL 검증 유지, idempotent candidate 전송 및 근거 보존
- 검증: 기존 poll 경로 회귀·출처위조/중복전송 차단 integration

### R17. 근거 기반 질문 초안·안전 검수 보조 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981109772c8d33b5aaece?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R16
- 구현 영역: editorial drafting
- 완료 기준:
  - 선정 사건의 근거만 사용해2~4선택지 초안 생성
  - 근거부족/위험주제 보류·사람 승인 유지·모델출력 검증·비용 상한
- 검증: 환각·인용누락·지시문 삽입·민감주제·중복 질문 평가셋

### R18. 트렌드 노출→질문→투표 전환 계측 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981fb94f2e43bc7eace05?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R15
- 구현 영역: analytics
- 완료 기준:
  - event/topic/issueVersion/exposure lineage를 식별
  - 유기적 외부 관심과 내부 추천 노출 분리, 개인정보 최소수집
- 검증: 재시도 중복·직접유입·내부추천·버전별 attribution 테스트

### R19. 보존기한·출처 철회·삭제 전파 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981e9b689ec6023f1f1ca?pvs=204)
- 단계/우선순위: R1 Connected Radar / P0
- 선행: R03, R11, R16
- 구현 영역: retention / radar
- 완료 기준:
  - 소스별 만료/갱신과 원문삭제 반영
  - 본문·공개 projection·캐시·파생초안의 사용중단 전파; 감사 이력 유지
- 검증: 만료·철회·재처리 후 부활금지 integration

### R20. 장애·부하·보안·기존 서비스 회귀 검증

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a5598198ad1be0aa37d05c34?pvs=204)
- 단계/우선순위: R1 Connected Radar / P0
- 선행: R09, R17, R18, R19
- 구현 영역: tests / runbook
- 완료 기준:
  - source outage/429/malformed 입력·SSRF·XSS·prompt injection 검증
  - 트렌드 부하 중 투표와 이미지 검수 기준선 대비 성능 검증
- 검증: 부하 시나리오와 p95 기준선 기록, 회귀 suite

### R21. Connected Radar 단계 배포·공개 검증

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a5598157b5e1d380b7dde420?pvs=204)
- 단계/우선순위: R1 Connected Radar / P1
- 선행: R20
- 구현 영역: release / runbook
- 완료 기준:
  - 실제 복수 소스 데이터→트렌드→검수된 질문→실제 참여 흐름 확인
  - PR·CI·정상 Cloud Build 배포, flags·관측·rollback 절차 검증
- 검증: 운영 smoke, source timestamps, 모바일, rollback drill

### R22. 관심도 기준선·소스 비교·종합지수 검증

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981e6aaa4c4de99e68173?pvs=204)
- 단계/우선순위: R2 Autonomous Editorial / P2
- 선행: R21
- 구현 영역: attention engine
- 완료 기준:
  - 충분한 누적 관측과 이용권한 확보 후 baseline·cohort·scoreVersion 정의
  - 결측/수축·지수해석 공개; TTI 추정식을 공식값으로 사용금지
- 검증: 백테스트·단일소스/편향/결측 민감도 검증

### R23. AI 증분 작업·근거 갱신·예산 조율 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981629219e998d2c7f678?pvs=204)
- 단계/우선순위: R2 Autonomous Editorial / P2
- 선행: R17, R21
- 구현 영역: AI job coordinator
- 완료 기준:
  - 새 사건/변경근거만 분류·요약·초안 재생성
  - 작업 fingerprint·version·cache·일별 토큰상한; 오래된 작업 폐기
- 검증: 동일입력 재실행 무과금 캐시·버전경합·예산 초과 테스트

### R24. 자동 발행 정책·평가셋·범위 결정

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981878410ef8b5cbd194b?pvs=204)
- 단계/우선순위: R2 Autonomous Editorial / P2
- 선행: R21, R23
- 구현 영역: publication policy
- 완료 기준:
  - ASSIST/AUTO_QUEUE/AUTO_SCOPE 단계와 위험 제외 정의
  - 정밀도·중대오류·중단조건 평가; 운영 활성화 별도 승인
- 검증: 오프라인/shadow 평가와 승인 근거 기록

### R25. 단일사용 발행 승인권·원자적 게시 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a5598172a19ad37e2170aba8?pvs=204)
- 단계/우선순위: R2 Autonomous Editorial / P2
- 선행: R24
- 구현 영역: issue-publication
- 완료 기준:
  - candidate/evidence hash·policyVersion·expiry에 묶인 승인권
  - 사용1회·권한분리·publisher/outbox 원자성; 기존 HUMAN 승인 유지
- 검증: 만료/재사용/근거변조/동시승인·rollback 테스트

### R26. 자동 편집 shadow 운영·제한 활성화 검증

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a5598111bdc5c34d009fbc99?pvs=204)
- 단계/우선순위: R2 Autonomous Editorial / P2
- 선행: R25
- 구현 영역: ops automation
- 완료 기준:
  - shadow 결과 비교 후 승인된 범위만 활성화
  - kill switch·철회·사고 대응과 운영 비용 확인
- 검증: 사람검수 비교/중대실패0 조건/롤백 훈련

### R27. 실제 댓글 기반 이유 묶음·근거 연결

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981edbf27e952ff1d8ecd?pvs=204)
- 단계/우선순위: R3 Reasons & Learning / P2
- 선행: R21, R23
- 구현 영역: reason engine
- 완료 기준:
  - 실제 comment ID/version에만 연결한 요약·대표근거
  - 작성자 삭제/숨김/철회 시 요약 갱신; 가짜 댓글 금지
- 검증: 삭제전파·인용정확도·소수 의견 보존 평가

### R28. 선택 흐름 SHIFT·시간창 비교 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a559811ba391db98ef2074aa?pvs=204)
- 단계/우선순위: R3 Reasons & Learning / P2
- 선행: R18, R27
- 구현 영역: participation timeline
- 완료 기준:
  - 동일 IssueVersion·표본조건에서 집단 선택 변화만 표시
  - 개인 마음변화로 오인 금지; 개인추적은 별도 opt-in 설계
- 검증: 소표본·버전변경·재노출·집단구성 변화 테스트

### R29. 확산 타임라인·사건 관계 탐색 구현

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981b5b22df22787354a90?pvs=204)
- 단계/우선순위: R3 Reasons & Learning / P2
- 선행: R19, R22
- 구현 영역: event graph
- 완료 기준:
  - 관측된 출처 확산과 추론된 관계를 구분
  - 인터넷 최초 발생 단정 금지; 출처와 시각 정밀도 표시
- 검증: 늦게 수집된 기사·수정기사·상충근거·철회 사례

### R30. 트렌드 관심사·저장·추천 품질 실험

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a559810684bcca52f8fea09b?pvs=204)
- 단계/우선순위: R3 Reasons & Learning / P2
- 선행: R18, R22
- 구현 영역: recommendations
- 완료 기준:
  - 선택 놀이 피드와 트렌드 목적을 별도 측정
  - 다양성·필터버블·노출편향·privacy/optout 검증
- 검증: 실험할당·대조군·정책위반·민감속성 추론금지 테스트

### R31. Creator·콘텐츠 스튜디오 연결 확장 검토

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a55981b4a140ff0ecab106ce?pvs=204)
- 단계/우선순위: R4 Expansion / P3
- 선행: R21
- 구현 영역: content studio
- 완료 기준:
  - 트렌드 기반 홍보 소재의 근거·라이선스·질문 링크 제공
  - 게시완료 중복 제외·실제 게시 별도 승인 유지
- 검증: 기존 public content API 중복제외 회귀와 초안 UX 검증

### R32. 지역·B2B·외부 API 확장 타당성 검토

- 작업: [Notion Task](https://app.notion.com/p/3e028b27a5598131a23bdcb8bf2d6e1f?pvs=204)
- 단계/우선순위: R4 Expansion / P3
- 선행: R22, R29
- 구현 영역: future product
- 완료 기준:
  - 지역해상도·익명성·재배포권한·호출비용 검증
  - 공개 가능한 필드와 유료상품 범위 합의 전 구현/판매하지 않음
- 검증: 실제 데이터 커버리지·권한·비용 보고서
