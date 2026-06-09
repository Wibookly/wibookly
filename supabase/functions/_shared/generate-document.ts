// Generate a DOCX (and optionally PDF) from markdown-ish content,
// upload to the user's OneDrive "InboxIQ Chat" folder, and return links.
//
// - DOCX is built with the `docx` npm library (works in Deno via esm.sh).
// - PDF is produced by Microsoft Graph's built-in conversion
//   (GET /me/drive/items/{id}/content?format=pdf), then re-uploaded so the
//   user has BOTH files saved in OneDrive with a public-ish webUrl.
// deno-lint-ignore-file no-explicit-any
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
} from "https://esm.sh/docx@8.5.0";
import { getValidAccessToken } from "./oauth-tokens.ts";
import { saveToOneDrive } from "./onedrive-save.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

interface GenOpts {
  userId: string;
  connectionId: string;
  title: string;
  /** Markdown-ish content. Headings (#, ##, ###), bullets (- / *), numbered lists, blank-line paragraphs. */
  content: string;
  /** "docx" | "pdf" | "both" (default both) */
  format?: "docx" | "pdf" | "both";
  subfolder?: string;
}

export interface GenResult {
  ok: boolean;
  docx?: { path?: string; webUrl?: string };
  pdf?: { path?: string; webUrl?: string };
  error?: string;
}

function mdToParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  let buf: string[] = [];

  const flushPara = () => {
    if (!buf.length) return;
    const text = buf.join(" ").trim();
    buf = [];
    if (!text) return;
    out.push(new Paragraph({ children: parseInline(text) }));
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      const text = h[2].trim();
      const heading = [
        HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
      ][Math.min(level - 1, 5)];
      out.push(new Paragraph({ heading, children: parseInline(text) }));
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      out.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(bullet[1]) }));
      continue;
    }

    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      flushPara();
      out.push(new Paragraph({
        children: parseInline(num[1]),
        // simple numbered look without a numbering definition
      }));
      continue;
    }

    buf.push(line);
  }
  flushPara();
  return out;
}

function parseInline(text: string): TextRun[] {
  // Handle **bold** and *italic* minimally.
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIdx = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > lastIdx) {
      runs.push(new TextRun({ text: text.slice(lastIdx, m.index) }));
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      runs.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    } else {
      runs.push(new TextRun({ text: tok.slice(1, -1), italics: true }));
    }
    lastIdx = m.index! + tok.length;
  }
  if (lastIdx < text.length) runs.push(new TextRun({ text: text.slice(lastIdx) }));
  return runs.length ? runs : [new TextRun({ text })];
}

async function buildDocx(title: string, content: string): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: title, bold: true })],
        }),
        ...mdToParagraphs(content),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

async function findUploadedItemId(token: string, path: string): Promise<string | null> {
  // path is like "/InboxIQ Chat/<sub>/Name.docx"
  const trimmed = path.replace(/^\//, "");
  const url = `${GRAPH}/me/drive/root:/${encodeURI(trimmed)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j?.id ?? null;
}

export async function generateDocument(opts: GenOpts): Promise<GenResult> {
  const fmt = opts.format ?? "both";
  const wantDocx = fmt === "docx" || fmt === "both";
  const wantPdf = fmt === "pdf" || fmt === "both";

  let token: string | null = null;
  try { token = await getValidAccessToken(opts.userId, "outlook", opts.connectionId); }
  catch { return { ok: false, error: "Microsoft 365 token unavailable. Reconnect from Integrations." }; }
  if (!token) return { ok: false, error: "Microsoft 365 token unavailable. Reconnect from Integrations." };

  let docxBytes: Uint8Array | null = null;
  let docxRes: { path?: string; webUrl?: string } | undefined;
  let pdfRes:  { path?: string; webUrl?: string } | undefined;

  try {
    docxBytes = await buildDocx(opts.title, opts.content);
  } catch (e) {
    return { ok: false, error: `DOCX build failed: ${(e as Error).message}` };
  }

  // Always upload the DOCX (needed for Graph PDF conversion).
  const upload = await saveToOneDrive({
    userId: opts.userId,
    connectionId: opts.connectionId,
    baseName: opts.title,
    ext: "docx",
    content: docxBytes,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    subfolder: opts.subfolder,
    overwrite: false,
  });
  if (!upload.ok) return { ok: false, error: `OneDrive upload failed: ${upload.error}` };
  if (wantDocx) docxRes = { path: upload.path, webUrl: upload.webUrl };

  if (wantPdf && upload.path) {
    try {
      const itemId = await findUploadedItemId(token, upload.path);
      if (!itemId) throw new Error("uploaded item not found");
      const pdfRespUrl = `${GRAPH}/me/drive/items/${itemId}/content?format=pdf`;
      const pdfResp = await fetch(pdfRespUrl, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (!pdfResp.ok) throw new Error(`Graph pdf convert ${pdfResp.status}`);
      const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
      const pdfUp = await saveToOneDrive({
        userId: opts.userId,
        connectionId: opts.connectionId,
        baseName: opts.title,
        ext: "pdf",
        content: pdfBytes,
        contentType: "application/pdf",
        subfolder: opts.subfolder,
        overwrite: false,
      });
      if (pdfUp.ok) pdfRes = { path: pdfUp.path, webUrl: pdfUp.webUrl };
      else return { ok: true, docx: docxRes, error: `PDF upload failed: ${pdfUp.error}` };
    } catch (e) {
      return { ok: true, docx: docxRes, error: `PDF conversion failed: ${(e as Error).message}` };
    }
  }

  return { ok: true, docx: docxRes, pdf: pdfRes };
}
