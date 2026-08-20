# WHICH 주요 결정 로그 v2.0

- **문서 상태:** 통합 의사결정 기준본
- **버전:** 2.0
- **기준일:** 2026-08-18
- **기준 문서:** `01`~`11` 상세 기획본 및 초기 원본 기획
- **문서 목적:** WHICH에서 이미 채택된 제품·콘텐츠·신원·추천·소셜·거버넌스·지표·MVP 결정을 고유 ID, 상태, 근거, 영향, 재검토 조건과 함께 기록한다.
- **핵심 사용법:** 향후 PRD, ADR, DB Schema, API Contract, 정책 변경은 이 문서의 Decision ID를 참조해야 한다. 기존 결정을 변경할 때는 행을 삭제하지 않고 새로운 Decision으로 대체하며 `SUPERSEDED_BY` 관계를 남긴다.
- **문서 비범위:** 미결정 사항의 실제 결론, 최종 기술 스택, 법률 자문 결과, 수익모델 결정은 해당 Decision이 닫히는 시점에 추가한다.

## 0. Decision 상태와 기록 규칙
| 상태 | 의미 | 사용 규칙 |
| --- | --- | --- |
| CONFIRMED | 사용자와 기획에서 명시적으로 채택된 결정 | 후속 설계의 기본 전제 |
| DESIGN_BASELINE | 방향은 채택됐으나 세부 수치·UX·기술은 조정 가능 | Default로 구현하되 실험 가능 |
| INITIAL_PROPOSAL | Alpha·MVP 검증용 초기안 | Experiment 또는 Review 필요 |
| OPEN | 명시적 결정이 필요 | 11번 Open Decision ID 참조 |
| LEGAL_GATE | 법률·규정 확인 전 활성화 금지 | Fail-Closed |
| PROHIBITED | 제품 원칙상 채택하지 않음 | 실험 대상으로도 사용 금지 |
| SUPERSEDED | 새 결정으로 대체됨 | 원문 유지, 신규 ID 연결 |
| DEPRECATED | 현재 범위에서 사용 중단 | 데이터·코드 Migration 계획 필요 |

## 0.1 Decision ID 규칙
| Prefix | 영역 |
| --- | --- |
| DEC-PROD | 제품 정체성·가치·범위 |
| DEC-UX | 핵심 UX·사용자 여정 |
| DEC-SUP | Issue 공급·출처·게시 |
| DEC-TAX | 분류·품질·유희성·논쟁 |
| DEC-ID | 신원·계정·투표 무결성 |
| DEC-PERS | 관심사·개인화 |
| DEC-REC | 추천·ML |
| DEC-SOC | 댓글·프로필·Creator·Follow |
| DEC-GOV | 모더레이션·정치·거버넌스 |
| DEC-MET | 지표·분석·실험 |
| DEC-RM | MVP·로드맵·출시 |
| DEC-ARCH | 후속 Data·Technical Architecture |

## 0.2 필수 Decision 필드
| 필드 | 설명 |
| --- | --- |
| decision_id | 변하지 않는 고유 ID |
| status | 현재 결정 상태 |
| decision | 채택한 문장 |
| rationale | 왜 이 결정을 했는가 |
| scope | 적용 객체·Surface·Release |
| source | 근거 문서·사용자 합의 |
| dependencies | 선행·후속 결정 |
| revisit_trigger | 재검토 가능한 조건 |
| supersedes / superseded_by | 변경 이력 |
| recorded_at | 기록 또는 변경 일자 |

## 0.3 변경 규칙
- Decision 문장을 조용히 수정하지 않는다.
- 의미가 바뀌면 새 Decision ID를 만들고 기존 Decision을 SUPERSEDED로 바꾼다.
- 수치만 조정되는 DESIGN_BASELINE은 Revision을 추가하되 변경 이유와 실험 결과를 남긴다.
- 정치·선거·민감정보 Decision은 Product Owner 단독으로 Allow 방향으로 변경할 수 없다.
- PROHIBITED를 해제하려면 제품 원칙 문서와 안전·개인정보 문서를 함께 변경해야 한다.
- OPEN Decision의 Default는 구현 편의를 위한 임시값이지 CONFIRMED로 간주하지 않는다.

# 1. Executive Decision Summary
| 영역 | 핵심 결정 |
| --- | --- |
| 제품 | WHICH는 설문 도구가 아니라 질문과 선택을 연속 소비하는 의견 플랫폼이다. |
| 핵심 루프 | 외부 유입 → Guest Vote → Result → Comment → Next Issue → 반복 참여 |
| Guest | 일반 LOW·허용된 MEDIUM Issue의 첫 투표는 가입 없이 가능하다. |
| 결과 | 투표 전 결과는 숨기고 ACCEPTED Vote 후 즉시 공개한다. |
| 공급 | 초기에는 외부 자료를 질문으로 변환한 운영자 Issue Pool을 사용한다. |
| 유희성 | 첫 세션은 유희·취향·생활 공감형 질문 비중을 높인다. |
| 논쟁 | 논쟁은 분노가 아니라 최소 표본을 충족한 50:50 접전이다. |
| 정치 | 정치·선거 투표·댓글·사용자 생성·일반 추천은 MVP에서 비활성이다. |
| 신뢰 | 완전한 1인 1표를 주장하지 않고 대량 조작 비용을 높인다. |
| 개인화 | 관심사 3개와 행동으로 추천하되 A/B 방향으로 정치 성향을 만들지 않는다. |
| ML | 출시부터 ML-ready 구조와 ML v0를 사용하고 실제 Impression 후 ML v1로 확장한다. |
| 소셜 | 사람의 일상보다 좋은 질문 Creator와 Topic을 중심으로 연결한다. |
| 개인정보 | 전체 투표 기록은 기본 비공개며 정치 Choice는 일반 Profile·추천·BI에서 분리한다. |
| 거버넌스 | 신고 수만으로 삭제하지 않고 Notice·Appeal·Restore·Audit를 제공한다. |
| 성공 | QVPS와 Next Issue Rate를 공동 North Star로 사용한다. |

# 2. Master Decision Registry
## 제품 정체성·범위
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-PROD-001 | CONFIRMED | WHICH를 설문조사 도구가 아니라 이슈 소비·이지선다 의견 플랫폼으로 정의한다. | 반복 소비와 결과·댓글 탐색이 핵심 가치이기 때문이다. | 01 §1, 초기 기획 |
| DEC-PROD-002 | CONFIRMED | 핵심 콘텐츠 단위는 질문, A/B, 투표, 결과, 댓글, 다음 Issue다. | 제품 정체성과 데이터 모델의 최소 단위를 고정한다. | 01 §1.4, 초기 기획 |
| DEC-PROD-003 | CONFIRMED | 제품의 핵심 약속은 짧은 선택 후 다른 사람의 분포와 이유를 즉시 확인하는 것이다. | 첫 가치와 반복 참여를 명확히 한다. | 01 §1.3 |
| DEC-PROD-004 | CONFIRMED | 한 Issue의 조회보다 세션 내 반복 참여를 우선한다. | 단발성 설문과 차별화한다. | 01 §7.3 |
| DEC-PROD-005 | CONFIRMED | 질문이 사람보다 먼저 보이도록 설계한다. | 일반 SNS의 사람·팔로워 중심 진영화를 피한다. | 01 §7.4, 08 §1 |
| DEC-PROD-006 | CONFIRMED | WHICH 참여 결과를 대표 표본 여론 또는 국민 여론으로 표현하지 않는다. | 자발적 참여 데이터의 한계를 명확히 한다. | 01 §7.7, 05, 09 |
| DEC-PROD-007 | CONFIRMED | 초기 보상은 현금보다 노출·성과·배지·명예를 우선한다. | 스팸·자극적 질문·조작 인센티브를 줄인다. | 01 §7.12, 08 |
| DEC-PROD-008 | PROHIBITED | A/B 의견 방향으로 사용자 진영 Graph를 만들지 않는다. | 정치·사회적 양극화와 성향 추적을 피한다. | 01, 06, 08, 09 |
| DEC-PROD-009 | CONFIRMED | MVP 성공은 기능 수가 아니라 외부 Guest의 첫 투표와 다음 Issue 반복으로 판단한다. | 핵심 가설 중심 범위를 유지한다. | 11 §1 |
| DEC-PROD-010 | PROHIBITED | 공식 여론조사·예측시장·도박형 제품으로 포지셔닝하지 않는다. | 제품·법률·신뢰 경계를 유지한다. | 01 §8 |
| DEC-PROD-011 | CONFIRMED | 한국 초기 Acquisition은 Instagram 직접 유입보다 네이버 CHOiCE·카페·클립→블로그·홈피드DA를 우선하고 네이버 로그인을 별도 인증 수단으로 제공한다. | 국내 초기 도달·검색·커뮤니티 검증과 Guest→Member 연결을 함께 확보하되 유입 신호와 신원을 혼합하지 않는다. | 01 §6.3, 02 §14.6, 05 §8·§39.3, 06 §25.6, 10 §3.8 |

