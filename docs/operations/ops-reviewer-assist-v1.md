# WHICH Ops Reviewer Assist v1

Status: Implemented for `WHICH-102`  
Scope: 자동 Moderation이 예외 Queue로 보낸 Case와 Random Audit 표본  
Non-goal: 모든 사용자 이미지를 운영자가 사전 승인하는 흐름

## 운영 원칙

1. 일반 업로드는 자동 Rule·Provider Moderation 경로를 따른다.
2. 운영자는 고위험, 불확실, 권리 요청, 이의제기, Random Audit만 검토한다.
3. AI는 판정자가 아니라 근거 제공자다. 모델 결과가 없어도 수동 검수는 동작한다.
4. 비가역 일괄 작업은 제공하지 않는다. 모든 최종 조치는 개별 Case와 `expectedRevision`을 사용한다.

## Evidence Desk

이미지 Case의 근거는 다음 출처로 분리한다.

- `Rule`: 로컬 업로드 Gate와 정책 Rule
- `Report`: Case에 연결된 신고
- `Rights`: 사용 권리 확인과 권리 요청 상태
- `OCR · QR · PII`: 텍스트, QR, 개인정보 탐지와 제공된 좌표
- `Safety Model`: Provider shadow signal, score, abstain, disagreement
- `Similar Image`: perceptual hash 및 유사 이미지 신호

좌표가 있는 OCR·QR·PII finding은 미리보기 위에 영역으로 표시한다. Provider가 질문 연관성 또는 A/B 시각 비대칭을 지원하지 않으면 결과를 추정하지 않고 `모델 미지원`으로 표시한다.

## Random Audit 선판정 Gate

Random Audit 표본은 AI 권고와 Safety Model evidence를 처음부터 반환하지 않는다.

1. 운영자가 `ALLOW`, `REVIEW`, `BLOCK`, `ABSTAIN` 중 하나와 근거를 저장한다.
2. 서버가 선판정 시각과 운영자를 기록한다.
3. 그 후에만 AI 추천과 관련 Evidence가 보인다.
4. 최종 조치 시 AI 동의, Override 방향, 근거, 검토 시간, 최종 Action을 함께 저장한다.

이를 통해 운영자의 최초 판단이 AI 추천에 끌리는 정도를 release gate 평가에서 측정할 수 있다.

## 위험 이미지와 감사 로그

- High, Rights, Appeal 이미지는 기본적으로 흐리게 표시한다.
- 민감 이미지 보기, 원본 열람, 선판정, 최종 판정은 감사 이벤트로 남긴다.
- 삭제되었거나 저장소에서 제거된 원본은 Reviewer Assist가 우회 복원하지 않는다.

## Spam Cluster

동일하게 정규화된 댓글 본문은 Cluster로 표시하되, 각 댓글의 target ID와 신고 증거는 그대로 유지한다. Cluster 표시는 탐색 보조이며 일괄 삭제 권한을 만들지 않는다.

## 운영 확인 항목

- Random Audit 선판정 전 AI evidence가 응답에 포함되지 않는지
- 위험 이미지 reveal이 감사 로그에 남는지
- Provider OFF 또는 결과 없음 상태에서 수동 판정이 가능한지
- Override 시 방향과 근거가 저장되는지
- 동일 문구 Cluster에서도 개별 Case가 유지되는지
