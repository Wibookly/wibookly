// Shared document-generation library for the InboxIQ agent.
// All generators return { filename, mime_type, base64 } so the agent loop
// can attach them to outgoing emails or upload to OneDrive/Teams.
//
// Engines (all free, MIT/permissive, run in Deno Edge runtime):
//   PDF   → pdf-lib            (programmatic PDF, embeds standard fonts)
//   DOCX  → docx               (programmatic Word document)
//   XLSX  → exceljs            (programmatic Excel workbook)
//   PPTX  → pptxgenjs          (programmatic PowerPoint deck)
// deno-lint-ignore-file no-explicit-any

import {
  PDFDocument,
  StandardFonts,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1';
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
} from 'https://esm.sh/docx@8.5.0';
import ExcelJS from 'https://esm.sh/exceljs@4.4.0';
import pptxgen from 'https://esm.sh/pptxgenjs@3.12.0';

export interface GeneratedFile {
  filename: string;
  mime_type: string;
  base64: string;
  byte_size: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    );
  }
  return btoa(bin);
}

// ────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────
export interface PdfSection {
  heading?: string;
  body: string;
}

export interface PdfInput {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  footer?: string;
}

/**
 * Generates a multi-page PDF with title, subtitle, sectioned body, page numbers,
 * and an optional footer. Auto-wraps long paragraphs and paginates as needed.
 */
export async function generatePdf(input: PdfInput): Promise<GeneratedFile> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;
  const MARGIN = 56;
  const MAX_W = PAGE_W - MARGIN * 2;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawTitle = (txt: string) => {
    page.drawText(txt, {
      x: MARGIN,
      y,
      size: 22,
      font: helvBold,
      color: rgb(0.07, 0.09, 0.15),
      maxWidth: MAX_W,
    });
    y -= 32;
  };

  const drawSubtitle = (txt: string) => {
    page.drawText(txt, {
      x: MARGIN,
      y,
      size: 12,
      font: helv,
      color: rgb(0.35, 0.4, 0.5),
      maxWidth: MAX_W,
    });
    y -= 24;
  };

  const wrapLine = (text: string, font: any, size: number): string[] => {
    const out: string[] = [];
    const paragraphs = text.split(/\r?\n/);
    for (const para of paragraphs) {
      if (!para.trim()) {
        out.push('');
        continue;
      }
      const words = para.split(/\s+/);
      let line = '';
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        const width = font.widthOfTextAtSize(candidate, size);
        if (width > MAX_W && line) {
          out.push(line);
          line = w;
        } else {
          line = candidate;
        }
      }
      if (line) out.push(line);
    }
    return out;
  };

  const newPageIfNeeded = (lineHeight: number) => {
    if (y - lineHeight < MARGIN + 30) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  drawTitle(input.title);
  if (input.subtitle) drawSubtitle(input.subtitle);
  y -= 8;

  for (const section of input.sections) {
    if (section.heading) {
      newPageIfNeeded(28);
      page.drawText(section.heading, {
        x: MARGIN,
        y,
        size: 14,
        font: helvBold,
        color: rgb(0.1, 0.13, 0.2),
        maxWidth: MAX_W,
      });
      y -= 22;
    }
    const lines = wrapLine(section.body || '', helv, 11);
    for (const line of lines) {
      newPageIfNeeded(16);
      if (line) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: 11,
          font: helv,
          color: rgb(0.15, 0.17, 0.22),
          maxWidth: MAX_W,
        });
      }
      y -= 16;
    }
    y -= 8; // gap between sections
  }

  // Page numbers + footer
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    const label = `${idx + 1} / ${pages.length}`;
    p.drawText(label, {
      x: PAGE_W - MARGIN - helv.widthOfTextAtSize(label, 9),
      y: 24,
      size: 9,
      font: helv,
      color: rgb(0.55, 0.6, 0.68),
    });
    if (input.footer) {
      p.drawText(input.footer, {
        x: MARGIN,
        y: 24,
        size: 9,
        font: helv,
        color: rgb(0.55, 0.6, 0.68),
        maxWidth: MAX_W - 60,
      });
    }
  });

  const bytes = await pdf.save();
  const safeName = input.title.replace(/[^\w\d-_ ]+/g, '').slice(0, 60).trim() || 'document';
  return {
    filename: `${safeName}.pdf`,
    mime_type: 'application/pdf',
    base64: bytesToBase64(bytes),
    byte_size: bytes.byteLength,
  };
}

// ────────────────────────────────────────────────────────────────────
// DOCX
// ────────────────────────────────────────────────────────────────────
export interface DocxInput {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  footer?: string;
}

export async function generateDocx(input: DocxInput): Promise<GeneratedFile> {
  const children: Paragraph[] = [];
  children.push(new Paragraph({
    text: input.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
  }));
  if (input.subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: input.subtitle, italics: true, color: '5A6477' })],
      spacing: { after: 240 },
    }));
  }

  for (const section of input.sections) {
    if (section.heading) {
      children.push(new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }));
    }
    const paras = (section.body || '').split(/\r?\n\r?\n+/);
    for (const para of paras) {
      const lines = para.split(/\r?\n/);
      children.push(new Paragraph({
        children: lines.map((line, i) =>
          new TextRun({ text: line, break: i > 0 ? 1 : undefined }),
        ),
        spacing: { after: 160 },
      }));
    }
  }

  const doc = new Document({
    creator: 'InboxIQ Agent',
    title: input.title,
    sections: [{
      properties: {},
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const bytes = new Uint8Array(buf);
  const safeName = input.title.replace(/[^\w\d-_ ]+/g, '').slice(0, 60).trim() || 'document';
  return {
    filename: `${safeName}.docx`,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    base64: bytesToBase64(bytes),
    byte_size: bytes.byteLength,
  };
}

// ────────────────────────────────────────────────────────────────────
// XLSX
// ────────────────────────────────────────────────────────────────────
export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export interface XlsxInput {
  filename: string;
  sheets: XlsxSheet[];
}

export async function generateXlsx(input: XlsxInput): Promise<GeneratedFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InboxIQ Agent';
  wb.created = new Date();

  for (const sheet of input.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Sheet1');
    if (sheet.headers?.length) {
      ws.addRow(sheet.headers);
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8EEF7' },
      };
    }
    for (const row of sheet.rows || []) ws.addRow(row);
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 60);
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buf as ArrayBuffer);
  const safeName = (input.filename || 'workbook').replace(/[^\w\d-_ ]+/g, '').slice(0, 60).trim() || 'workbook';
  return {
    filename: `${safeName}.xlsx`,
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytesToBase64(bytes),
    byte_size: bytes.byteLength,
  };
}