## 핵심 UX
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-UX-001 | CONFIRMED | 모든 Published Issue는 외부에서 직접 진입 가능한 독립 URL을 가진다. | SNS·검색·공유 유입의 핵심 계약이다. | 02 §3 |
| DEC-UX-002 | CONFIRMED | 외부 Deep-link Guest를 Home이나 가입 화면으로 우회시키지 않는다. | 첫 투표 전환을 보호한다. | 02 §3.3, 10 |
| DEC-UX-003 | CONFIRMED | 일반 LOW·허용된 MEDIUM Issue는 Guest가 가입 없이 투표할 수 있다. | 외부 유입의 마찰을 최소화한다. | 02, 05 |
| DEC-UX-004 | CONFIRMED | First Value Moment는 첫 VOTE_ACCEPTED와 첫 RESULT_VIEW의 완료다. | UX·실험의 공통 기준점을 만든다. | 01 §12, 02 §1.3, 11 §1.4 |
| DEC-UX-005 | CONFIRMED | 투표 전에는 정확한 결과를 숨기고 투표 후 공개한다. | 결과 확인을 투표 보상으로 만든다. | 01, 02, 초기 기획 |
| DEC-UX-006 | CONFIRMED | 투표 후 결과를 확인하기 전에 자동으로 다음 Issue로 넘기지 않는다. | 결과 보상을 보존한다. | 02 §13 |
| DEC-UX-007 | CONFIRMED | SKIP과 NEXT_ISSUE를 사용자 행동과 Event에서 분리한다. | 회피와 연속 소비를 구분한다. | 02, 07, 10 |
| DEC-UX-008 | CONFIRMED | 로그인·관심사·인증 전환 후 현재 Issue와 Draft 상태를 복원한다. | Just-in-time 전환의 이탈을 줄인다. | 02 §10 |
| DEC-UX-009 | DESIGN_BASELINE | 모바일은 한 화면 한 Issue에 가까운 Vertical Feed를 중심으로 한다. | 짧은 질문의 연속 소비에 적합하다. | 02 §13, 초기 기획 |
| DEC-UX-010 | CONFIRMED | 색상만으로 A/B와 결과를 구분하지 않고 키보드·스크린리더 경로를 제공한다. | 투표 정확성과 접근성을 보장한다. | 02 Accessibility |
| DEC-UX-011 | CONFIRMED | 관심사와 가입 Prompt는 첫 가치 이후에만 제안한다. | Guest 외부 유입을 보호한다. | 02, 06, 10 |
| DEC-UX-012 | PROHIBITED | 결과를 일부 숨기거나 가입해야 결과를 보게 하는 Dark Pattern을 사용하지 않는다. | 결과 보상과 신뢰를 훼손한다. | 02, 10 |

## Issue 공급
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-SUP-001 | CONFIRMED | 초기 Issue Pool은 외부에 존재하는 자료와 Evergreen 주제를 운영자가 시딩한다. | 빈 플랫폼 문제를 해결한다. | 03, 사용자 합의 |
| DEC-SUP-002 | CONFIRMED | 외부 원문을 복제하지 않고 사실·출처를 바탕으로 WHICH 질문으로 변환한다. | 저작권·제품 차별성을 보호한다. | 03 §2.1 |
| DEC-SUP-003 | CONFIRMED | Source Item, Issue Candidate, Published Issue를 분리한다. | 원자료·편집·공개 계약을 추적한다. | 03 §7 |
| DEC-SUP-004 | CONFIRMED | SNS·커뮤니티의 화제성은 발견 신호이며 사실 근거와 동일하지 않다. | 바이럴 오보가 자동 게시되는 것을 막는다. | 03 §2.2 |
| DEC-SUP-005 | CONFIRMED | 첫 ACCEPTED Vote 이후 질문과 A/B 핵심 의미를 변경하지 않는다. | 서로 다른 질문의 표가 하나로 집계되는 것을 막는다. | 03 §2.7, 05 |
| DEC-SUP-006 | CONFIRMED | 핵심 전제가 바뀌면 기존 Issue를 종료하고 Successor Issue를 생성한다. | 정정 이력과 집계 의미를 보존한다. | 03 §31 |
| DEC-SUP-007 | CONFIRMED | MVP 최종 게시 승인은 인간이 수행한다. | 초기 AI 품질·안전 오판을 통제한다. | 03 §15.5 |
| DEC-SUP-008 | DESIGN_BASELINE | MVP는 텍스트 질문·A/B·출처 링크를 기본으로 시작한다. | 미디어 권리와 모더레이션 범위를 줄인다. | 03 §29.1 |
| DEC-SUP-009 | CONFIRMED | 초기 공급은 Evergreen·유희형을 중심으로 하고 Trend 비중을 제한한다. | 재고 안정성과 자극성 의존 방지를 위해서다. | 03 §40.3, 04 |
| DEC-SUP-010 | PROHIBITED | 저품질 후보를 재고 부족 때문에 긴급 자동 게시하지 않는다. | Issue Pool 고갈이 품질 Gate를 무력화하지 않게 한다. | 03 Pool Operations |
| DEC-SUP-011 | PROHIBITED | 기사 사진·SNS 캡처·영상 Frame을 기본 썸네일로 무단 재사용하지 않는다. | 권리·피해 위험을 줄인다. | 03 Media Policy |
| DEC-SUP-012 | DESIGN_BASELINE | 사용자 Issue 생성은 승인된 Beta Creator부터 사전 검수로 시작한다. | 공개 UGC 이전에 운영 Capacity와 품질을 검증한다. | 03, 08, 11 |

