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
