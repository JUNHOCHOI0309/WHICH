# Radar 로컬 우선 개발

2026-09-19 사용자 지시: Task마다 서버 배포하지 않고 로컬에 변경을 누적한다. 배포 요청이 있을 때만 묶어서 PR/CI/운영 확인한다.

## 작업 위치

- 전용 worktree: `C:/workspace/vscode/which-radar-local`
- 브랜치: `codex/radar-local-development`
- 웹: <http://localhost:3000>, API: <http://127.0.0.1:4000>
- 전용 Docker Compose 프로젝트: `which-radar-local`
- 전용 DB: `127.0.0.1:54339/which_radar`, 별도 영속 volume

원래 `which` 폴더의 미커밋 변경 및 기존 DB는 변경하지 않는다.

## 실행

Docker Desktop을 실행한 뒤 이 폴더에서:

```powershell
pnpm install --frozen-lockfile
pnpm radar:setup
pnpm radar:dev
```

setup은 이 전용 DB에만 migration과 합성 개발 데이터(질문 3개·샘플 댓글/참여)를 넣는다. 운영 데이터가 아니다. 개발 seed는 언제든 다시 실행하지 말고 개발 계정 상태를 보존하면서 필요한 때만 실행한다.

웹은 Next 개발 모드로 변경 사항을 반영한다. API 코드 변경 시 개발 서버를 Ctrl+C로 종료하고 `pnpm radar:dev`를 다시 실행한다. DB 중지는 `pnpm radar:db:stop`이며 데이터를 지우지 않는다. 볼륨 삭제 명령은 제공하지 않는다.

## 격리 범위

- 운영 `.env`나 인증키를 복사하지 않는다. root/API/web의 실제 `.env*` 파일이 있으면 실행을 거절한다.
- 애플리케이션 환경변수는 안전한 고정 로컬 프로필에서 생성한다. 부모 프로세스의 DB/클라우드/OAuth/이메일/R2/AI 비밀 값과 NODE_OPTIONS는 상속하지 않는다.
- DB/API/web은 loopback에만 바인딩한다. 데이터베이스 migration/seed 대상은 고정 DB 주소를 검사한다.
- AI 검수·자동 게시·외부 투표 수집·작업 dispatcher는 비활성. 외부 수집 어댑터는 우선 fixture/mock으로 검증한다.
- 네트워크 sandbox 자체는 아니다. 의존성 설치와 브라우저의 정적 외부 리소스 요청까지 차단하는 환경은 아니며, 추후 실수집 테스트는 별도 명시적으로 활성화해야 한다.
- 이메일 회원가입/로그인과 합성 질문 투표는 로컬에서 사용 가능. OAuth, 이메일 발송, R2 이미지 업로드, AI 검수의 운영 연동은 이 환경에서 제공하지 않는다. /ops는 별도 로컬 관리자 계정 권한을 부여한 후 검증한다.

## 완료와 배포 기준

- 개발 Task: 요구사항·단위/통합 테스트·필요한 localhost 화면 확인 완료 시 **로컬 완료 / 운영 미반영**으로 기록한다.
- 운영 확인을 본래 목적으로 하는 R21/R26은 로컬 완료와 별개로 유지한다.
- 사용자의 배포 요청 전 main 병합·push·Cloud Build 실행을 하지 않는다.
- 이후 묶음 배포: 변경 목록/DB migration 검토 → PR/전체 CI → 승인된 정상 배포 → 운영 smoke.

## 검사

```powershell
pnpm radar:test
pnpm radar:test:db
pnpm --filter @which/api exec vitest run test/radar-contracts.test.ts test/poll-candidates.test.ts
```

`radar:test:db`는 전용 로컬 PostgreSQL에 일회성 테스트 DB를 만들어 신규/업그레이드 migration, Radar 저장소·수집 실행 원장, 기존 질문 조회·투표 회귀를 검증하고 테스트 DB만 제거한다. 실행 원장 테스트는 외부 제공자를 호출하지 않는다. 기존 localhost DB에 새 migration만 적용하려면 `pnpm radar:migrate`를 사용한다(seed 재실행 없음).
