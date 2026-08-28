# WHICH W Point 상점 카탈로그 v1

WHICH-117의 1차 목표는 포인트 사용처를 실제로 열 수 있는 안전한 상점 기반을 만드는 것입니다. 상품 수를 먼저 늘리기보다 Catalog → 미리보기 → 구매 → Inventory → 장착·해제가 하나의 원장 흐름으로 일관되게 동작하는 것을 우선합니다.

## 1차 출시 범위

- 테마 패밀리: `Signal Grid`, `Paper Vote`, `Neon Rift`, `Soft Orbit`
- 장착 슬롯: 프로필 강조색, 아바타 프레임, 공유 카드 배경
- 초기 상품: 테마당 3개, 총 12개
- 가격대: 500P~1,600P
- Web과 Mobile은 동일한 Catalog/Inventory/Equipment API를 사용합니다.
- 상품 표현은 원격 CSS/SVG 문자열이 아니라 버전화된 Asset Manifest와 허용된 Token으로 관리합니다.

## 고정 원칙

- A 선택 색상은 Cyan, B 선택 색상은 Orange를 유지합니다.
- 투표 영향력, 노출 순위, Moderation 우회 등 제품 공정성에 영향을 주는 상품은 판매하지 않습니다.
- 구매 시 W Point 차감, 구매 기록, Inventory 지급, Outbox 기록은 하나의 DB Transaction으로 처리합니다.
- 같은 Idempotency Key 재시도는 중복 차감이나 중복 지급을 만들지 않습니다.
- 디지털 꾸미기 상품은 구매 전 미리보기를 제공하며 구매 확정 후 사용자 환불 기능은 제공하지 않습니다.
- 가격, 상품 버전, 판매 상태는 구매 시 Snapshot으로 보존합니다.

## 후속 범위

- 테마별 전체 30개 상품, Bundle, 기간제 상품, 시즌/Archive 정책
- 칭호, 배지 케이스, 앱 아이콘, Motion 상품
- Bundle 할인 Snapshot과 시즌별 판매 정책
- 운영자용 상품 생성·가격 변경·판매 일시중지 UI 고도화
