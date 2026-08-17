# 기여 가이드

## 변경 원칙

1. 제품 동작 변경은 관련 기획 문서의 Decision ID 또는 Open Decision ID를 PR에 적습니다.
2. 데이터 모델 변경은 마이그레이션과 롤백 방법을 함께 제출합니다.
3. 정치·선거 기능은 기본 비활성이며 승인 산출물 없이 활성화할 수 없습니다.
4. Guest의 첫 Issue → Vote → Result 흐름에 로그인이나 온보딩을 선행시키지 않습니다.
5. 변경 전 `pnpm check`를 통과시킵니다.

## 브랜치와 커밋

- `main`에는 직접 커밋하지 않고 타입별 작업 브랜치에서 작업합니다.
- PR 없이 `pnpm check`와 브랜치 CI를 통과한 뒤 `--no-ff`로 로컬 병합합니다.
- 커밋은 `feat`, `fix`, `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `test`,
  `perf` 중 하나로 시작합니다.
- 한 변경에는 한 목적만 담습니다.
- 생성 파일과 소스 파일을 같은 변경에서 구분해 검토할 수 있게 합니다.
- 비밀값, 실제 사용자 데이터, 운영 환경 파일은 커밋하지 않습니다.

상세 절차는 [`docs/development/git-workflow.md`](docs/development/git-workflow.md)를 따릅니다.

## Notion 작업 기록

- 각 Task의 시작·완료 상태를 WHICH Notion Tasks와 동기화합니다.
- 완료 기록에는 목적, 쉬운 설명, 변경 내용, 결정·대안, 검증, 위험과 다음 작업을 포함합니다.
- Branch, Commit, GitHub 문서와 관련 Decision을 가능한 범위에서 연결합니다.
- 상세 형식과 대상 공간은
  [`docs/development/notion-workflow.md`](docs/development/notion-workflow.md)를 따릅니다.
