// Generate a PowerPoint (.pptx) deck with InboxIQ "Executive Navy" theme
// and upload it to the user's OneDrive › InboxIQ Chat › Generated Documents.
//
// Input:
//   { title, subtitle?, slides: [{ title, bullets?: string[], body?: string }] }
//
// Theme:
//   - Title slide: navy bg, white Calibri title, ice-blue subtitle
//   - Content slides: white bg, navy title bar (thin), Calibri body 20pt,
//     bullets in deep-navy with subtle accent dot.
// deno-lint-ignore-file no-explicit-any
import pptxgen from "https://esm.sh/pptxgenjs@3.12.0";
import { saveToOneDrive } from "./onedrive-save.ts";

export interface SlideSpec {
  title: string;
  bullets?: string[];
  body?: string;
}

interface GenOpts {
  userId: string;
  connectionId: string;
  title: string;
  subtitle?: string;
  slides: SlideSpec[];
  subfolder?: string;
}

export interface GenResult {
  ok: boolean;
  pptx?: { path?: string; webUrl?: string };
  error?: string;
}

const NAVY = "0B2545";
const NAVY_2 = "13315C";
const ICE = "CADCFC";
const INK = "1F2937";

export async function generatePresentation(opts: GenOpts): Promise<GenResult> {
  if (!opts.slides?.length) return { ok: false, error: "no slides provided" };

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "InboxIQ";
  pres.title = opts.title;

  // Cover
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  cover.addShape("rect", { x: 0.5, y: 3.2, w: 1.5, h: 0.08, fill: { color: ICE }, line: { color: ICE } });
  cover.addText("INBOXIQ", {
    x: 0.5, y: 0.5, w: 12, h: 0.4,
    fontFace: "Calibri", fontSize: 12, color: ICE, bold: true, charSpacing: 4,
  });
  cover.addText(opts.title, {
    x: 0.5, y: 2.0, w: 12, h: 1.2,
    fontFace: "Calibri", fontSize: 44, color: "FFFFFF", bold: true,
  });
  if (opts.subtitle) {
    cover.addText(opts.subtitle, {
      x: 0.5, y: 3.5, w: 12, h: 0.8,
      fontFace: "Calibri", fontSize: 20, color: ICE,
    });
  }
  cover.addText(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), {
    x: 0.5, y: 6.6, w: 12, h: 0.3,
    fontFace: "Calibri", fontSize: 12, color: ICE,
  });

  // Content slides
  for (const s of opts.slides) {
    const slide = pres.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(s.title, {
      x: 0.5, y: 0.4, w: 12.3, h: 0.7,
      fontFace: "Calibri", fontSize: 28, bold: true, color: NAVY,
    });
    slide.addShape("rect", { x: 0.5, y: 1.05, w: 12.3, h: 0.04, fill: { color: NAVY }, line: { color: NAVY } });

    if (s.bullets?.length) {
      slide.addText(
        s.bullets.map((t) => ({ text: t, options: { bullet: { code: "25CF" }, color: INK } })),
        {
          x: 0.6, y: 1.4, w: 12.1, h: 5.8,
          fontFace: "Calibri", fontSize: 20, color: INK,
          paraSpaceAfter: 10, valign: "top",
        },
      );
    } else if (s.body) {
      slide.addText(s.body, {
        x: 0.6, y: 1.4, w: 12.1, h: 5.8,
        fontFace: "Calibri", fontSize: 20, color: INK, valign: "top",
      });
    }

    slide.addText("InboxIQ", {
      x: 0.5, y: 7.1, w: 6, h: 0.3,
      fontFace: "Calibri", fontSize: 10, color: NAVY_2,
    });
  }

  const b64 = (await pres.write({ outputType: "base64" })) as string;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const up = await saveToOneDrive({
    userId: opts.userId,
    connectionId: opts.connectionId,
    baseName: opts.title,
    ext: "pptx",
    content: bin,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    subfolder: opts.subfolder,
    overwrite: false,
  });
  if (!up.ok) return { ok: false, error: up.error };
  return { ok: true, pptx: { path: up.path, webUrl: up.webUrl } };
}
