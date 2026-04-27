const VISUAL_SUBTITLE_KEYS = ["画面字幕", "屏幕字幕", "字幕/文案", "字幕文案", "字幕文本", "字幕"];

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function linesFromValue(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap(linesFromValue);
  }
  return [];
}

function collectDirectSubtitleLines(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  for (const key of VISUAL_SUBTITLE_KEYS) {
    const lines = linesFromValue(record[key]);
    if (lines.length > 0) {
      return lines;
    }
  }

  return [];
}

function pushLines(target: string[], lines: string[]) {
  for (const line of lines) {
    if (line) {
      target.push(line);
    }
  }
}

export function extractVisualSubtitleLinesFromAnalysis(analysisJson: string | null | undefined): string[] {
  if (!analysisJson?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(analysisJson);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const root = parsed as Record<string, unknown>;
  const lines: string[] = [];
  pushLines(lines, collectDirectSubtitleLines(root["开篇设计"]));

  const shots = root["镜头序列"];
  if (Array.isArray(shots)) {
    for (const shot of shots) {
      pushLines(lines, collectDirectSubtitleLines(shot));
    }
  }

  pushLines(lines, collectDirectSubtitleLines(root["结尾设计"]));

  return lines;
}
