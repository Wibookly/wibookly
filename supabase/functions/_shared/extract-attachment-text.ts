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

  throw new Error(`Unsupported attachment type: ${mime || "unknown"} (${filename})`);
}
