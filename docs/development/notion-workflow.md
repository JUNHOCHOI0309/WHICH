# Notion workflow

WHICH의 Notion은 코드 저장소가 아니라 현재 상태, 결정 이유, 작업 결과와 다음 행동을 관리하는
프로젝트 두뇌다. 실제 코드와 정확한 변경 이력의 Source of Truth는 GitHub다.

## 대상 공간

- Project Home: [2026 / 2026 3분기 / WHICH](https://app.notion.com/p/3bf28b27a559803fb0e3d8c01ed5fd7e)
- Tasks: [Tasks](https://app.notion.com/p/2dc95012c8bd4db2b8f207338a027992)
- Decision Log: [Decision Log](https://app.notion.com/p/62deb73583c34015bea591cbc76e650b)
- Experiment Log: [Experiment Log](https://app.notion.com/p/e4c11b156ecd4339bb231fe2f159f197)

## Task lifecycle

1. 의미 있는 작업을 시작할 때 기존 Task를 찾거나 새 Task를 만든다.
2. `Status=Doing`, Priority, Type, Phase, Started, Branch를 설정한다.
3. 중요한 방향 선택은 Decision Log에 먼저 기록하고 Task와 relation으로 연결한다.
4. 구현과 검증이 끝나면 아래 완료 기록을 작성한다.
5. Commit과 GitHub 링크를 연결한 뒤 `Status=Done`, Completed를 설정한다.
6. 미완료이거나 외부 조건이 필요한 작업은 Done으로 표시하지 않는다.

## 완료 기록 템플릿

```markdown
## 목적

이 작업이 필요한 이유와 해결하려는 문제

## 쉽게 설명하면

비개발자도 결과를 이해할 수 있는 설명

## 진행한 작업

- 실제 변경 사항
- 사용자에게 보이는 동작
- 내부 구조 변경

## 결정과 대안

- 선택한 방식과 이유
- 고려했지만 선택하지 않은 대안

## 검증

- 실행한 테스트와 검사
- 실제 확인 결과

## 남은 위험

- 아직 확인되지 않은 점
- 후속 단계에서 주의할 점

## 다음 작업

- 이어서 진행할 Task
```

## 기록 품질 기준

- `무엇을 수정했다`에서 끝내지 않고 `왜 필요한가`를 먼저 설명한다.
- 구현 용어에는 사용자 관점의 쉬운 설명을 함께 둔다.
- 테스트 명령만 쓰지 않고 성공·실패 결과를 명시한다.
- 다음 작업이 없으면 `없음`이라고 명시한다.
- Notion과 코드가 다르면 GitHub 구현을 사실 기준으로 보고 Notion을 즉시 갱신한다.
- Research는 링크, 핵심 내용, WHICH 적용점, 적용하지 않을 점을 포함한다.
- Experiment는 목적, 가설, 변경, 결과, 결론과 다음 실험을 포함한다.
