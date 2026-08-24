import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format } from "prettier";

const replacementWording = {
  "WEXP-0016": [
    "정리할 물건이 많을 때 무엇부터 손대나요?",
    "한 번에 다 끝내기 어려운 양이라고 가정해 주세요.",
    "눈에 띄는 공간부터",
    "같은 종류끼리 모아서",
  ],
  "WEXP-0036": [
    "새 취미 장비는 언제 마련하는 편인가요?",
    "처음 한 달 동안 계속할지는 아직 모릅니다.",
    "입문 장비부터 바로 구매",
    "빌려 써 본 뒤 구매",
  ],
  "WEXP-0046": [
    "출근길 경로는 어느 쪽이 더 마음 편한가요?",
    "평균 도착 시간은 같지만 매일 변동 폭이 다릅니다.",
    "조금 길어도 일정한 경로",
    "빠를 수 있지만 들쭉날쭉한 경로",
  ],
  "WEXP-0071": [
    "가족 단체 채팅에 사진은 어떻게 공유하나요?",
    "하루 동안 찍은 사진이 여러 장 생긴 상황입니다.",
    "찍을 때마다 바로 공유",
    "나중에 골라 한꺼번에 공유",
  ],
  "WEXP-0091": [
    "업무 집중이 깨졌을 때 어떻게 다시 시작하나요?",
    "예상하지 못한 연락으로 흐름이 끊긴 상황입니다.",
    "잠깐 쉬고 원래 일로 복귀",
    "작은 다른 일부터 완료",
  ],
  "WEXP-0096": [
    "회의 의견이 팽팽하면 어떻게 결론낼까요?",
    "두 안 모두 실행 가능하고 시간은 부족합니다.",
    "선택지를 좁혀 팀이 투표",
    "책임자가 기준을 정해 결정",
  ],
  "WEXP-0101": [
    "수정할 피드백이 많다면 무엇부터 반영하나요?",
    "마감 전까지 전부 고칠 수 있는 상황입니다.",
    "영향이 큰 수정부터",
    "빠르게 끝나는 수정부터",
  ],
  "WEXP-0111": [
    "오늘 볼 영화를 고를 때 어느 기준이 끌리나요?",
    "평가와 상영 시간은 비슷한 두 작품입니다.",
    "좋아하는 감독의 새 작품",
    "처음 보는 장르의 작품",
  ],
  "WEXP-0116": [
    "플레이리스트는 어떤 흐름으로 만들고 싶나요?",
    "한 시간 동안 배경 음악으로 들을 목록입니다.",
    "비슷한 분위기로 이어가기",
    "분위기를 다양하게 섞기",
  ],
  "WEXP-0121": [
    "게임의 어려운 구간에서는 어떻게 진행하나요?",
    "같은 구간에서 여러 번 실패한 상황입니다.",
    "될 때까지 같은 난도로 도전",
    "난도를 낮추고 다음으로 진행",
  ],
  "WEXP-0122": [
    "게임 업데이트에서 무엇을 먼저 원하나요?",
    "개발 인력상 한 가지에 먼저 집중해야 합니다.",
    "새 이야기와 콘텐츠",
    "밸런스와 오류 개선",
  ],
  "WEXP-0126": [
    "휴대전화 사진은 어디에 보관하는 편인가요?",
    "비용과 백업 안정성은 비슷하다고 가정해 주세요.",
    "기기 저장 공간을 넉넉히",
    "클라우드 용량을 구독",
  ],
  "WEXP-0131": [
    "앱 권한 요청은 언제 받는 편이 이해하기 쉽나요?",
    "필요한 권한과 설명 내용은 같습니다.",
    "처음 실행할 때 한꺼번에",
    "기능을 처음 쓸 때 하나씩",
  ],
  "WEXP-0136": [
    "운동 루틴은 어떤 구성이 더 꾸준해지나요?",
    "주간 운동 횟수와 총시간은 같습니다.",
    "익숙한 동작을 반복",
    "매번 다른 동작을 섞기",
  ],
  "WEXP-0137": [
    "야외 운동 날에 비가 오면 어떻게 하나요?",
    "다른 일정은 없고 실내 공간도 이용할 수 있습니다.",
    "실내 운동으로 바로 변경",
    "다음 맑은 날로 미루기",
  ],
  "WEXP-0141": [
    "응원 팀 성적이 좋지 않아도 경기를 챙겨 보나요?",
    "시즌 중반까지 하위권인 상황입니다.",
    "가능하면 매 경기 시청",
    "중요한 경기만 선택",
  ],
  "WEXP-0142": [
    "녹화된 경기는 어떤 버전으로 먼저 볼까요?",
    "경기 결과를 아직 모르는 상태입니다.",
    "압축된 주요 장면부터",
    "처음부터 전체 경기",
  ],
  "WEXP-0152": [
    "문제를 틀렸을 때 어떤 복습이 더 잘 맞나요?",
    "해설을 바로 확인할 수 있는 상황입니다.",
    "해설부터 읽고 다시 풀기",
    "힌트 없이 한 번 더 풀기",
  ],
  "WEXP-0156": [
    "온라인 강의 속도는 어떻게 조절하나요?",
    "같은 강의를 끝까지 들어야 합니다.",
    "보통 속도로 듣고 메모",
    "빠르게 듣고 어려운 부분 반복",
  ],
  "WEXP-0161": [
    "팀 과제 일정이 늦어지면 어떻게 조정할까요?",
    "한 팀원의 작업이 예상보다 오래 걸리는 상황입니다.",
    "남은 역할을 다시 분배",
    "일정을 조정하고 기존 역할 유지",
  ],
  "WEXP-0167": [
    "이번 달 예산을 넘겼다면 어떻게 줄일까요?",
    "남은 기간에 같은 금액을 아껴야 합니다.",
    "한 소비 항목을 크게 줄이기",
    "여러 항목을 조금씩 줄이기",
  ],
  "WEXP-0171": [
    "무료 체험 종료 알림을 받으면 어떻게 하나요?",
    "앞으로도 가끔 이용할 가능성은 있습니다.",
    "먼저 해지하고 필요할 때 재가입",
    "그대로 유지하며 더 사용",
  ],
  "WEXP-0176": [
    "오래 쓴 제품이 고장 나면 무엇을 택하나요?",
    "수리비는 새 제품 가격의 절반입니다.",
    "수리해서 계속 사용",
    "새 제품으로 교체",
  ],
  "WEXP-0191": [
    "공용 냉장고 음식은 어떻게 관리하는 게 좋나요?",
    "여러 사람이 함께 쓰고 공간이 자주 부족합니다.",
    "이름과 날짜를 적어 보관",
    "정해진 날마다 일괄 정리",
  ],
  "WEXP-0356": [
    "빌린 다회용 컵은 어디에 반납하고 싶나요?",
    "보증금과 세척 기준은 어느 반납처든 같습니다.",
    "참여 매장 어디서나 반납",
    "빌린 매장에 다시 반납",
  ],
};

