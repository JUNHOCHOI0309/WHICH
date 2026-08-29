# Approved Issue Media Library

WHICH-141은 운영자가 출처와 재사용 권리를 확인한 A/B 이미지 한 쌍을 Library에 등록하고, Member가 동일한 쌍을 여러 Issue에서 즉시 재사용할 수 있게 한다. Member 직접 업로드와 달리 Library 선택은 추가 검수 대기 없이 게시된다.

## 운영 전제

- 원본 두 장은 `OPERATOR_UPLOAD`로 등록하고 이미지 검수에서 `APPROVED` 및 `PUBLISHED` 상태까지 완료한다.
- A/B는 서로 다른 자산이어야 한다.
- 출처 URL, 저작자, 라이선스 이름·버전, 취득일, 증빙 위치를 기록한다.
- 상업적 이용과 재배포가 모두 허용된 경우에만 등록한다. 변형 허용 여부도 원문 그대로 기록한다.
- 만료일이 있는 라이선스는 만료일을 기록한다. 만료된 쌍은 Member 검색 결과에서 자동 제외된다.

## 운영 콘솔 등록

`/ops`의 `Image Review` 탭에서 다음 순서로 등록한다.

1. 검수 승인 및 공개 저장이 끝난 A/B 자산 ID를 입력한다.
2. Library 제목, 카테고리, 검색 주제를 입력한다.
3. 각 이미지의 alt text와 crop 방식을 지정한다.
4. 출처·저작자·라이선스·취득일·증빙 위치와 권리 확인 항목을 채운다.
5. `Library 등록`을 실행한다.

등록 API는 `POST /v1/internal/ops/media-library`이며 Operator 권한과 Cloudflare Access 보호를 거친다. Member가 보는 검색 API는 `GET /v1/member/issue-media-library`이고 `q`, `categoryCode`, `limit`을 지원한다.

## Member 작성 흐름

- Web과 Mobile 질문 작성 화면에서 기본값은 `텍스트만`이다.
- `승인 이미지 Library`를 고르면 사용 가능한 A/B 쌍만 표시된다.
- 한 쌍을 선택한 뒤 게시하면 `libraryPairId`가 `/v1/issues`에 전달된다.
- 서버는 게시 시점에 상태, 승인, 저장 위치, 권리 상태, 만료일, 정확히 두 개의 A/B 구성을 다시 검증한다.
- 유효하면 Issue와 선택지 이미지 연결, Library 사용 이력을 한 트랜잭션으로 생성한다.
- 동일한 Library 쌍은 여러 Issue에 재사용할 수 있다. 직접 업로드 자산 ID와 Library ID를 한 요청에서 혼용할 수 없다.

## 권리 철회와 롤백

권리 문제나 원 소유자의 철회 요청이 확인되면 운영 콘솔에서 10자 이상의 근거를 입력하고 해당 쌍을 회수한다.

회수 API는 `POST /v1/internal/ops/media-library/:pairId/revoke`이다. 실행 결과는 다음과 같다.

- Library 쌍을 `REVOKED`로 전환하고 검색에서 제거한다.
- 해당 쌍을 사용 중인 모든 Issue의 이미지 연결을 제거한다.
- 연결된 모든 Issue를 `TEXT_ONLY`로 바꿔 질문과 선택지는 계속 이용할 수 있게 한다.
- 사용 이력을 `TEXT_FALLBACK`으로 전환해 영향 범위와 근거를 보존한다.
- 원본 자산을 비공개 격리 저장소로 이동한다.
- Operator 감사 로그에 등록·회수 작업과 영향받은 Issue 수를 남긴다.

회수는 멱등적으로 처리한다. 이미 회수된 쌍을 다시 요청해도 공개 이미지가 복원되거나 Issue 연결이 재생성되지 않는다.

## 배포 및 확인

1. 배포 과정에서 migration `0051_foamy_chronomancer.sql`이 적용됐는지 확인한다.
2. Ops에서 승인된 이미지 두 장을 Library 쌍으로 등록한다.
3. Web과 Mobile에서 같은 쌍으로 각각 질문을 게시한다.
4. 두 Issue 모두 이미지와 함께 즉시 게시되고 사용 횟수가 증가하는지 확인한다.
5. Ops에서 쌍을 회수하고 두 Issue가 모두 텍스트 형태로 유지되는지 확인한다.
6. 회수된 쌍이 새 작성 화면에 나타나지 않는지 확인한다.

직접 업로드는 신뢰 사용자 Pilot을 위한 별도 단계이며, WHICH-141 완료만으로 일반 Member에게 활성화하지 않는다.
