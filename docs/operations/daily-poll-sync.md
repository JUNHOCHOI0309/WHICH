# 매일 신규 투표 가져오기

사용자 확정: **하루 한 번, 한국시간 오전 8시**, 신규 게시물만 추가. 웹 요청이나 브라우저를 열어놓는 것에 의존하지 않습니다.

## 현재 배포 범위와 미완료 항목

구현: 일회성 서버 실행기, AgentTools 시작/결과 확인/전체 JSON 다운로드 어댑터, DB 단일 실행 잠금, 날짜별 실행 기록, 신규만 INSERT, 관리자 상태 표시, Cloud Run Job 진입점과 **기본 dry-run** 예약 준비 스크립트.

**실제 자동 수집은 활성화되지 않았습니다.** 실제 Task ID/API 키/출력 샘플이 없으며, Cloud Run Job·Cloud Scheduler 리소스도 아직 생성하지 않았습니다. 실행기 코드 배포와 예약 활성화를 혼동하지 않습니다. 신규 유료 리소스 생성은 연결 검증 및 비용 승인 후 별도 진행합니다.

## 실행 소유자

WHICH Cloud Scheduler → Cloud Run Job → 기존 Octoparse 작업 시작 → 결과 완료 대기 → 전체 JSON 검증 → 신규 후보 저장.

- cron `0 8 * * *`, timezone `Asia/Seoul`. Octoparse 자체 예약은 중복 설정하지 않습니다.
- 실행기는 08시 이전에는 시작하지 않으며 하루 성공 후 재호출은 건너뜁니다.
- 전용 DB 연결의 advisory lock으로 다중 실행을 직렬화합니다. 외부 요청을 기다리는 동안 DB 트랜잭션을 유지하지 않습니다.
- 20분 실행 제한, HTTP 30초 제한, 응답 10MB/5000행 제한. 다운로드 호스트는 확인된 정확한 호스트만 허용하며 리다이렉트와 인증키 전달을 금지합니다.
- 출력 전체 행 수와 dataTotal이 일치해야 합니다. sampleData는 후보 데이터로 사용하지 않습니다.
- 전체 파일을 검증한 뒤 한 트랜잭션에서 신규 후보와 성공 기록을 저장합니다. 기존 게시물 ID는 무조건 건너뛰므로 편집/출처/검수 상태를 덮어쓰지 않습니다.
- 수집 원본 JSON과 수집시각은 관리자 후보의 source에 보존합니다. 원문은 텍스트 검수 전송 경로를 거치며 자동 승인/게시하지 않습니다.

## 실제 연결 전 확인

1. 기존 Cloud 실행 가능 Task ID와 API 키를 서버 Secret Manager에 설정합니다. 작업에 정확한 초기 11개 채널이 설정되어 있고 만렙백수가 제외됐는지 대조합니다.
2. 실제 export에서 배열 형태 `Poll_options`와 `Channel_name`, `Post_text`, `Poll_vote_count`, `Post_URL`, `Post_date`를 확인합니다. 현 어댑터는 전체 JSON 배열 및 정확히 이 필드 매핑 또는 기존 정규화된 배열을 지원합니다. 다른 구조면 검증 실패로 중지합니다. 문자열 선택지를 쉼표로 나누지 않습니다.
3. 원문 작성자와 설정된 채널이 일치하는지 실제 표본으로 확인합니다. 채널 ID가 있는 정규화 행은 알려진 ID와 대조합니다. 기존 지연 결과가 아닌 새 실행의 전체 export인지도 확인합니다.
4. 실제 출력과 채널 범위를 검증한 뒤에만 `OCTOPARSE_MAPPING_VERIFIED=true`를 사용합니다. 키 존재만으로 자동 활성화하지 않습니다.
5. `OCTOPARSE_EXPORT_HOSTS`에는 실제 인증된 export 응답에서 확인한 호스트만 넣습니다. 도메인을 추측하거나 localhost/임의 프록시를 허용하지 않습니다.
6. `OCTOPARSE_IMPORT_MEMBER_ID`는 기존 운영자 ID입니다. 새 계정을 만들거나 권한을 자동 부여하지 않습니다.

