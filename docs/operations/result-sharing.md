# Result Sharing & Deep Link v1

WHICH의 결과 공유는 투표 결과를 본 사용자가 만든 비식별 Share Card를 사용합니다. 공유받은 사람은 결과가 아니라 정확한 Issue의 투표 전 화면으로 진입합니다.

## Privacy and integrity

- 개인 선택은 기본적으로 포함하지 않으며 사용자가 Toggle을 켰을 때만 `A` 또는 `B`를 저장합니다.
- Share Card에는 Guest, Subject, Member ID를 저장하지 않습니다.
- Share Card는 생성 시점의 immutable `result_snapshots` 행을 참조합니다.
- 비공개·삭제·고위험·정치 Issue와 검토 또는 잠금 상태의 결과는 공유할 수 없습니다.

## URL contract

공유 URL은 `/issues/:issueId`와 `share` UUID를 사용합니다. Attribution은 아래 값만 허용됩니다.

- `utm_source=share`
- `utm_medium=copy|system|x`
- `utm_campaign=result|result_with_choice`
- `utm_content=<share UUID>`

자유 입력이나 사용자 식별값은 URL에 넣지 않습니다.

## Rollout and rollback

`FEATURE_RESULT_SHARING_ENABLED=true`로 API 생성·조회 기능을 활성화합니다. 긴급 비활성화가 필요하면 Render 환경 변수에서 값을 `false`로 바꾸고 재배포합니다. 공유 실패는 투표 결과와 다음 Issue 이동을 막지 않습니다.

배포 후에는 다음을 확인합니다.

1. 투표 후 기본 Toggle이 꺼져 있는지 확인합니다.
2. 링크 복사 후 URL이 같은 Issue를 여는지 확인합니다.
3. 새 브라우저 세션에서 결과가 본문에 선노출되지 않는지 확인합니다.
4. 공유 미리보기 이미지와 문구가 생성 시점 집계와 일치하는지 확인합니다.
5. `SHARE_OPEN`, `SHARE_CHOICE_TOGGLE`, `SHARE_COMPLETE` 이벤트와 `share_card_id`가 기록되는지 확인합니다.
