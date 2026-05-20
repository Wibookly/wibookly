// Extract plain text from common uploaded file types for inline AI context.
// Supports PDF, DOCX, TXT/MD/CSV/JSON, and other text mimes.
export async function extractAttachmentText(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  const lower = (filename || "").toLowerCase();
  const m = (mime || "").toLowerCase();

  if (m.startsWith("text/") || m === "application/json" ||
      lower.endsWith(".txt") || lower.endsWith(".md") ||
      lower.endsWith(".csv") || lower.endsWith(".json") ||
      lower.endsWith(".log") || lower.endsWith(".xml") ||
      lower.endsWith(".html") || lower.endsWith(".htm")) {
    return new TextDecoder().decode(bytes);
  }

  if (m === "application/pdf" || lower.endsWith(".pdf")) {
    const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
    const data = await pdfParse(bytes);
    return data.text || "";
  }

  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx")) {
    const mammoth = await import("npm:mammoth@1.8.0");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value || "";
  }

  if (m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      m === "application/vnd.ms-excel" ||
      lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("npm:xlsx@0.18.5");
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      parts.push(`# Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(sheet));
    }
    return parts.join("\n\n");
  }

  // PPTX (PowerPoint)
  if (m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      lower.endsWith(".pptx")) {
    const JSZip = (await import("npm:jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(bytes);
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort();
    const parts: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.files[name].async("string");
      const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text) parts.push(`# ${name.split("/").pop()}\n${text}`);
    }
    return parts.join("\n\n");
  }

  // Legacy .doc (best-effort: extract printable ASCII)
  if (m === "application/msword" || lower.endsWith(".doc")) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return raw.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  // RTF
  if (m === "application/rtf" || lower.endsWith(".rtf")) {
    const raw = new TextDecoder().decode(bytes);
    return raw.replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  }

  // Unknown binary: try to salvage embedded ASCII text rather than failing outright.
  // This lets the AI still see *something* for unusual attachment types.
  try {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const printable = raw.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ").replace(/\s{2,}/g, " ").trim();
    if (printable.length > 200) {
      return `[Best-effort text extraction from ${mime || "unknown"} (${filename}). Format not fully supported — content may be incomplete.]\n\n${printable.slice(0, 100000)}`;
    }
  } catch { /* fall through */ }

  throw new Error(`Unsupported attachment type: ${mime || "unknown"} (${filename})`);
}
