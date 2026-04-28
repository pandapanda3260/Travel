export type VisualImageCandidateQualityCopyInput = {
  qualityStatus?: string | null;
  qualityIssues?: readonly string[] | null;
  qualitySummary?: string | null;
  scoreLabel?: string | null;
  scoreReasons?: readonly string[] | null;
};

const REGENERATE_LABEL = "建议重生";
const ISSUE_PREFIX = "问题：";

function normalizeReasonText(reason: string) {
  return reason.replace(new RegExp(`^${ISSUE_PREFIX}\\s*`, "u"), "").trim();
}

export function buildVisualImageCandidateRegenerationReasons(
  candidate: VisualImageCandidateQualityCopyInput,
  limit = 3,
) {
  const seen = new Set<string>();
  const reasons: string[] = [];
  const addReason = (reason: string | null | undefined) => {
    const normalized = normalizeReasonText(reason ?? "");
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    reasons.push(normalized);
  };

  addReason(candidate.qualitySummary);
  for (const issue of candidate.qualityIssues ?? []) {
    addReason(issue);
  }
  for (const reason of candidate.scoreReasons ?? []) {
    if (reason.includes("视觉自检") || reason.startsWith(ISSUE_PREFIX)) {
      addReason(reason);
    }
  }

  return reasons.slice(0, Math.max(1, limit));
}

export function shouldShowVisualImageCandidateRegenerationReason(candidate: VisualImageCandidateQualityCopyInput) {
  return candidate.qualityStatus === "failed" || candidate.scoreLabel === REGENERATE_LABEL;
}