## 분류·품질·논쟁
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-TAX-001 | CONFIRMED | Category와 Risk Level을 분리한다. | 주제와 운영 위험이 같은 개념이 아니기 때문이다. | 04 §2.1 |
| DEC-TAX-002 | CONFIRMED | Issue는 Category, Topic, Entity, Experience Mode, Lifecycle, Risk 등 다축으로 분류한다. | 추천·운영·분석 요구를 동시에 충족한다. | 04 §3 |
| DEC-TAX-003 | CONFIRMED | Risk Level은 LOW, MEDIUM, HIGH, RESTRICTED를 사용한다. | 위험에 비례한 검수·권한을 적용한다. | 04, 05, 09 |
| DEC-TAX-004 | CONFIRMED | 초기 첫 피드는 유희·취향·생활 공감형 Experience Mode 비중을 높인다. | 인지 비용과 첫 참여 장벽을 낮춘다. | 04 §2.3, 사용자 합의 |
| DEC-TAX-005 | CONFIRMED | 유희성은 모욕·혐오·피해자 소비·허위 전제와 구분한다. | 자극성을 재미로 정당화하지 않는다. | 04, 09 |
| DEC-TAX-006 | CONFIRMED | 좋은 Issue는 단일 판단 축, Binary Fit, 대등한 A/B, 비유도성, 충분한 맥락을 가진다. | 선택 의미와 결과 해석을 보호한다. | 03, 04 |
| DEC-TAX-007 | CONFIRMED | 논쟁은 최소 표본을 충족한 50:50 근접 접전이다. | 분노·신고·댓글 과열과 구분한다. | 04, 사용자 확인 |
| DEC-TAX-008 | CONFIRMED | 논쟁 피드에서도 투표 전 정확한 결과는 숨긴다. | 결과 편향을 줄이고 핵심 보상을 유지한다. | 04 §2.9 |
| DEC-TAX-009 | CONFIRMED | 정치성이 불명확하면 일반 Category로 허용하지 않고 Fail-Closed Review로 보낸다. | 정치 콘텐츠 누출을 막는다. | 04 Politics |
| DEC-TAX-010 | PROHIBITED | 정답이 있는 사실 Quiz, 금전 Betting, 3개 이상 선택을 MVP Issue 형식으로 혼합하지 않는다. | A/B 의견 제품의 정체성을 유지한다. | 04 §15.2 |

## 신원·투표 무결성
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-ID-001 | CONFIRMED | Guest, Member, Verified Member를 사용자 단계로 구분한다. | 위험과 기능에 비례한 권한을 적용한다. | 05 §5 |
| DEC-ID-002 | CONFIRMED | 로그인, 현실 신원 확인, 유일성, 요청 정상성을 서로 다른 축으로 관리한다. | 하나의 인증 상태를 과신하지 않는다. | 05 §2 |
| DEC-ID-003 | CONFIRMED | Guest는 First-party 무작위 anonymous subject로 현재 브라우저의 연속성을 유지한다. | 외부 추적 없이 중복 방어와 개인화를 지원한다. | 05 §6 |
| DEC-ID-004 | CONFIRMED | IP 하나당 한 표 정책을 사용하지 않는다. | 공유 Network의 정상 사용자를 차단할 수 있기 때문이다. | 05 Network |
| DEC-ID-005 | CONFIRMED | Issue와 Voter Subject의 조합에 하나의 ACCEPTED Vote를 허용한다. | MVP 중복 집계의 핵심 불변조건이다. | 05 Vote Contract |
| DEC-ID-006 | CONFIRMED | Vote 요청은 Idempotency Key로 재시도해도 중복 생성하지 않는다. | 네트워크 오류·다중 클릭을 안전하게 처리한다. | 05 Idempotency |
| DEC-ID-007 | CONFIRMED | Vote 처리 상태와 집계 무결성 상태를 분리한다. | 요청 성공과 정상 집계를 구분한다. | 05 State Model |
| DEC-ID-008 | CONFIRMED | 공개 결과는 현재 유효한 ACCEPTED Vote만 사용한다. | REVIEW·무효 표를 결과에서 제외한다. | 05 Aggregate, 10 |
| DEC-ID-009 | DESIGN_BASELINE | MVP에서는 ACCEPTED Vote의 선택 변경을 허용하지 않는다. | 결과 확인 후 변경 편향과 집계 복잡성을 줄인다. | 05 Vote Change |
| DEC-ID-010 | CONFIRMED | 모든 사용자에게 CAPTCHA를 요구하지 않고 Risk-based Challenge를 사용한다. | Guest 전환과 공격 비용을 함께 관리한다. | 05 Challenge |
| DEC-ID-011 | CONFIRMED | A/B 선택 방향 자체를 Abuse Risk 신호로 사용하지 않는다. | 의견을 부정 행위 판단 근거로 삼지 않는다. | 05 Risk Signal |
| DEC-ID-012 | CONFIRMED | 정상 바이럴과 Brigading을 구분하고 단계적으로 노출·Challenge·결과를 제어한다. | 공유 성장 Loop를 불필요하게 차단하지 않는다. | 05 Brigading |
| DEC-ID-013 | CONFIRMED | Vote Integrity와 콘텐츠 적격성을 분리한다. | 좌표찍기가 있어도 질문 자체를 자동 삭제하지 않는다. | 05 |
| DEC-ID-014 | PROHIBITED | WHICH가 일반 Guest Vote에서 법적·현실적 1인 1표를 보장한다고 주장하지 않는다. | 인증 한계와 신뢰를 정확히 표현한다. | 05 |

## 관심사·개인화
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-PERS-001 | CONFIRMED | 신규 사용자의 초기 관심사 구조는 3개 이상 선택이다. | Cold Start에 명시적 신호를 제공한다. | 06, 사용자 합의 |
| DEC-PERS-002 | CONFIRMED | 외부 Guest 첫 투표 전 관심사 온보딩을 요구하지 않는다. | 외부 유입을 보호한다. | 06 §3 |
| DEC-PERS-003 | DESIGN_BASELINE | Guest도 로그인 없이 현재 브라우저에서 관심사를 저장할 수 있다. | 가입 전 개인화 가치를 제공한다. | 06 |
| DEC-PERS-004 | CONFIRMED | 명시적 관심, 행동 추론, 세션 관심, 부정 선호를 분리한다. | 사용자 설정과 모델 추론을 혼동하지 않는다. | 06 Profile Model |
| DEC-PERS-005 | CONFIRMED | 실제 행동은 점차 중요해지지만 명시적 관심사를 조용히 삭제하지 않는다. | 사용자 통제권을 보존한다. | 06 |
| DEC-PERS-006 | CONFIRMED | 관심 없음, 덜 보기, Block, 추천 재설정을 제공한다. | 개인화의 직접 제어를 보장한다. | 06, 08 |
| DEC-PERS-007 | CONFIRMED | 관심사 밖 Exploration과 Category·Topic 다양성을 항상 유지한다. | 필터버블과 초기 선택 고착을 줄인다. | 06, 07 |
| DEC-PERS-008 | CONFIRMED | 어떤 Topic에 참여했는지는 사용할 수 있지만 선택 방향으로 정치·이념 Profile을 만들지 않는다. | 민감 성향 추적을 방지한다. | 06, 07, 09 |
| DEC-PERS-009 | CONFIRMED | Guest→Member 관심사 병합은 자동 덮어쓰기가 아니라 사용자 확인을 거친다. | 충돌과 예상치 못한 설정 변경을 막는다. | 06 Merge |
| DEC-PERS-010 | CONFIRMED | 추천 재설정은 추론 Profile을 초기화하지만 투표 기록·댓글은 삭제하지 않는다. | 추천 제어와 데이터 삭제를 구분한다. | 06 Reset |

