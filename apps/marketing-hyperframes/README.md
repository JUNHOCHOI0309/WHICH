# WHICH Marketing HyperFrames

콘텐츠 스튜디오가 내려주는 `hyperframes-input.json`을 5초 세로형 MP4로 렌더링합니다.

```powershell
pnpm --dir apps/marketing-hyperframes render:input -- C:\Downloads\hyperframes-input.json
```

두 번째 인수로 출력 경로를 지정할 수 있습니다.

```powershell
pnpm --dir apps/marketing-hyperframes render:input -- C:\Downloads\hyperframes-input.json C:\Videos\which-short.mp4
```

렌더 전에 HyperFrames의 lint, runtime, layout, motion, contrast 검사를 자동으로 실행합니다. 기본 템플릿은 외부 영상·이미지·음성 API를 호출하지 않습니다.

## 콘텐츠 스튜디오에서 바로 MP4 받기

로컬 렌더러를 켜 두면 `https://studio.whichone.site`의 **5초 쇼츠 만들기** 버튼이 JSON 생성, 렌더, MP4 다운로드를 한 번에 처리합니다.

```powershell
pnpm --dir apps/marketing-hyperframes render:server
```

Windows 로그인 때 자동으로 실행하려면 한 번만 다음 설치 스크립트를 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File apps/marketing-hyperframes/scripts/install-windows-startup.ps1
```

렌더러는 `127.0.0.1:8783`에만 바인딩하며 WHICH 스튜디오와 로컬 개발 주소의 요청만 받습니다. 외부 영상·이미지·음성 API와 별도 클라우드 렌더 서버는 사용하지 않습니다.
