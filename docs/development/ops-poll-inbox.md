# /ops 투표 후보 → Review Center

투표 후보 저장·검수 전송은 WHICH API/PostgreSQL에서 처리합니다. 콘텐츠 스튜디오는 게시된 WHICH 질문으로 홍보물을 제작합니다.

- `/ops?tab=polls`: 후보 JSON 가져오기, 채널/상태/질문 필터, 원문 확인, 검수 전송, 제외/복원.
- 원문 질문과 전체 선택지(최대 6개)를 보존합니다. WHICH에 보낼 텍스트는 별도 편집하며 2~~4개 선택지를 지원합니다. 5~~6개 원문은 자동 축소하지 않고 운영자가 편집해야 전송할 수 있습니다.
- 전송은 DB 행 잠금과 하나의 트랜잭션으로 후보 생성과 연결을 기록합니다. 재전송은 동일한 candidateId를 반환합니다.
- Review Center에는 이미지 없는 검수 대기 후보로 등록됩니다. 출처는 COMMUNITY 참고 자료이며, 인가·게시는 기존 운영 절차를 따릅니다. 외부 투표 수를 WHICH 투표로 기록하지 않습니다.
- 원문 URL의 게시물 ID로 중복을 판단합니다. 재수집은 수집함의 원문 스냅샷만 갱신하며 이미 전송된 편집본·출처는 변경하지 않습니다.
- 모든 경로는 기존 내부 인증·회원 세션·운영자 권한을 사용하고 웹 쓰기 경로는 동일 출처를 확인합니다.

## 연결 준비

2026-09-19 사용자 제공 인계 ZIP의 채널 주소를 `poll-channels.ts`에 반영했습니다. 이는 실수집 검증 결과가 아닙니다. 12개 중 만렙백수는 동명 채널 확인이 필요해 초기 자동 수집 대상에서 보류합니다. 나머지 11개도 첫 수집에서 작성자와 원문을 검증해야 합니다.

ZIP의 readiness.json에는 taskId=null, actualOctoparseSampleAvailable=false가 명시되어 있습니다. 이후 사용자가 **매일 오전 8시(한국시간), 신규만 추가**를 확정했습니다. 일회성 실행기와 AgentTools 어댑터·실행 기록은 구현되었으며, 실제 작업 ID/출력 샘플/서버 자격 증명으로 실연동 검증 및 예약 활성화가 남아 있습니다. 현재 외부 유료 작업을 실행하지 않으며 API 토큰은 JSON이나 브라우저에 넣지 않습니다. 상세 설정과 재시도 정책은 [정기 가져오기 운영 문서](../operations/daily-poll-sync.md)를 따릅니다.

필드 매핑 초안은 Channel_name→channel, Post_text→originalQuestion, Poll_options→originalChoices, Poll_vote_count→participationText, Post_URL→sourceUrl입니다. 원시 Octoparse JSON을 직접 지원한다고 가정하지 않습니다. Poll_options 자료형은 실제 샘플로 확인해야 하며 문자열을 쉼표로 나누지 않습니다. 정확한 게시일만 observedDate에 넣고 상대 날짜는 null로 둡니다. 좋아요·댓글 수를 투표 수로 대체하지 않습니다. readiness.json과 채널 설정 JSON은 후보 데이터가 아닙니다.

JSON 가져오기는 배열 또는 `{ "candidates": [...] }`, `{ "rows": [...] }`를 지원합니다. 화면에서 최대 500개를 200개씩 나눠 전달합니다. 행별 검증 실패는 표시되며 재시도 시 중복 생성하지 않습니다.

```json
{
  "channel": "진행빵집",
  "sourceUrl": "https://www.youtube.com/post/ACTUAL_POST_ID",
  "originalQuestion": "원문 질문",
  "originalChoices": ["선택지 1", "선택지 2", "선택지 3"],
  "observedDate": "2026-09-19",
  "participationText": "1.2만명 투표"
}
```

## 이전 Studio 후보

KV 원본을 삭제하지 않습니다. Studio의 **이전 후보 데이터 → 기존 후보 JSON 내려받기**를 `/ops`에 가져옵니다. 기존 제외/채택 상태는 제외 상태로 가져와 재게시를 방지하고 필요 시 복원합니다. 잘못된 원문 URL이나 대상 외 채널은 행 번호와 함께 표시합니다. 기존 수집·가져오기·제외 API는 410으로 새 위치를 안내합니다.

## 배포

`0064_lethal_the_hunter.sql`은 투표 후보 테이블과 편집 후보의 nullable 출처 컬럼을 추가합니다. 기존 데이터와 결정은 변경하지 않습니다. main CI 후 Cloud Build의 정상 마이그레이션/Cloud Run 배포 경로를 사용합니다. Studio는 동일 커밋의 Pages 빌드를 Direct Upload로 배포합니다.