## 추천·ML
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-REC-001 | CONFIRMED | 추천 목표는 투표 단독이 아니라 Vote→Result→Next→Return의 다목적 효용이다. | 자극적 투표 유도 과적합을 피한다. | 07 §1 |
| DEC-REC-002 | CONFIRMED | 추천 Pipeline은 Eligibility→Retrieval→Ranking→Policy Re-ranking→Serving으로 구성한다. | 정책과 모델 책임을 분리한다. | 07 §4 |
| DEC-REC-003 | CONFIRMED | 안전·정치·무결성·Block 정책은 ML Score보다 우선한다. | 모델이 제품 세이프라인을 우회하지 못하게 한다. | 07 §6 |
| DEC-REC-004 | CONFIRMED | 출시 시점부터 Issue Embedding과 관심 Vector를 사용하는 ML v0를 적용한다. | 규칙 기반 임시 구조를 나중에 전면 교체하지 않는다. | 07 §13, 사용자 합의 |
| DEC-REC-005 | CONFIRMED | 실제 Viewable Impression을 학습 예시의 기본 단위로 사용한다. | 노출되지 않은 후보를 부정 Label로 오해하지 않는다. | 07, 10 |
| DEC-REC-006 | CONFIRMED | ACCEPTED Vote만 긍정 Vote Label로 사용한다. | 조작·중복·Review 데이터 오염을 막는다. | 07, 10 |
| DEC-REC-007 | DESIGN_BASELINE | 첫 학습 Ranker는 Logistic Regression 또는 LightGBM 계열을 우선 검증한다. | 초기 데이터에서 설명 가능성과 운영 단순성을 확보한다. | 07 |
| DEC-REC-008 | CONFIRMED | Recommendation과 Integrity Model을 분리한다. | 무엇을 추천할지와 요청 정상성을 분리한다. | 07, 05 |
| DEC-REC-009 | CONFIRMED | Candidate Source, Exploration 여부, Model·Feature·Policy Version을 로그한다. | Feedback Loop와 모델 회귀를 분석한다. | 07 |
| DEC-REC-010 | CONFIRMED | Diversity Re-ranking은 Category, Topic, Creator, Semantic Cluster, Experience Mode를 제어한다. | 동질·반복 Feed를 방지한다. | 07 |
| DEC-REC-011 | CONFIRMED | 신규 Guest의 첫 피드는 유희·취향·생활 공감형 Issue를 중심으로 한다. | 첫 참여와 공유성을 높인다. | 04, 06, 07 |
| DEC-REC-012 | CONFIRMED | 정치·선거는 일반 For You, 인기, 급상승, 논쟁, Exploration에 자동 진입하지 않는다. | 조직적 증폭과 법률 위험을 차단한다. | 07 Politics |
| DEC-REC-013 | CONFIRMED | 모델 장애 시 ML v0 또는 Safe Global Fallback으로 축소한다. | Vote Core Loop의 가용성을 유지한다. | 07 Model Ops |
| DEC-REC-014 | PROHIBITED | 오프라인 ML 지표만으로 모델을 Production 승격하지 않는다. | 제품·안전·Guest Guardrail을 함께 검증한다. | 07, 10 |

## 소셜·Creator
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-SOC-001 | CONFIRMED | 소셜 기능은 좋은 질문과 선택 이유 탐색을 강화한다. | 사람 중심 일상 SNS로 변하는 것을 막는다. | 08 §1 |
| DEC-SOC-002 | CONFIRMED | 댓글은 특정 Issue에서 선택 이유를 설명하는 보조 콘텐츠다. | Issue 중심 제품 구조를 유지한다. | 08 |
| DEC-SOC-003 | DESIGN_BASELINE | 일반 최상위 댓글 작성은 Member와 해당 Issue ACCEPTED Vote를 요구한다. | A/B Side의 무결성을 보장한다. | 08 |
| DEC-SOC-004 | CONFIRMED | 댓글 Side는 Accepted Vote Choice에서 서버가 파생한다. | 사용자 위조를 방지한다. | 08 |
| DEC-SOC-005 | CONFIRMED | 댓글 A/B 표시는 해당 Issue 안에서만 공개한다. | 전체 성향 추적을 방지한다. | 08 |
| DEC-SOC-006 | CONFIRMED | 본인의 전체 투표 기록은 기본 비공개다. | 민감 성향과 사생활을 보호한다. | 08, 05 |
| DEC-SOC-007 | CONFIRMED | 개별 선택 공유는 사용자의 명시적 선택이 있을 때만 허용한다. | 예상치 못한 의견 공개를 막는다. | 02, 08 |
| DEC-SOC-008 | CONFIRMED | 공개 Profile은 Creator Profile 중심이며 작성 Issue와 품질을 보여준다. | 좋은 질문 생산을 보상한다. | 08 |
| DEC-SOC-009 | CONFIRMED | Creator Follow는 의견 동조가 아니라 질문 생산자를 팔로우하는 기능이다. | 진영 Follow를 피한다. | 08 |
| DEC-SOC-010 | CONFIRMED | Topic Follow는 명시적 관심사로 추천에 사용할 수 있다. | 사용자 제어형 추천 신호를 제공한다. | 08 |
| DEC-SOC-011 | DESIGN_BASELINE | MVP Reaction은 공감 1종으로 시작한다. | 분노·조롱 Reaction 증폭을 피한다. | 08 |
| DEC-SOC-012 | DESIGN_BASELINE | 댓글 랭킹은 공감 수 단독이 아니라 품질·안전·신선도·Side 다양성을 사용한다. | 다수 의견 독점을 줄인다. | 08 |
| DEC-SOC-013 | CONFIRMED | Creator Reputation은 내부 다축 신호이며 단일 공개 점수로 만들지 않는다. | 도덕 점수화와 조작을 피한다. | 08 |
| DEC-SOC-014 | PROHIBITED | DM, Group, 연락처 Import, Opinion Graph를 MVP에 포함하지 않는다. | 사람 중심 진영화와 안전 범위를 제한한다. | 08 |

## 모더레이션·정치·거버넌스
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-GOV-001 | CONFIRMED | WHICH는 의견 자체가 아니라 불법·피해·기만·조작·권리침해 행동을 관리한다. | 표현과 피해 행동을 구분한다. | 09 §3.1 |
| DEC-GOV-002 | CONFIRMED | 질문·Choice·Source·Vote·Comment·Recommendation Exposure를 연결된 거버넌스 대상으로 본다. | 질문 단계의 위험을 댓글 이후에만 처리하지 않는다. | 09 |
| DEC-GOV-003 | CONFIRMED | 게시 가능, 추천 가능, 댓글 가능, 결과 공개 가능은 독립 판단이다. | Remove 하나로 모든 위험을 처리하지 않는다. | 09 §5 |
| DEC-GOV-004 | CONFIRMED | 신고 수만으로 자동 삭제하지 않는다. | 조직적 신고와 반대 의견 억압을 방지한다. | 09 |
| DEC-GOV-005 | DESIGN_BASELINE | 명백한 중대 위반은 자동 제한할 수 있으나 맥락 의존 사건은 인간 검수를 거친다. | 속도와 오판 복구를 균형화한다. | 09 AI Moderation |
| DEC-GOV-006 | CONFIRMED | HIGH·RESTRICTED·대량 Vote 무효화·미성년자·개인정보는 인간 승인 대상이다. | 중대한 조치의 자동화 위험을 줄인다. | 09 |
| DEC-GOV-007 | CONFIRMED | 모든 주요 조치에 Policy Version, Reason, Evidence, Actor, 승인 체인을 기록한다. | 감사와 재현성을 보장한다. | 09 Audit |
| DEC-GOV-008 | CONFIRMED | 사용자에게 조치 사유와 Appeal 경로를 제공한다. | 오판 교정과 신뢰를 위해 필요하다. | 09 Notice |
| DEC-GOV-009 | CONFIRMED | Appeal 인용 시 콘텐츠·Count·Reputation·Feature·학습 Label까지 복구한다. | 부분 복구로 인한 지속 피해를 막는다. | 09 Restore |
| DEC-GOV-010 | CONFIRMED | 정치와 선거를 구분하며 선거 후보·정당·모의투표는 Election Policy로 격리한다. | 정치 일반 논의와 법률상 선거 기능을 구분한다. | 09 Politics |
| DEC-GOV-011 | CONFIRMED | 정치·선거 투표와 댓글은 MVP에서 비활성화한다. | 조작·법률·운영 위험이 핵심 MVP 가설이 아니기 때문이다. | 09 §28.3, 11 |
| DEC-GOV-012 | LEGAL_GATE | 선거 기능은 대한민국 관련 법률과 운영 의무 검토 전 활성화하지 않는다. | 비대표성 고지만으로 법적 의무가 사라진다고 볼 수 없다. | 09 §28.4 |
| DEC-GOV-013 | CONFIRMED | 정치 Choice를 Profile, 추천 성향, 정당·후보 지지 추론에 사용하지 않는다. | 정치적 견해 민감정보를 보호한다. | 09 §30 |
| DEC-GOV-014 | CONFIRMED | 유희성과 바이럴은 혐오·모욕·피해자 소비·허위 전제의 예외가 아니다. | 콘텐츠 성장 압력이 정책을 무력화하지 않게 한다. | 04, 09 |
| DEC-GOV-015 | PROHIBITED | 운영자가 Audit 없이 Production Count·상태를 직접 수정하지 않는다. | 조작·오류·책임 불명을 방지한다. | 09, 11 |

