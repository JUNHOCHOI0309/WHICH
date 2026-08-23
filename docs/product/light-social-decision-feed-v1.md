# Light Social Decision Feed v1

## 목적

WHICH의 핵심 투표 흐름을 기존 Dark Editorial 화면에서 밝고 빠른 Social Decision Feed로 전환한다. 사용자는 Feed를 벗어나지 않고 A/B를 선택하고, 선택이 확정된 뒤에만 전체 결과를 확인한다.

## 이번 구현 범위

- Web Feed를 세로형 App Shell과 compact vote card로 개편
- Web Issue Detail을 같은 Light UI와 공통 결과 표현으로 통일
- Mobile Feed에서 카드 단위 inline vote 지원
- Mobile Issue Detail을 Web과 같은 선택·결과 문법으로 통일
- A는 Cyan, B는 Orange로 고정
- 투표 전 결과 비공개, 투표 후 단일 Balance Result Bar 공개
- Guest 투표, 중복 방지, 같은 요청 재시도, 결과 공유, 선택 이유, 개인화 분석 유지
- 투표 완료 뒤 A/B 대표 댓글을 Feed 카드 안에서 자동·수동 순환
- 실제 연결된 Home, Interests, My Record 경로만 내비게이션에 노출
- Desktop 3열/2열/1열과 Mobile bottom navigation 반응형 지원

## 공통 상호작용 규칙

1. `PRE_VOTE`: A/B 선택지만 동일한 시각적 무게로 보여준다.
2. `SUBMITTING`: 같은 카드의 추가 입력을 막는다.
3. `ERROR`: 선택은 유지하고 같은 idempotency key로 재시도할 수 있다.
4. `RESULT`: 선택한 항목, A/B 비율, 참여 수를 한 개의 결과 막대에서 보여준다.
5. Feed 결과는 Issue Detail로 이동해도 이어진다.

## 대표 댓글 순환

- 대표 댓글은 Feed 초기 로드가 아니라 투표 성공 또는 duplicate 복원 뒤에만 요청한다.
- A/B 각각 공개 상태의 top-level 댓글을 최대 5개 제공한다.
- 정렬은 공감 수 내림차순, 작성 시각 내림차순, ID 내림차순이다.
- 두 진영의 댓글은 6초마다 함께 교체되며 이전·다음·일시정지 제어를 제공한다.
- Web은 hover·focus·탭 비활성 상태에서, Mobile은 앱 비활성 상태에서 자동 순환을 멈춘다.
- `prefers-reduced-motion` 또는 기기 모션 감소 설정에서는 자동 순환을 사용하지 않는다.
- 한쪽에 대표 댓글이 없으면 해당 진영의 empty state를 유지한다.

## 데이터 원칙

현재 API가 제공하지 않는 작성자, 조회 수, 좋아요 수, 북마크 상태, 실시간 순위는 가짜 값으로 만들지 않는다. 해당 정보가 필요한 UI는 API 계약과 조회 성능을 먼저 확장한 뒤 도입한다.

## 반응형 기준

- `1320px 이상`: Left rail + Main feed + Right rail
- `1024–1319px`: Left rail + Main feed
- `768–1023px`: Main feed 중심
- `768px 미만`: compact header + fixed bottom navigation

## 접근성·모션

- 선택 행은 명확한 접근성 이름을 가진 button으로 제공한다.
- 결과 막대는 시각적 색상 외에 텍스트 비율과 선택 표시를 함께 제공한다.
- 키보드 focus ring을 유지한다.
- `prefers-reduced-motion`에서는 결과 전환 애니메이션을 줄인다.

## 검증 기준

- Web 및 Mobile TypeScript, lint, test, production build 통과
- 투표 전 카드에 비율이 보이지 않음
- 투표 후 단일 Balance Result Bar와 `나의 선택`이 표시됨
- 모바일 390px 및 데스크톱 1440px에서 가로 넘침 없음
- Guest 투표 결과가 상세 화면에 유지됨
