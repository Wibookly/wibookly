// Generate an Excel (.xlsx) workbook with the InboxIQ "Executive Navy" style
// and upload it to the user's OneDrive › InboxIQ Chat › Generated Documents.
//
// Sheet structure (input):
//   { name: "Sheet1", columns: ["Name","Amount"], rows: [["A", 100], ...] }
//
// Header row = navy fill #0B2545, white Calibri bold; body rows = Calibri 11pt;
// auto column widths; freeze top row.
// deno-lint-ignore-file no-explicit-any
import ExcelJS from "https://esm.sh/exceljs@4.4.0";
import { saveToOneDrive } from "./onedrive-save.ts";

export interface SheetSpec {
  name?: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

interface GenOpts {
  userId: string;
  connectionId: string;
  title: string;
  sheets: SheetSpec[];
  subfolder?: string;
}

export interface GenResult {
  ok: boolean;
  xlsx?: { path?: string; webUrl?: string };
  error?: string;
}

export async function generateSpreadsheet(opts: GenOpts): Promise<GenResult> {
  if (!opts.sheets?.length) return { ok: false, error: "no sheets provided" };

  const wb = new ExcelJS.Workbook();
  wb.creator = "InboxIQ";
  wb.created = new Date();

  for (const [i, spec] of opts.sheets.entries()) {
    const ws = wb.addWorksheet(spec.name?.slice(0, 30) || `Sheet${i + 1}`, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.addRow(spec.columns);
    const header = ws.getRow(1);
    header.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2545" } };
    header.alignment = { vertical: "middle", horizontal: "left" };
    header.height = 22;

    for (const row of spec.rows || []) ws.addRow(row);

    // Style body cells + auto-fit columns
    ws.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      row.font = { name: "Calibri", size: 11, color: { argb: "FF1F2937" } };
      row.alignment = { vertical: "middle" };
      if (idx % 2 === 0) {
        row.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FC" } };
        });
      }
    });

    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const v = cell.value == null ? "" : String(cell.value);
        if (v.length > max) max = v.length;
      });
      col.width = Math.min(Math.max(max + 4, 12), 48);
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buf as ArrayBuffer);

  const up = await saveToOneDrive({
    userId: opts.userId,
    connectionId: opts.connectionId,
    baseName: opts.title,
    ext: "xlsx",
    content: bytes,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    subfolder: opts.subfolder,
    overwrite: false,
  });
  if (!up.ok) return { ok: false, error: up.error };
  return { ok: true, xlsx: { path: up.path, webUrl: up.webUrl } };
}