## 지표·실험
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-MET-001 | CONFIRMED | North Star는 Qualified Votes per Session과 Next Issue Rate를 함께 사용한다. | 참여 깊이와 연속성을 동시에 본다. | 10 §4 |
| DEC-MET-002 | CONFIRMED | Qualified Vote는 현재 유효한 ACCEPTED Vote다. | 집계와 제품 지표의 신뢰를 유지한다. | 10 |
| DEC-MET-003 | CONFIRMED | 핵심 Funnel은 Viewable Impression→Vote Submit→Accepted→Result View→Next→Second Vote다. | Core Loop를 직접 측정한다. | 10 |
| DEC-MET-004 | CONFIRMED | External First Vote, Time to First Vote, Deep-link Bounce를 전 실험 공통 Guardrail로 사용한다. | 온보딩·안전·소셜 기능이 유입을 해치지 않게 한다. | 10 |
| DEC-MET-005 | CONFIRMED | Prefetch와 Viewable Impression을 분리한다. | 추천 노출 편향과 학습 오류를 방지한다. | 10 |
| DEC-MET-006 | CONFIRMED | Vote Source of Truth는 Server Event다. | Client 시도와 정상 집계를 구분한다. | 10 |
| DEC-MET-007 | CONFIRMED | Issue·Vote·Recommendation·Moderation에 Version을 연결한다. | 변경과 회귀를 추적한다. | 10 |
| DEC-MET-008 | CONFIRMED | Engagement만 개선된 실험을 승격하지 않는다. | Safety·Integrity·Diversity·Privacy를 함께 보호한다. | 10 |
| DEC-MET-009 | DESIGN_BASELINE | Metric 정의는 Versioned Registry에서 분자·분모·제외·Owner를 관리한다. | 지표 정의 Drift를 방지한다. | 10 |
| DEC-MET-010 | CONFIRMED | 정치 Choice를 일반 BI Segment로 제공하지 않는다. | 민감 성향 분석을 차단한다. | 10 |
| DEC-MET-011 | PROHIBITED | 페이지뷰·댓글 수·분노를 단독 성공 지표로 사용하지 않는다. | 제품 가치를 잘못 최적화하지 않는다. | 10 |
| DEC-MET-012 | CONFIRMED | Prefetch·Vote Request·Review·Attack Traffic을 모델 학습에서 구분·격리한다. | Label 오염을 방지한다. | 07, 10 |

## MVP·로드맵
| Decision ID | 상태 | 결정 | 핵심 근거 | Source |
| --- | --- | --- | --- | --- |
| DEC-RM-001 | CONFIRMED | Data Architecture 전 1~13번 문서의 용어·불변조건·MVP 범위를 정합화한다. | 스키마가 기획 모순을 고정하지 않게 한다. | 11 Phase 0 |
| DEC-RM-002 | CONFIRMED | 공개 MVP 전 Internal Prototype, Editorial Alpha, Closed Alpha, External Alpha, Beta를 단계적으로 거친다. | 기능·데이터·운영 위험을 분리 검증한다. | 11 §2 |
| DEC-RM-003 | CONFIRMED | 정치·선거 Feature Flag는 Public MVP에서 Off다. | 별도 Legal·Verified·Election Gate가 필요하다. | 11 |
| DEC-RM-004 | DESIGN_BASELINE | 공개 UGC는 MVP 필수가 아니며 Beta Creator 제한 제출로 시작한다. | Issue 공급의 품질과 Moderation Capacity를 보호한다. | 11 §3.3 |
| DEC-RM-005 | CONFIRMED | ML v0는 MVP In, 학습 Ranker ML v1은 Post-MVP다. | 초기 데이터 부족과 운영 복잡성을 분리한다. | 07, 11 |
| DEC-RM-006 | CONFIRMED | 모든 Release는 기능 완료, 데이터 정합성, 안전 준비, Rollback을 함께 통과해야 한다. | 구현 완료를 출시 준비로 오해하지 않는다. | 11 §2.2 |
| DEC-RM-007 | CONFIRMED | No-Go 조건이 하나라도 있으면 Public MVP를 출시하지 않는다. | 핵심 신뢰 불변조건을 보호한다. | 11 §8 |
| DEC-RM-008 | CONFIRMED | 다음 기술 단계는 Data Architecture & Database Schema다. | 상세 제품 계약을 물리 모델로 전환한다. | 11 §15 |

# 3. Critical Decision Cards
## DEC-PROD-001 — WHICH를 설문조사 도구가 아니라 이슈 소비·이지선다 의견 플랫폼으로 정의한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | WHICH를 설문조사 도구가 아니라 이슈 소비·이지선다 의견 플랫폼으로 정의한다. |
| 이유 | 반복 소비와 결과·댓글 탐색이 핵심 가치이기 때문이다. |
| 주요 영향 | 브랜드, IA, 데이터 모델, KPI, 경쟁 포지셔닝 |
| 근거 | 01 §1, 초기 기획 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 긴 글·다중 선택보다 A/B의 단순성을 우선한다.
- 정교한 대표 조사 기능을 포기한다.

### Implementation Guardrail
- 새 기능은 질문→선택→결과→다음 루프 기여도를 설명해야 한다.

## DEC-UX-002 — 외부 Deep-link Guest를 Home이나 가입 화면으로 우회시키지 않는다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 외부 Deep-link Guest를 Home이나 가입 화면으로 우회시키지 않는다. |
| 이유 | 첫 투표 전환을 보호한다. |
| 주요 영향 | Deep-link routing, auth, onboarding, analytics |
| 근거 | 02 §3.3, 10 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 회원 전환 기회를 첫 화면에서 일부 포기한다.
- 비회원 데이터 연속성 한계를 수용한다.

### Implementation Guardrail
- 첫 PRE_VOTE 화면에서 auth_required가 발생하면 안 된다.

## DEC-UX-004 — First Value Moment는 첫 VOTE_ACCEPTED와 첫 RESULT_VIEW의 완료다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | First Value Moment는 첫 VOTE_ACCEPTED와 첫 RESULT_VIEW의 완료다. |
| 이유 | UX·실험의 공통 기준점을 만든다. |
| 주요 영향 | Activation funnel, experiment exposure, product copy |
| 근거 | 01 §12, 02 §1.3, 11 §1.4 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- First Vote 이전 수익화·온보딩 노출을 제한한다.

