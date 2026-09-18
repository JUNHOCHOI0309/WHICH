# WHICH Marketing Studio Pages

Cloudflare Pages와 Pages Functions에서 실행되는 비공개 콘텐츠 제작 스튜디오입니다.

- 운영 주소: `https://studio.whichone.site/`
- Pages 프로젝트: `which-marketing-studio-pages`

- `CF-Connecting-IP`의 SHA-256 값이 `ALLOWED_IP_SHA256`와 일치할 때만 응답합니다.
- 공식 질문은 `https://whichone.site/public/issues.json?limit=500`에서 전량 읽어 KV에 캐시하고, 오래된 캐시는 응답 뒤 비동기로 갱신합니다.
- 투표 후보 관리와 검수 전송은 WHICH `/ops?tab=polls`에서 수행합니다.
- 프롬프트, 완료 표시, 생성 패키지와 일일 비용 원장을 KV에 저장합니다. 이전 수집 후보는 삭제하지 않고 비공개 JSON 내보내기로 보존합니다.
- 이미지 카드는 생성하지 않습니다.
- 선택한 WHICH 질문으로 5초 세로형 HyperFrames MP4를 비용 없이 생성할 수 있습니다. 이 PC의 로컬 렌더러가 실행 중이면 **5초 쇼츠 만들기** 버튼 하나로 입력 생성, 렌더, 다운로드까지 처리합니다.
- 질문별 최신 생성 원고를 기억하고, 게시 완료 처리 시 통합 본문을 완료 기록에 함께 보관합니다.
- 게시 완료 목록에서 항목을 누르면 저장된 원고를 다시 볼 수 있습니다. 이전 방식으로 완료된 항목은 원고가 없다는 안내가 표시됩니다.
- `GET /api/public/completions`는 완료된 질문 ID만 공개합니다. WHICH의 콘텐츠 생성용 질문 API가 이 목록을 조회해 이미 홍보한 질문을 제외합니다.
- `/ops` 투표 후보에서 검수함으로 보내면 출처와 전체 원문을 보관한 텍스트 질문이 Review Center에 등록됩니다. 승인·게시는 별도 단계입니다.
- 콘텐츠 생성 목록은 WHICH DB에 실제 발행되어 공개 카탈로그에 나타난 질문만 사용합니다.
- 기존 후보는 `기존 후보 JSON 내려받기`로 백업한 뒤 `/ops`에서 가져올 수 있습니다. 기존 가져오기·수집·제외 API는 410 응답으로 새 위치를 안내합니다.
- 외부 플랫폼에 게시하거나 예약하지 않습니다.
- OpenAI 키는 Pages의 암호화 환경 변수 `OPENAI_API_KEY`로만 주입합니다.

검증:

```powershell
pnpm --filter @which/marketing-studio-pages build
pnpm --filter @which/marketing-studio-pages test
pnpm --filter @which/marketing-studio-pages check
```

배포 파일은 `pnpm --filter @which/marketing-studio-pages build`가 만드는 `dist/_worker.js`입니다. 현재 프로젝트는 Git 자동 배포가 아닌 Pages Direct Upload 방식이므로 변경 후 `dist`를 다시 배포해야 합니다.

배포 후 공인 IP가 바뀌면 `ALLOWED_IP_SHA256`를 새 IP의 SHA-256으로 갱신해야 합니다.

로컬 렌더러는 Windows 로그인 시 자동 실행하도록 한 번만 설치합니다.

```powershell
powershell -ExecutionPolicy Bypass -File apps/marketing-hyperframes/scripts/install-windows-startup.ps1
```

설치 후 질문을 선택하고 **5초 쇼츠 만들기**를 누르면 약 10~20초 뒤 MP4 다운로드가 시작됩니다. 연결에 실패할 경우에만 화면의 입력 JSON을 내려받아 기존 명령으로 수동 렌더링할 수 있습니다.

기본 템플릿은 1080×1920, 30fps, 5초 무음 키네틱 타이포그래피입니다. 외부 영상·이미지·TTS API를 호출하지 않으며 확인되지 않은 투표 수치도 사용하지 않습니다. 렌더러는 `127.0.0.1:8783`에만 바인딩합니다.

Octoparse 작업 ID·채널 URL·서버 자격 증명 연결은 별도 설정 단계입니다. 현재 `/ops` JSON 가져오기로 동일한 검수 흐름을 사용할 수 있습니다.
