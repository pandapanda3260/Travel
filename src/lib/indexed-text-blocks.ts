export type IndexedTextBlock = {
  label: string;
  index: number;
  rawIndex: number;
  subIndex: number | null;
  text: string;
};

const indexedTextBlockPattern = /(片段|镜头|音频|字幕|旁白)\s*(\d+)(?:\s*-\s*镜头\s*(\d+))?\s*[.．、:：]?\s*/g;

export function parseIndexedTextBlocks(text: string, fallbackCount: number, defaultLabel = "镜头"): IndexedTextBlock[] {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return [];
  }

  const matches = Array.from(normalized.matchAll(indexedTextBlockPattern));
  if (matches.length === 0) {
    const lines = normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return Array.from({ length: Math.max(1, fallbackCount) }, (_, index) => ({
      label: defaultLabel,
      index: index + 1,
      rawIndex: index + 1,
      subIndex: null,
      text: lines[index] ?? lines[0] ?? normalized,
    }));
  }

  return matches.map((match, matchIndex) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[matchIndex + 1]?.index ?? normalized.length;
    const rawIndex = Number(match[2]) || matchIndex + 1;
    const subIndex = match[3] ? Number(match[3]) || null : null;

    return {
      label: match[1] || defaultLabel,
      index: subIndex == null ? rawIndex : matchIndex + 1,
      rawIndex,
      subIndex,
      text: normalized.slice(start, end).trim(),
    };
  });
}

export function buildIndexedBlockText(label: string, blocks: Array<{ index: number; text: string }>) {
  return blocks.map((block) => `${label}${block.index}：${block.text.trim()}`).join("\n");
}