### Implementation Guardrail
- Activation 지표의 기준 Event는 Server Accepted와 Client Result View다.

## DEC-SUP-005 — 첫 ACCEPTED Vote 이후 질문과 A/B 핵심 의미를 변경하지 않는다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 첫 ACCEPTED Vote 이후 질문과 A/B 핵심 의미를 변경하지 않는다. |
| 이유 | 서로 다른 질문의 표가 하나로 집계되는 것을 막는다. |
| 주요 영향 | Issue versioning, vote foreign key, correction workflow |
| 근거 | 03 §2.7, 05 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 게시 후 편집 유연성을 줄이고 Successor 운영 비용을 수용한다.

### Implementation Guardrail
- issue_version의 locked_at을 Accepted Vote Transaction과 연결한다.

## DEC-TAX-004 — 초기 첫 피드는 유희·취향·생활 공감형 Experience Mode 비중을 높인다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 초기 첫 피드는 유희·취향·생활 공감형 Experience Mode 비중을 높인다. |
| 이유 | 인지 비용과 첫 참여 장벽을 낮춘다. |
| 주요 영향 | Seed inventory, cold-start feed, content operations |
| 근거 | 04 §2.3, 사용자 합의 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 초기 시사 전문성보다 접근성과 재미를 우선한다.

### Implementation Guardrail
- Playfulness가 Quality·Safety Hard Gate를 우회하지 않는다.

## DEC-TAX-007 — 논쟁은 최소 표본을 충족한 50:50 근접 접전이다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 논쟁은 최소 표본을 충족한 50:50 근접 접전이다. |
| 이유 | 분노·신고·댓글 과열과 구분한다. |
| 주요 영향 | Controversy score, feed eligibility, result copy |
| 근거 | 04, 사용자 확인 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 댓글 과열을 논쟁 지표로 사용하지 않아 일부 화제성을 놓칠 수 있다.

### Implementation Guardrail
- Minimum sample과 Integrity factor가 없으면 논쟁 Eligible이 아니다.

## DEC-ID-005 — Issue와 Voter Subject의 조합에 하나의 ACCEPTED Vote를 허용한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | Issue와 Voter Subject의 조합에 하나의 ACCEPTED Vote를 허용한다. |
| 이유 | MVP 중복 집계의 핵심 불변조건이다. |
| 주요 영향 | DB unique constraint, vote transaction, merge logic |
| 근거 | 05 Vote Contract |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 브라우저 삭제·다기기 중복을 완전히 막지 못한다.

### Implementation Guardrail
- DB와 Application 양쪽에서 Unique·Idempotency를 강제한다.

## DEC-ID-010 — 모든 사용자에게 CAPTCHA를 요구하지 않고 Risk-based Challenge를 사용한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 모든 사용자에게 CAPTCHA를 요구하지 않고 Risk-based Challenge를 사용한다. |
| 이유 | Guest 전환과 공격 비용을 함께 관리한다. |
| 주요 영향 | Risk engine, accessibility, guest conversion |
| 근거 | 05 Challenge |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 일부 위험 요청에 추가 마찰과 False Positive가 발생할 수 있다.

### Implementation Guardrail
- LOW Guest 일괄 CAPTCHA를 금지하고 접근성 대안을 둔다.

## DEC-PERS-002 — 외부 Guest 첫 투표 전 관심사 온보딩을 요구하지 않는다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 외부 Guest 첫 투표 전 관심사 온보딩을 요구하지 않는다. |
| 이유 | 외부 유입을 보호한다. |
| 주요 영향 | Prompt state, guest funnel, experiment guardrail |
| 근거 | 06 §3 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 초기 개인화 신호 수집이 늦어진다.

### Implementation Guardrail
- Prompt Exposure는 First Result 이후 Event로 제한한다.

## DEC-REC-004 — 출시 시점부터 Issue Embedding과 관심 Vector를 사용하는 ML v0를 적용한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 출시 시점부터 Issue Embedding과 관심 Vector를 사용하는 ML v0를 적용한다. |
| 이유 | 규칙 기반 임시 구조를 나중에 전면 교체하지 않는다. |
| 주요 영향 | embedding pipeline, feature schema, fallback |
| 근거 | 07 §13, 사용자 합의 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- Embedding 비용과 ML 운영 최소 복잡성을 초기부터 부담한다.

### Implementation Guardrail
- 모델 장애 시 Safe Fallback을 유지한다.

## DEC-REC-012 — 정치·선거는 일반 For You, 인기, 급상승, 논쟁, Exploration에 자동 진입하지 않는다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 정치·선거는 일반 For You, 인기, 급상승, 논쟁, Exploration에 자동 진입하지 않는다. |
| 이유 | 조직적 증폭과 법률 위험을 차단한다. |
| 주요 영향 | political eligibility, feed policies, analytics segregation |
| 근거 | 07 Politics |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 정치 콘텐츠의 높은 Engagement 기회를 포기한다.

### Implementation Guardrail
- political/election eligibility는 Default Deny다.

## DEC-SOC-006 — 본인의 전체 투표 기록은 기본 비공개다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 본인의 전체 투표 기록은 기본 비공개다. |
| 이유 | 민감 성향과 사생활을 보호한다. |
| 주요 영향 | profile API, privacy, deletion/export |
| 근거 | 08, 05 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 사회적 발견성과 프로필 풍부함을 일부 제한한다.

### Implementation Guardrail
- 공개 Profile API에 vote choice history endpoint를 만들지 않는다.

## DEC-GOV-004 — 신고 수만으로 자동 삭제하지 않는다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 신고 수만으로 자동 삭제하지 않는다. |
| 이유 | 조직적 신고와 반대 의견 억압을 방지한다. |
| 주요 영향 | report workflow, automod, human review |
| 근거 | 09 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 명백하지 않은 위반의 처리 속도가 느려질 수 있다.

### Implementation Guardrail
- Report count는 Queue priority 신호일 뿐 final action이 아니다.

## DEC-GOV-011 — 정치·선거 투표와 댓글은 MVP에서 비활성화한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | 정치·선거 투표와 댓글은 MVP에서 비활성화한다. |
| 이유 | 조작·법률·운영 위험이 핵심 MVP 가설이 아니기 때문이다. |
| 주요 영향 | feature flags, content pipeline, public scope |
| 근거 | 09 §28.3, 11 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 정치 관심 사용자와 단기 트래픽을 MVP에서 포기한다.

### Implementation Guardrail
- 정치 Feature Flag는 제한된 관리자만 변경한다.

## DEC-GOV-012 — 선거 기능은 대한민국 관련 법률과 운영 의무 검토 전 활성화하지 않는다.
| 필드 | 내용 |
| --- | --- |
| 상태 | LEGAL_GATE |
| 기록일 | 2026-08-18 |
| 결정 | 선거 기능은 대한민국 관련 법률과 운영 의무 검토 전 활성화하지 않는다. |
| 이유 | 비대표성 고지만으로 법적 의무가 사라진다고 볼 수 없다. |
| 주요 영향 | legal review, election mode, deployment gate |
| 근거 | 09 §28.4 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 법률 검토가 완료될 때까지 기능 개발 성과를 공개하지 못한다.

### Implementation Guardrail
- Legal approval artifact 없이는 activation impossible로 한다.

## DEC-GOV-009 — Appeal 인용 시 콘텐츠·Count·Reputation·Feature·학습 Label까지 복구한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | Appeal 인용 시 콘텐츠·Count·Reputation·Feature·학습 Label까지 복구한다. |
| 이유 | 부분 복구로 인한 지속 피해를 막는다. |
| 주요 영향 | lineage, audit, aggregate rebuild |
| 근거 | 09 Restore |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 복구 Lineage와 재계산 시스템의 구현 비용을 수용한다.