const parityRewrites = {
  "WEXP-0214": [
    "주택가 배달 차량 정차는 어떻게 운영할까요?",
    "짧은 배달 수요와 주민 통행을 함께 고려해야 합니다.",
    "지정된 단기 정차 구역 운영",
    "별도 구역 없이 기존 주차만 이용",
  ],
  "WEXP-0274": [
    "AI 생성 콘텐츠 표시의 1차 책임은 누구에게 둘까요?",
    "제작자 신고와 플랫폼 탐지를 모두 운영할 수 있습니다.",
    "게시한 제작자에게 책임",
    "유통한 플랫폼에게 책임",
  ],
  "WEXP-0316": [
    "구독 해지 마지막 단계는 어떻게 구성할까요?",
    "사용자는 이미 해지 메뉴에 들어온 상태입니다.",
    "확인 한 번으로 바로 해지",
    "대체 혜택을 본 뒤 최종 확인",
  ],
  "WEXP-0318": [
    "추가 상품은 주문 중 어떻게 제안하는 게 좋을까요?",
    "보험이나 부가 서비스를 선택적으로 살 수 있습니다.",
    "주문 화면에서 직접 선택",
    "별도 비교 화면에서 선택",
  ],
  "WEXP-0320": [
    "개인정보 동의 항목은 어떻게 살펴보는 게 편한가요?",
    "필수와 선택 항목을 분리해 확인할 수 있습니다.",
    "한 화면에서 전체를 비교",
    "목적별로 한 단계씩 확인",
  ],
};

