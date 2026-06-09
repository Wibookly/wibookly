// Generate a branded DOCX (and optional PDF) from markdown-ish content,
// upload to the user's OneDrive "InboxIQ Chat / Generated Documents" folder,
// and return webUrls.
//
// Standard style = "Executive Navy":
//   - Page: US Letter, 1" margins
//   - Title:   Calibri 28pt Bold, navy #0B2545, navy bottom bar
//   - H1:      Calibri 18pt Bold navy, thin bottom border
//   - H2:      Calibri 14pt Bold #13315C
//   - H3:      Calibri 12pt Bold italic #13315C
//   - Body:    Georgia 11pt, 1.15 line spacing
//   - Footer:  "InboxIQ" left, page X of Y right
//
// PDF is produced by Microsoft Graph's built-in conversion so fonts/layout
// match the DOCX exactly.
// deno-lint-ignore-file no-explicit-any
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
  BorderStyle,
  Footer,
  PageNumber,
  LevelFormat,
  convertInchesToTwip,
} from "https://esm.sh/docx@8.5.0";
import { getValidAccessToken } from "./oauth-tokens.ts";
import { saveToOneDrive } from "./onedrive-save.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

const NAVY = "0B2545";
const NAVY_2 = "13315C";
const MUTED = "5A6B7B";
const BODY_FONT = "Georgia";
const HEAD_FONT = "Calibri";

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

function parseInline(text: string, opts?: { font?: string; size?: number; color?: string }): TextRun[] {
  const base = { font: opts?.font ?? BODY_FONT, size: opts?.size ?? 22, color: opts?.color };
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith("**")) runs.push(new TextRun({ ...base, text: tok.slice(2, -2), bold: true }));
    else if (tok.startsWith("`"))  runs.push(new TextRun({ ...base, text: tok.slice(1, -1), font: "Consolas" }));
    else                           runs.push(new TextRun({ ...base, text: tok.slice(1, -1), italics: true }));
    last = m.index! + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ ...base, text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ ...base, text })];
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
    out.push(new Paragraph({
      spacing: { line: 300, after: 160 },
      children: parseInline(text),
    }));
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      const text = h[2].trim();
      if (level === 1) {
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 160 },
          border: { bottom: { color: NAVY, space: 4, style: BorderStyle.SINGLE, size: 8 } },
          children: parseInline(text, { font: HEAD_FONT, size: 36, color: NAVY }),
        }));
      } else if (level === 2) {
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 120 },
          children: parseInline(text, { font: HEAD_FONT, size: 28, color: NAVY_2 }),
        }));
      } else {
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text, bold: true, italics: true, font: HEAD_FONT, size: 24, color: NAVY_2 })],
        }));
      }
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      out.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { line: 280, after: 80 },
        children: parseInline(bullet[1]),
      }));
      continue;
    }

    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      flushPara();
      out.push(new Paragraph({
        numbering: { reference: "exec-numbered", level: 0 },
        spacing: { line: 280, after: 80 },
        children: parseInline(num[1]),
      }));
      continue;
    }

    buf.push(line);
  }
  flushPara();
  return out;
}

async function buildDocx(title: string, content: string): Promise<Uint8Array> {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const doc = new Document({
    creator: "InboxIQ",
    title,
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 22 } }, // 11pt Georgia
      },
    },
    numbering: {
      config: [
        {
          reference: "exec-numbered",
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.LEFT,
            tabStops: [{ type: "right" as any, position: 9360 }],
            children: [
              new TextRun({ text: "InboxIQ", font: HEAD_FONT, size: 18, color: MUTED }),
              new TextRun({ text: "\t", font: HEAD_FONT, size: 18 }),
              new TextRun({ text: "Page ", font: HEAD_FONT, size: 18, color: MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], font: HEAD_FONT, size: 18, color: MUTED }),
              new TextRun({ text: " of ", font: HEAD_FONT, size: 18, color: MUTED }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: HEAD_FONT, size: 18, color: MUTED }),
            ],
          })],
        }),
      },
      children: [
        // Eyebrow date
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: today.toUpperCase(), font: HEAD_FONT, size: 16, color: MUTED, characterSpacing: 40 })],
        }),
        // Title with thick navy underline bar
        new Paragraph({
          spacing: { after: 160 },
          border: { bottom: { color: NAVY, space: 6, style: BorderStyle.SINGLE, size: 24 } },
          children: [new TextRun({ text: title, bold: true, font: HEAD_FONT, size: 56, color: NAVY })],
        }),
        // Body
        ...mdToParagraphs(content),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

async function findUploadedItemId(token: string, path: string): Promise<string | null> {
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

  let docxBytes: Uint8Array;
  try {
    docxBytes = await buildDocx(opts.title, opts.content);
  } catch (e) {
    return { ok: false, error: `DOCX build failed: ${(e as Error).message}` };
  }

  let docxRes: { path?: string; webUrl?: string } | undefined;
  let pdfRes:  { path?: string; webUrl?: string } | undefined;

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
      const pdfResp = await fetch(`${GRAPH}/me/drive/items/${itemId}/content?format=pdf`, {
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