### Implementation Guardrail
- Restore job은 idempotent하고 derived data completion을 검증한다.

## DEC-MET-001 — North Star는 Qualified Votes per Session과 Next Issue Rate를 함께 사용한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | North Star는 Qualified Votes per Session과 Next Issue Rate를 함께 사용한다. |
| 이유 | 참여 깊이와 연속성을 동시에 본다. |
| 주요 영향 | executive dashboard, experiment decision, roadmap success |
| 근거 | 10 §4 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 하나의 단순 경영 점수 대신 두 지표를 함께 해석한다.

### Implementation Guardrail
- 두 North Star와 Guardrail을 같은 Review에서 본다.

## DEC-RM-004 — 공개 UGC는 MVP 필수가 아니며 Beta Creator 제한 제출로 시작한다.
| 필드 | 내용 |
| --- | --- |
| 상태 | DESIGN_BASELINE |
| 기록일 | 2026-08-18 |
| 결정 | 공개 UGC는 MVP 필수가 아니며 Beta Creator 제한 제출로 시작한다. |
| 이유 | Issue 공급의 품질과 Moderation Capacity를 보호한다. |
| 주요 영향 | creator UX, moderation capacity, issue supply |
| 근거 | 11 §3.3 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 사용자 생성 성장 속도보다 품질·운영 준비를 우선한다.

### Implementation Guardrail
- Beta Creator 제출은 Pre-moderation을 거친다.

## DEC-RM-005 — ML v0는 MVP In, 학습 Ranker ML v1은 Post-MVP다.
| 필드 | 내용 |
| --- | --- |
| 상태 | CONFIRMED |
| 기록일 | 2026-08-18 |
| 결정 | ML v0는 MVP In, 학습 Ranker ML v1은 Post-MVP다. |
| 이유 | 초기 데이터 부족과 운영 복잡성을 분리한다. |
| 주요 영향 | ML architecture, timeline, data readiness |
| 근거 | 07, 11 |
| 재검토 Trigger | 제품 가설 또는 법률·운영 조건이 materially 변경될 때 |

### 수용하는 Trade-off
- 초기부터 고급 Ranker를 제공하지 않는다.

### Implementation Guardrail
- ML v1은 Shadow→Canary→Experiment를 거친다.

# 4. Decision Conflict Reconciliation
| 충돌 지점 | 문제 | 통합 결정 | Decision |
| --- | --- | --- | --- |
| 초기 문서의 사용자 Issue 생성 vs Moderation 준비 | 모든 회원 공개 생성처럼 읽힐 수 있음 | 공개 MVP 핵심은 운영자 Pool이며 UGC는 승인 Beta Creator의 사전 검수 제출로 제한 | DEC-RM-004 |
| 정치 Verified Vote 가능성 vs MVP Safe Line | Verified Member라면 초기부터 허용 가능해 보임 | 정치·선거는 Verified 여부와 무관하게 MVP 비활성. 향후 별도 Gate | DEC-GOV-011, 012 |
| 관심사 3개 선택 vs Guest 즉시 투표 | 첫 진입 온보딩으로 오해 가능 | Guest First Value 이후 선택형 Prompt. 미선택 상태에서도 투표 가능 | DEC-PERS-001, 002 |
| 규칙 기반 추천 우선 vs 초기 ML 사용 선호 | 나중에 ML을 붙이는 구조로 보일 수 있음 | 출시부터 Embedding·Content Similarity ML v0, 학습 Ranker는 데이터 후 | DEC-REC-004, DEC-RM-005 |
| 논쟁과 갈등 | 댓글·신고 과열이 논쟁으로 보일 수 있음 | 논쟁은 최소 표본의 50:50 근접도이며 과열은 안전 신호 | DEC-TAX-007 |
| 댓글 Side 선택 | 댓글 작성자가 A/B를 직접 고르는 것으로 오해 가능 | Accepted Vote에서 서버 파생 | DEC-SOC-004 |
| 투표 기록과 개인 통계 | 통계 기능 때문에 공개될 수 있음 | 본인 전용 기록·통계이며 공개 Profile 집계 금지 | DEC-SOC-006 |
| 비회원 중복 방지와 1인 1표 | anonymous_id를 사람 인증으로 오해 가능 | 브라우저 단위 기본 방어이며 대표성·유일성 주장 금지 | DEC-ID-003, 014 |
| AI Moderation과 인간 승인 | AI가 자동 최종 판정하는 것으로 오해 가능 | AI는 분류·우선순위·명백한 제한 보조, 중대·맥락 사건은 인간 검수 | DEC-GOV-005, 006 |

# 5. Superseded·Deprecated History
## 5.1 현재 명시적으로 대체된 방향
| History ID | 이전 방향 | 상태 | 대체 Decision | 현재 방향 |
| --- | --- | --- | --- | --- |
| HIST-001 | 정치 Issue를 Verified Member에게 MVP부터 허용하는 초기 가능성 | SUPERSEDED | DEC-GOV-011 | MVP 정치·선거 전면 비활성 |
| HIST-002 | 공개 MVP에서 모든 Member의 즉시 Issue 생성 | SUPERSEDED | DEC-RM-004 | Beta Creator 사전 검수 |
| HIST-003 | 추천을 규칙 기반으로 시작하고 나중에 ML 구조로 교체 | SUPERSEDED | DEC-REC-004 | 출시부터 ML-ready·Embedding ML v0 |
| HIST-004 | 논쟁을 댓글 과열·신고·싸움이 많은 Issue로 해석 | SUPERSEDED | DEC-TAX-007 | 50:50 접전 |
| HIST-005 | 회원가입을 고정 투표 횟수에 반드시 노출 | DEPRECATED | DEC-UX-011 | Just-in-time 의도+빈도 제한, 정확 시점은 OPEN |

## 5.2 변경 이력 기록 예시
```yaml
decision_id: DEC-REC-004
revision: 2
status: CONFIRMED
recorded_at: 2026-08-18
change: "규칙 기반 임시 추천"에서 "Embedding 기반 ML v0"로 명확화
reason: 초기부터 ML-ready 구조를 선호한다는 사용자 결정
supersedes: HIST-003
sources:
  - 07_RECOMMENDATION_AND_ML_ARCHITECTURE_v2.md
  - user_design_direction
```
# 6. Prohibited Decision Register
| Decision ID | 금지 방향 | 이유 | Source |
| --- | --- | --- | --- |
| DEC-PROD-008 | A/B 의견 방향으로 사용자 진영 Graph를 만들지 않는다. | 정치·사회적 양극화와 성향 추적을 피한다. | 01, 06, 08, 09 |
| DEC-PROD-010 | 공식 여론조사·예측시장·도박형 제품으로 포지셔닝하지 않는다. | 제품·법률·신뢰 경계를 유지한다. | 01 §8 |
| DEC-UX-012 | 결과를 일부 숨기거나 가입해야 결과를 보게 하는 Dark Pattern을 사용하지 않는다. | 결과 보상과 신뢰를 훼손한다. | 02, 10 |
| DEC-SUP-010 | 저품질 후보를 재고 부족 때문에 긴급 자동 게시하지 않는다. | Issue Pool 고갈이 품질 Gate를 무력화하지 않게 한다. | 03 Pool Operations |
| DEC-SUP-011 | 기사 사진·SNS 캡처·영상 Frame을 기본 썸네일로 무단 재사용하지 않는다. | 권리·피해 위험을 줄인다. | 03 Media Policy |
| DEC-TAX-010 | 정답이 있는 사실 Quiz, 금전 Betting, 3개 이상 선택을 MVP Issue 형식으로 혼합하지 않는다. | A/B 의견 제품의 정체성을 유지한다. | 04 §15.2 |
| DEC-ID-014 | WHICH가 일반 Guest Vote에서 법적·현실적 1인 1표를 보장한다고 주장하지 않는다. | 인증 한계와 신뢰를 정확히 표현한다. | 05 |
| DEC-REC-014 | 오프라인 ML 지표만으로 모델을 Production 승격하지 않는다. | 제품·안전·Guest Guardrail을 함께 검증한다. | 07, 10 |
| DEC-SOC-014 | DM, Group, 연락처 Import, Opinion Graph를 MVP에 포함하지 않는다. | 사람 중심 진영화와 안전 범위를 제한한다. | 08 |
| DEC-GOV-015 | 운영자가 Audit 없이 Production Count·상태를 직접 수정하지 않는다. | 조작·오류·책임 불명을 방지한다. | 09, 11 |
| DEC-MET-011 | 페이지뷰·댓글 수·분노를 단독 성공 지표로 사용하지 않는다. | 제품 가치를 잘못 최적화하지 않는다. | 10 |