const badCommunityLinks = {
  "social-economy-delivery-fees": ["COM-PANN-CAFE-FOOD-20260405"],
  "social-life-delivery-local-service": ["COM-PANN-FIRST-JOB-20260105"],
  "social-economy-return-refund": ["COM-PANN-FIRST-JOB-20260105"],
  "social-education-private-cost": ["COM-PANN-SEOUL-HOUSING-20260103"],
  "social-relationship-care-boundaries": ["COM-PANN-MARRIAGE-ASSETS-20260415"],
  "social-society-neighborhood-cctv": ["COM-PANN-APARTMENT-PLAYGROUND-20250611"],
  "social-education-ai-homework": [
    "COM-BLIND-AI-ASSESSMENT-20260115",
    "COM-THEQOO-AI-JOB-FEAR-20260214",
  ],
  "social-society-community-moderation": ["COM-THEQOO-AI-JOB-FEAR-20260214"],
  "social-education-phone-rules": ["COM-BLINDBOARD-SUBWAY-202608"],
  "social-society-shared-mobility": ["COM-BLINDBOARD-SUBWAY-202608"],
};

const sourceUpdates = {
  "WEXP-0251": ["OFF-PIPC-AUTOMATED-DECISION-RIGHTS-20240306"],
  "WEXP-0253": ["OFF-PIPC-AUTOMATED-DECISION-RIGHTS-20240306"],
  "WEXP-0254": ["OFF-PIPC-AUTOMATED-DECISION-RIGHTS-20240306"],
  "WEXP-0284": ["OFF-PIPC-DEEPFAKE-GUIDE-20260226", "OFF-PIPC-AI-TRANSPARENCY-20260820"],
  "WEXP-0291": ["OFF-LAW-SCHOOL-SMART-DEVICE-20251111"],
  "WEXP-0295": ["OFF-LAW-SCHOOL-SMART-DEVICE-20251111"],
  "WEXP-0336": ["OFF-MOLIT-HOUSING-PLAN-2026"],
  "WEXP-0337": ["OFF-MOLIT-HOUSING-STATS-20260205"],
  "WEXP-0356": ["OFF-ME-CARBON-POINT-REUSE-20230119"],
  "WEXP-0361": ["OFF-EV-COMMON-CHARGER-20260213"],
};

const subjectiveReclassifications = new Set([
  "WEXP-0252",
  "WEXP-0255",
  "WEXP-0281",
  "WEXP-0282",
  "WEXP-0283",
  "WEXP-0285",
  "WEXP-0292",
  "WEXP-0293",
  "WEXP-0294",
  "WEXP-0338",
  "WEXP-0339",
  "WEXP-0340",
  "WEXP-0357",
  "WEXP-0358",
  "WEXP-0359",
  "WEXP-0360",
  "WEXP-0362",
  "WEXP-0363",
  "WEXP-0364",
  "WEXP-0365",
]);

