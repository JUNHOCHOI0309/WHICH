export const OCR_PII_KINDS = ["EMAIL", "PHONE", "NATIONAL_ID", "ACCOUNT_LIKE"] as const;
export type OcrPiiKind = (typeof OCR_PII_KINDS)[number];

// Detection candidates only, never identity verification. Do not persist the input text.
export function detectOcrPiiKinds(raw: string): OcrPiiKind[] {
  const text = raw.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/gu, "");
  const kinds: OcrPiiKind[] = [];
  if (/\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\s*\.\s*[A-Z]{2,}\b/iu.test(text)) kinds.push("EMAIL");
  if (/(?<!\d)(?:0|\+82[- .]?)1[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)/u.test(text))
    kinds.push("PHONE");
  if (/(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)/u.test(text)) kinds.push("NATIONAL_ID");
  if (/(?<!\d)\d{2,6}[- ]\d{2,6}[- ]\d{2,6}(?!\d)/u.test(text)) kinds.push("ACCOUNT_LIKE");
  return kinds;
}