// ────────────────────────────────────────────────────────────────────
// PPTX
// ────────────────────────────────────────────────────────────────────
export interface PptxSlide {
  title: string;
  bullets?: string[];
  body?: string;
}

export interface PptxInput {
  filename: string;
  title?: string;
  slides: PptxSlide[];
}

export async function generatePptx(input: PptxInput): Promise<GeneratedFile> {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  if (input.title) {
    const titleSlide = pres.addSlide();
    titleSlide.background = { color: '0F172A' };
    titleSlide.addText(input.title, {
      x: 0.6, y: 2.2, w: 12, h: 1.5,
      fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Calibri',
    });
    titleSlide.addText('Generated by InboxIQ Agent', {
      x: 0.6, y: 3.7, w: 12, h: 0.5,
      fontSize: 14, color: '94A3B8', fontFace: 'Calibri',
    });
  }

  for (const s of input.slides) {
    const slide = pres.addSlide();
    slide.addText(s.title, {
      x: 0.6, y: 0.4, w: 12, h: 0.8,
      fontSize: 28, bold: true, color: '0F172A', fontFace: 'Calibri',
    });
    if (s.bullets?.length) {
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true } })),
        {
          x: 0.6, y: 1.4, w: 12, h: 5.5,
          fontSize: 18, color: '1E293B', fontFace: 'Calibri',
        },
      );
    } else if (s.body) {
      slide.addText(s.body, {
        x: 0.6, y: 1.4, w: 12, h: 5.5,
        fontSize: 16, color: '1E293B', fontFace: 'Calibri',
      });
    }
  }

  // pptxgenjs in Deno: use 'base64' output type
  const b64 = (await pres.write({ outputType: 'base64' })) as string;
  // approximate byte size from base64 length
  const byteSize = Math.floor((b64.length * 3) / 4);
  const safeName = (input.filename || 'presentation').replace(/[^\w\d-_ ]+/g, '').slice(0, 60).trim() || 'presentation';
  return {
    filename: `${safeName}.pptx`,
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    base64: b64,
    byte_size: byteSize,
  };
}

// ────────────────────────────────────────────────────────────────────
// Tool dispatcher — called by the agent loop
// ────────────────────────────────────────────────────────────────────
export async function runDocTool(
  name: string,
  args: any,
): Promise<{ ok: true; file: GeneratedFile } | { ok: false; error: string }> {
  try {
    switch (name) {
      case 'generate_pdf':
        return { ok: true, file: await generatePdf(args as PdfInput) };
      case 'generate_docx':
        return { ok: true, file: await generateDocx(args as DocxInput) };
      case 'generate_xlsx':
        return { ok: true, file: await generateXlsx(args as XlsxInput) };
      case 'generate_pptx':
        return { ok: true, file: await generatePptx(args as PptxInput) };
      default:
        return { ok: false, error: `unknown doc tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// JSON Schemas exposed to the LLM (OpenAI / Anthropic compatible)
export const DOC_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'generate_pdf',
      description: 'Generate a multi-page PDF document. Use for policies, reports, contracts, summaries, briefs. Always pair with generate_docx for the same content so the recipient can edit.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title (becomes filename and cover heading).' },
          subtitle: { type: 'string', description: 'Optional subtitle (e.g. company name, date).' },
          sections: {
            type: 'array',
            description: 'Ordered sections of the document. Each section is a heading + body. Use \\n\\n for paragraph breaks inside body.',
            items: {
              type: 'object',
              properties: {
                heading: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['body'],
            },
          },
          footer: { type: 'string', description: 'Optional footer text shown on every page.' },
        },
        required: ['title', 'sections'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_docx',
      description: 'Generate an editable Microsoft Word .docx document. Use the SAME content as generate_pdf so the recipient gets both a polished PDF and an editable Word version.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: { heading: { type: 'string' }, body: { type: 'string' } },
              required: ['body'],
            },
          },
        },
        required: ['title', 'sections'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_xlsx',
      description: 'Generate a Microsoft Excel .xlsx workbook with one or more sheets. Use for data tables, financial models, comparisons, schedules.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Filename without extension.' },
          sheets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                headers: { type: 'array', items: { type: 'string' } },
                rows: {
                  type: 'array',
                  items: { type: 'array', items: { type: ['string', 'number', 'null'] } },
                },
              },
              required: ['name', 'headers', 'rows'],
            },
          },
        },
        required: ['filename', 'sheets'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_pptx',
      description: 'Generate a Microsoft PowerPoint .pptx deck. Use for executive summaries, proposals, training decks.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          title: { type: 'string', description: 'Optional cover slide title.' },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                bullets: { type: 'array', items: { type: 'string' } },
                body: { type: 'string' },
              },
              required: ['title'],
            },
          },
        },
        required: ['filename', 'slides'],
      },
    },
  },
];