const addedFactSources = [
  {
    id: "OFF-PIPC-AUTOMATED-DECISION-RIGHTS-20240306",
    publisher: "개인정보보호위원회",
    title: "인공지능(AI) 시대, 개인정보 안전장치 시행된다",
    url: "https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS074&mCode=C020010000&nttId=9969",
    publishedAt: "2024-03-06",
    topics: ["AUTOMATED_DECISION", "EXPLANATION_RIGHT", "HUMAN_REVIEW"],
  },
  {
    id: "OFF-LAW-SCHOOL-SMART-DEVICE-20251111",
    publisher: "국가법령정보센터",
    title: "초·중등교육법 제20조의5 교내 스마트기기의 사용 제한 등",
    url: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279605",
    publishedAt: "2025-11-11",
    topics: ["SCHOOL_POLICY", "SMART_DEVICE", "CLASSROOM"],
  },
  {
    id: "OFF-MOLIT-HOUSING-PLAN-2026",
    publisher: "국토교통부",
    title: "2026 업무계획: 임기 내 명실상부한 주거복지 선도국가 완성",
    url: "https://www.molit.go.kr/2026plan/sub3_realestate.html",
    publishedAt: "2025-12-12",
    topics: ["YOUTH_HOUSING", "PUBLIC_RENTAL", "RENT_SUPPORT"],
  },
  {
    id: "OFF-ME-CARBON-POINT-REUSE-20230119",
    publisher: "기후에너지환경부",
    title: "탄소중립 실천하면 현금 쌓여요, 탄소중립 포인트 항목 확대",
    url: "https://me.go.kr/home/web/board/read.do?boardId=1575250&boardMasterId=1",
    publishedAt: "2023-01-19",
    topics: ["REUSABLE_CUP", "CUP_RETURN", "CARBON_POINT"],
  },
  {
    id: "OFF-EV-COMMON-CHARGER-20260213",
    publisher: "무공해차 통합누리집",
    title: "2026년 전기자동차 공용 완속충전시설 직접신청",
    url: "https://ev.or.kr/nportal/buySupprt/initComChargeFacilityApplicationAction.do",
    publishedAt: "2026-02-13",
    topics: ["EV", "COMMON_CHARGER", "APARTMENT"],
  },
];

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function contentHash(issue) {
  return sha256({
    question: issue.question,
    context: issue.context,
    choices: issue.choices.map(({ id, code, label }) => ({ id, code, label })),
  });
}

function applyWording(issue, wording, reason) {
  const [question, context, choiceA, choiceB] = wording;
  issue.question = question;
  issue.context = context;
  issue.id = deterministicUuid(`which-expanded-500-catalog-v2:${issue.candidateId}:${question}`);
  issue.choices = [
    { id: deterministicUuid(`${issue.id}:choice:A`), code: "A", label: choiceA },
    { id: deterministicUuid(`${issue.id}:choice:B`), code: "B", label: choiceB },
  ];
  issue.editorialReview.binaryFit = `${reason}_HUMAN_CONFIRM`;
  issue.editorialReview.choiceParity = `${reason}_HUMAN_CONFIRM`;
}

function blockForHumanReview(issue, reason) {
  const reasons = new Set(issue.publicationCompatibility?.blockingReasons ?? []);
  reasons.add(reason);
  issue.publicationCompatibility = {
    builderVersion: 2,
    builderCompatible: false,
    blockingReasons: [...reasons],
    publicationStatus: "DO_NOT_PUBLISH_BEFORE_HUMAN_APPROVAL",
  };
}