## 6.1 금지 방향 변경 절차
- [ ] 제품 비전 문서의 관련 원칙을 명시적으로 변경한다.
- [ ] 개인정보·정치·안전 영향 평가를 작성한다.
- [ ] 기존 사용자 데이터와 기능의 Migration 영향을 분석한다.
- [ ] Product, Governance, Privacy 책임자가 공동 승인한다.
- [ ] 실험으로 검증 가능한 문제인지 먼저 판단한다.
- [ ] 기존 금지 Decision을 SUPERSEDED로 남기고 신규 Decision을 만든다.

# 7. Open Decision 연결
미정 사항은 본 문서에서 결론을 추측하지 않는다. `11_MVP_ROADMAP_AND_OPEN_DECISIONS_v2.md`의 `OD-*` Register를 사용한다.
| 우선순위 | 대표 Open Decision | 결정 전 허용 Default |
| --- | --- | --- |
| P0 | 출시 시장·연령·Vote UX·보존·스택·Pool 규모·SLA | 기능 Flag Off 또는 교체 가능한 Config |
| P1 | Prompt 시점·Mix·Embedding·논쟁 표본·댓글 UX | Alpha·Beta 실험용 초기안 |
| P2 | 수익화·고급 ML·정치 출시·글로벌·미디어 | Public MVP 이후 보류 |

## 7.1 Open에서 Confirmed로 변경할 때
- [ ] Open Decision ID가 있다.
- [ ] 결정 방법과 자료가 기록돼 있다.
- [ ] 선택한 안과 버린 안의 Trade-off가 기록돼 있다.
- [ ] 영향 받는 문서·Schema·API·Metric가 식별돼 있다.
- [ ] 필요한 Migration과 Rollback이 있다.
- [ ] 새 Decision ID를 생성하거나 기존 Placeholder를 갱신한다.

# 8. Decision Traceability Matrix
| 제품 능력 | Decision | 기준 문서 | 후속 구현 |
| --- | --- | --- | --- |
| 외부 Guest 첫 투표 | DEC-UX-002, 003, 004, DEC-PERS-002, DEC-MET-004 | 02,05,06,10,11 | Routing, Auth, Prompt, Dashboard |
| 유희형 초기 Pool | DEC-SUP-009, DEC-TAX-004, 005, DEC-REC-011 | 03,04,06,07,10 | Editorial, Ranking, Metrics |
| 논쟁 50:50 | DEC-TAX-007, 008 | 04,07,10 | Eligibility, Score, UI |
| Issue 의미 잠금 | DEC-SUP-005, 006 | 03,05,09,13 | Version, Vote FK, Correction |
| Guest Vote Integrity | DEC-ID-003~013 | 05,10,11 | Vote Transaction, Risk, Aggregate |
| 관심사 Cold Start | DEC-PERS-001~010 | 06,07 | Interest Profile, Feed |
| ML v0 | DEC-REC-001~013, DEC-RM-005 | 07,10,11 | Embedding, Retrieval, Fallback |
| A/B 댓글·투표 비공개 | DEC-SOC-003~007 | 08,09 | Comment, Profile, Privacy |
| 정치·선거 Off | DEC-REC-012, DEC-GOV-010~013, DEC-RM-003 | 04~11 | Feature Flag, Data Separation |
| Appeal·Restore | DEC-GOV-007~009 | 05,08,09,10 | Audit, Recompute, User Notice |
| MVP 판단 | DEC-MET-001~012, DEC-RM-006~008 | 10,11 | Dashboard, Gate, No-Go |

# 9. Decision Review Cadence
| Review | 대상 | 빈도·Trigger | 산출물 |
| --- | --- | --- | --- |
| Product Decision Review | PROD·UX·MVP Open | Phase 시작·실험 종료 | Decision Revision |
| Editorial Policy Review | SUP·TAX | Category Drift·Source Incident | Quality·Taxonomy Version |
| Integrity Review | ID·Vote | Attack·False Challenge·Provider 변경 | Risk Policy Version |
| Model Review | REC·MET | 모델 승격·Drift·Rollback | Model Card·Decision |
| Governance Review | GOV·Privacy | 법률 변화·Appeal 오류·SEV Incident | Policy Revision |
| Launch Review | RM·All | Release 승격 전 | Go/No-Go Record |

## 9.1 Decision Owner 원칙
- 결정 Owner는 구현 담당자와 같을 필요가 없지만 승인 책임은 명확해야 한다.
- 정치·선거·민감정보 Decision은 Product만으로 승인하지 않는다.
- 모델·정책 Threshold는 Version Owner와 Rollback Owner를 함께 둔다.
- 사용자 권리에 중대한 영향을 주는 결정에는 Appeal·Restore Owner가 포함된다.
- Decision Owner가 바뀌어도 Decision ID는 유지한다.

# 10. Decision Log 완료 기준
- [ ] 1~11번 상세 기획의 핵심 확정·금지 원칙이 Decision ID로 등록됐다.
- [ ] 정치·선거 MVP 비활성 결정과 Legal Gate가 분리돼 있다.
- [ ] Guest 첫 투표 보호가 UX·관심사·추천·지표 결정에 연결됐다.
- [ ] 유희형 초기 콘텐츠 결정이 Supply·Taxonomy·Recommendation에 연결됐다.
- [ ] ML v0·ML v1 경계가 명시됐다.
- [ ] 투표 기록 비공개와 댓글 Side 파생 결정이 등록됐다.
- [ ] 신고·Appeal·Restore·Audit 결정이 등록됐다.
- [ ] 모순되던 초기 방향의 Reconciliation과 Superseded History가 있다.
- [ ] 미정 사항은 11번 Open Decision Register로 연결됐다.
- [ ] 13번 Glossary와 상태 모델이 Decision 용어를 동일하게 사용할 수 있다.

# 11. 최종 결정 원칙 요약
```text
질문이 사람보다 먼저
첫 가치는 가입보다 먼저
결과는 투표 뒤 즉시
재미는 피해 없이
논쟁은 분노가 아니라 접전
관심은 사용하되 의견 성향은 만들지 않음
ML은 사용하되 정책을 우회하지 않음
참여는 늘리되 조작은 증폭하지 않음
신고는 받되 숫자로 자동 판결하지 않음
정치는 MVP 성장 수단으로 사용하지 않음
오판은 설명하고 완전히 복구
모든 결정은 Version과 Audit로 추적
```
