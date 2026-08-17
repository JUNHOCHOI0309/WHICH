# Git workflow

WHICH는 1인 프로젝트로 운영하므로 Pull Request 없이 기능 브랜치와 명시적 병합 커밋으로
변경 이력을 관리한다. `main`은 배포·통합 가능한 상태만 보관한다.

## 브랜치 역할

| 브랜치            | 용도                      | 직접 작업              |
| ----------------- | ------------------------- | ---------------------- |
| `main`            | 검증을 통과한 변경의 통합 | 금지, 병합 커밋만 허용 |
| `feature/<name>`  | 새로운 제품 기능          | 허용                   |
| `fix/<name>`      | 버그 수정                 | 허용                   |
| `build/<name>`    | 빌드·의존성               | 허용                   |
| `chore/<name>`    | 유지보수·설정             | 허용                   |
| `ci/<name>`       | CI 변경                   | 허용                   |
| `docs/<name>`     | 문서 변경                 | 허용                   |
| `refactor/<name>` | 동작을 유지하는 구조 개선 | 허용                   |
| `test/<name>`     | 테스트 추가·수정          | 허용                   |
| `perf/<name>`     | 성능 개선                 | 허용                   |

브랜치 이름은 소문자 kebab-case를 사용한다. 예: `feature/core-vote-contract`.

## 작업 흐름

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/core-vote-contract

# 기능 구현과 원자적 커밋
pnpm check
git push -u origin feature/core-vote-contract

# 기능 브랜치 CI 성공 확인 후 로컬 통합
git switch main
git pull --ff-only origin main
git merge --no-ff feature/core-vote-contract -m "merge: add core vote contract"
git push origin main
```

기능 브랜치는 LOOFIO와 동일하게 삭제를 강제하지 않는다. 이후 조사·회귀 추적에 가치가
있으면 로컬과 원격에 유지한다.

## 커밋 메시지

Codex settings에 정의된 다음 타입만 사용한다.

| 타입       | 사용 기준           | 예시                                    |
| ---------- | ------------------- | --------------------------------------- |
| `feat`     | 새로운 기능         | `feat: add guest subject issuance`      |
| `fix`      | 버그 수정           | `fix: prevent duplicate accepted votes` |
| `build`    | 빌드·모듈 설치·삭제 | `build: add database migration tooling` |
| `chore`    | 그 외 유지보수      | `chore: initialize repository hooks`    |
| `ci`       | CI 설정             | `ci: validate topic branches`           |
| `docs`     | 문서                | `docs: record vote invariants`          |
| `style`    | 포맷·스타일만 변경  | `style: format api schemas`             |
| `refactor` | 동작 없는 구조 개선 | `refactor: isolate vote transaction`    |
| `test`     | 테스트              | `test: cover idempotent vote retries`   |
| `perf`     | 성능 개선           | `perf: reduce feed query round trips`   |

제목은 명령형 영문으로 간결하게 작성한다. 하나의 커밋에는 하나의 논리적 변경만 담는다.
`main` 통합 시에만 `merge: <완료된 기능>` 형식을 예외로 허용한다.

## PR 없는 검증 절차

1. 작업 브랜치에서 관련 Decision ID와 구현 범위를 확인한다.
2. 구현·테스트·문서를 같은 기능 단위로 완성한다.
3. `pnpm check`를 통과시킨다.
4. 원격 기능 브랜치 CI가 필요하면 먼저 push하고 성공을 확인한다.
5. `main`에 `--no-ff`로 병합한다.
6. 병합 직후 문제가 있으면 추가 직접 커밋 대신 새 `fix/*` 브랜치에서 수정한다.

## 최초 저장소 예외

아직 커밋이 하나도 없는 저장소에서는 `main` 기준점을 만들기 위한 최초 bootstrap 커밋
1개만 허용한다. 이후에는 직접 커밋을 금지하고 모든 변경을 작업 브랜치에서 병합한다.