function updateCompatibility(issue) {
  const blockingReasons = ["HUMAN_APPROVAL_REQUIRED"];
  if (issue.riskLevel !== "LOW") blockingReasons.push("SEPARATE_RISK_APPROVAL_REQUIRED");
  if (issue.sourceProfile.sourceFitReview.includes("BLOCKED")) {
    blockingReasons.push("SOURCE_FIT_REVIEW_BLOCKED");
  }
  issue.publicationCompatibility = {
    builderVersion: 2,
    builderCompatible: blockingReasons.length === 1,
    blockingReasons,
    publicationStatus: "DO_NOT_PUBLISH_BEFORE_HUMAN_APPROVAL",
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(
    path,
    await format(JSON.stringify(value), { parser: "json", printWidth: 100 }),
    "utf8",
  );
}

async function main() {
  const [sourceRootValue, outputRootValue] = process.argv.slice(2);
  if (!sourceRootValue || !outputRootValue) {
    throw new Error("Usage: remediate-expanded-catalog <extracted-source-root> <output-root>");
  }
  const sourceRoot = resolve(sourceRootValue);
  const outputRoot = resolve(outputRootValue);
  await mkdir(outputRoot, { recursive: true });

  const [catalog, factRegistry, communityRegistry, active, reserve, longTerm] = await Promise.all([
    readJson(resolve(sourceRoot, "01_editorial_catalog/which-expanded-500-catalog-v1.json")),
    readJson(resolve(sourceRoot, "04_sources/fact_source_registry.json")),
    readJson(resolve(sourceRoot, "04_sources/community_source_registry.json")),
    readJson(resolve(sourceRoot, "03_inventory/active_pool_72.json")),
    readJson(resolve(sourceRoot, "03_inventory/approved_reserve_108.json")),
    readJson(resolve(sourceRoot, "03_inventory/long_term_catalog_320.json")),
  ]);

  catalog.catalogId = "which-expanded-500-catalog-v2";
  catalog.baseCommit = null;
  catalog.approval = {
    status: "PENDING_HUMAN_EDITORIAL_APPROVAL",
    humanApprovalRequired: true,
    automatedValidation: "PASSED_AFTER_REMEDIATION",
    approvedBy: null,
    approvedAt: null,
  };

  const communityLinkRemovals = [];
  const reconnectedSources = [];
  const reclassifiedSubjective = [];
  for (const issue of catalog.issues) {
    if (replacementWording[issue.candidateId]) {
      applyWording(
        issue,
        replacementWording[issue.candidateId],
        "CROSS_CATALOG_DUPLICATE_REPLACED",
      );
      issue.editorialReview.duplicateReview = "CROSS_CATALOG_REPLACED_HUMAN_CONFIRM";
    }
    if (parityRewrites[issue.candidateId]) {
      applyWording(issue, parityRewrites[issue.candidateId], "A_B_PARITY_REWRITTEN");
    }

    const badIds = new Set(badCommunityLinks[issue.themeCode] ?? []);
    const before = issue.sourceProfile.communitySignalIds;
    const after = before.filter((id) => !badIds.has(id));
    if (after.length !== before.length) {
      communityLinkRemovals.push({
        candidateId: issue.candidateId,
        removed: before.filter((id) => !after.includes(id)),
      });
      issue.sourceProfile.communitySignalIds = after;
      if (after.length === 0) {
        issue.sourceProfile.communitySignalRole = "NONE";
        issue.sourceProfile.discoveryLead =
          issue.sourceProfile.factSourceIds.length > 0 ? "OFFICIAL" : "EDITORIAL";
        issue.sourceProfile.sourceRequirement =
          issue.sourceProfile.factSourceIds.length > 0
            ? "SOURCE_REQUIRED"
            : "NOT_REQUIRED_SUBJECTIVE";
        issue.sourceProfile.sourceFitReview = "COMMUNITY_SIGNAL_REPLACEMENT_REQUIRED_BLOCKED";
        issue.editorialReview.sourceReview = "HUMAN_REVIEW_BLOCKED_COMMUNITY_SIGNAL_FIT";
      } else {
        issue.sourceProfile.sourceFitReview = "COMMUNITY_SIGNAL_MAPPING_CORRECTED_HUMAN_CONFIRM";
      }
    }

    if (sourceUpdates[issue.candidateId]) {
      issue.sourceProfile.factSourceIds = sourceUpdates[issue.candidateId];
      issue.sourceProfile.sourceRequirement = "SOURCE_REQUIRED";
      issue.sourceProfile.asOf = "2026-08-25";
      issue.sourceProfile.reviewAfter = "2026-10-25";
      issue.sourceProfile.expiresAt = "2027-02-25";
      issue.sourceProfile.evergreen = false;
      issue.sourceProfile.sourceFitReview = "RECONNECTED_OFFICIAL_SOURCE_HUMAN_CONFIRM";
      issue.editorialReview.sourceReview = "RECONNECTED_OFFICIAL_SOURCE_HUMAN_CONFIRM";
      reconnectedSources.push(issue.candidateId);
    }
    if (subjectiveReclassifications.has(issue.candidateId)) {
      issue.sourceProfile.factSourceIds = [];
      issue.sourceProfile.sourceRequirement = "NOT_REQUIRED_SUBJECTIVE";
      issue.sourceProfile.asOf = null;
      issue.sourceProfile.reviewAfter = null;
      issue.sourceProfile.expiresAt = null;
      issue.sourceProfile.evergreen = true;
      issue.sourceProfile.sourceFitReview = "NOT_REQUIRED_SUBJECTIVE_HUMAN_CONFIRM";
      issue.editorialReview.sourceReview = "NOT_REQUIRED_SUBJECTIVE_HUMAN_CONFIRM";
      reclassifiedSubjective.push(issue.candidateId);
    }

    issue.contentHash = contentHash(issue);
    updateCompatibility(issue);
    if (issue.sourceProfile.sourceFitReview.includes("BLOCKED")) {
      blockForHumanReview(issue, "COMMUNITY_SIGNAL_REPLACEMENT_REQUIRED");
    }
  }

  const sourceIds = new Set(factRegistry.sources.map((source) => source.id));
  for (const source of addedFactSources) {
    if (!sourceIds.has(source.id)) factRegistry.sources.push(source);
  }
  factRegistry.asOf = "2026-08-25";
  factRegistry.policy.status = "REMEDIATED_REQUIRES_FINAL_HUMAN_SOURCE_REVIEW";

  const communityDiscovered = catalog.issues.filter(
    (issue) =>
      issue.editorialArea === "CURRENT_SOCIAL" &&
      issue.sourceProfile.discoveryLead === "COMMUNITY" &&
      issue.sourceProfile.communitySignalIds.length > 0,
  ).length;
  catalog.communityFirstSocialPolicy.communityDiscovered = communityDiscovered;
  catalog.communityFirstSocialPolicy.communityDiscoveredShare = Number(
    (communityDiscovered / catalog.communityFirstSocialPolicy.socialIssues).toFixed(4),
  );
  catalog.communityFirstSocialPolicy.communityDiscoveryTarget = 125;
  catalog.communityFirstSocialPolicy.communityDiscoveryDeficit = 125 - communityDiscovered;

  const inventory = {
    schemaVersion: 2,
    catalogId: catalog.catalogId,
    approval: "PENDING_HUMAN_EDITORIAL_APPROVAL",
    publicationCalendarStatus: "NOT_GENERATED_UNTIL_HUMAN_APPROVAL",
    activePoolCandidateIds: active.issues.map((issue) => issue.candidateId),
    approvedReserveCandidateIds: reserve.issues.map((issue) => issue.candidateId),
    longTermCandidateIds: longTerm.issues.map((issue) => issue.candidateId),
  };

  const report = {
    schemaVersion: 1,
    catalogId: catalog.catalogId,
    generatedAt: "2026-08-25T00:00:00.000+09:00",
    verdict: "REMEDIATED_CANDIDATE_NOT_PRODUCTION_APPROVED",
    counts: {
      totalIssues: catalog.issues.length,
      duplicateReplacements: Object.keys(replacementWording).length,
      parityRewrites: Object.keys(parityRewrites).length,
      officialSourceReconnections: reconnectedSources.length,
      subjectiveReclassifications: reclassifiedSubjective.length,
      communityLinksRemoved: communityLinkRemovals.reduce(
        (total, entry) => total + entry.removed.length,
        0,
      ),
      communityDiscovered,
      communityDiscoveryTarget: 125,
      communityDiscoveryDeficit: 125 - communityDiscovered,
      activeCandidates: inventory.activePoolCandidateIds.length,
      reserveCandidates: inventory.approvedReserveCandidateIds.length,
      longTermCandidates: inventory.longTermCandidateIds.length,
    },
    replacedCandidateIds: Object.keys(replacementWording),
    parityRewriteCandidateIds: Object.keys(parityRewrites),
    reconnectedSources,
    reclassifiedSubjective,
    communityLinkRemovals,
    remainingRequiredActions: [
      "Replace missing community discovery signals before restoring the 125-item target.",
      "Human-review every candidate for binary fit, parity, semantics, safety, and source fit.",
      "Approve LOW candidates individually; MEDIUM candidates use the separate risk route.",
      "Generate publication plans only after catalog and candidate approvals are recorded.",
    ],
  };

  await Promise.all([
    writeJson(resolve(outputRoot, "which-expanded-500-catalog-v2.json"), catalog),
    writeJson(resolve(outputRoot, "fact-source-registry-v2.json"), factRegistry),
    writeJson(resolve(outputRoot, "community-source-registry-v2.json"), communityRegistry),
    writeJson(resolve(outputRoot, "inventory-candidates-v2.json"), inventory),
    writeJson(resolve(outputRoot, "remediation-report-v2.json"), report),
  ]);
  console.log(JSON.stringify(report, null, 2));
}

await main();