서버 전용 secret `which-poll-sync-env`의 필드: `OCTOPARSE_TASK_ID`, `OCTOPARSE_API_KEY`, `OCTOPARSE_IMPORT_MEMBER_ID`, `OCTOPARSE_EXPORT_HOSTS`, `OCTOPARSE_MAPPING_VERIFIED`. API 키나 서명된 export URL은 화면/로그에 표시하지 않습니다.

## 준비 및 활성화

`scripts/cloud-run/configure-poll-sync.ps1`에 현재 운영 이미지 digest, 전용 Scheduler 호출 서비스 계정, secret의 고정 버전을 전달하면 계획만 출력합니다. 비용·권한 승인을 받은 뒤 `-Apply`로 신규 Job과 **paused** Scheduler를 준비합니다. 기존 동일 이름의 Scheduler가 있다면 새로 만들지 말고 상태를 먼저 확인합니다. 스크립트는 자동 활성화·외부 수집·예약 resume을 수행하지 않습니다.

실제 연결 검사 후 Job의 `POLL_SYNC_ENABLED=true`로 바꾸고 명시적으로 한 번 실행해 데이터/중복/권한을 확인합니다. 그다음 Scheduler를 resume하고 웹 서비스에 상태 표시용 `POLL_SYNC_SCHEDULE_ACTIVE=true`를 설정합니다. 웹 API에는 Octoparse 비밀키를 복제할 필요가 없습니다. 중지 시 Scheduler pause와 Job disable, 웹 상태 플래그 false를 함께 적용합니다.

Job 이미지는 웹과 별도로 고정되므로 다음 릴리스에서 Job 이미지도 검증된 digest로 갱신해야 합니다. 자동 웹 배포가 Job을 몰래 만들거나 활성화하지 않습니다.

## 실패 및 재시도

- 시작 요청을 보내기 전에 REQUESTING을 기록합니다. 응답 유실·이미 실행 중·거절은 확인 없이 반복 시작하지 않습니다. 운영자가 Octoparse 실행 상태를 확인해야 합니다.
- ACCEPTED 뒤의 export 실패는 15분 이후 재호출에서 **새 수집 시작 없이** 결과 조회를 재개합니다. 최대 3회 후 수동 확인합니다. Job 자체 즉시 재시도는 0이며, 다음 날 예약도 미완료 결과부터 복구합니다. 재시도 간격은 별도 시간별 예약을 생성한다는 의미가 아닙니다.
- 불확실한 시작 또는 재시도 한도 도달은 관리자 확인 전 후속 시작을 막습니다. 운영자가 실제 제공자 상태와 수집 범위를 대조한 후에만 실행 기록 복구를 결정합니다. 기록을 지워 무조건 재실행하지 않습니다.
- `no_data`는 ‘신규 0건 성공’으로 취급하지 않습니다. 원본 접근/작업 설정을 확인해야 합니다. 유효한 전체 export에서 모두 기존 ID일 때만 ‘신규 0 / 중복 N’ 성공입니다.
- 날짜 cutoff나 제공자의 삭제/내보냄 표시를 사용하지 않습니다. 누락분 복구를 위해 기존 작업은 충분한 조회 겹침 범위를 가져야 합니다.
- 마지막 **가져오기 성공** 시각은 성공한 DB 커밋만 의미하며, 모든 채널의 수집 성공을 의미하지 않습니다. 채널별 0건/실패 판별은 실제 작업 및 하위 작업 출력 검증이 추가로 필요합니다.
- Scheduler의 HTTP 접수 성공과 Job 실행 성공은 다릅니다. Cloud Run Job 실패와 `/ops`의 최근 실행 오류를 별도로 확인합니다.

## 검증 근거

- [Octoparse 기존 작업/전체 export 흐름](https://helpcenter.octoparse.com/en/articles/15855832-run-a-scraping-workflow-with-the-octoparse-agenttools-api)
- [Cloud Run Job 정기 실행](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)

실제 채널 수집 성공, 첫 오전 8시 실행과 다음 날 신규분 갱신은 활성화 후 따로 확인해야 합니다. 테스트 더블 성공은 실연동 성공이 아닙니다.
