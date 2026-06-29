import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Download, FileSpreadsheet, Printer, Mail, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

export interface ReportExportMenuProps {
  /** Filename stem, no extension. */
  fileName: string;
  /** Tabular rows for Excel. First object's keys become headers. */
  rows: Array<Record<string, unknown>>;
  /** Optional sheet name. */
  sheetName?: string;
  /** Optional report title rendered as the top row of the Excel sheet
   *  and configured to repeat on every printed page. */
  title?: string;
  /** Optional subtitle rendered under the title (also repeats on every printed page). */
  subtitle?: string;
  /** Optional async hook for "Email to me". If omitted, the Email option is hidden. */
  onEmail?: () => Promise<void>;
  /** Label for the email recipient. Used only in toast. */
  emailRecipientLabel?: string;
  /** Optional custom PDF handler. Defaults to window.print(). */
  onPdf?: () => void;
  size?: 'sm' | 'default';
}

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const colLetter = (idx: number) => {
  // 0 → A, 25 → Z, 26 → AA …
  if (idx < 26) return COL_LETTERS[idx];
  const first = COL_LETTERS[Math.floor(idx / 26) - 1];
  const second = COL_LETTERS[idx % 26];
  return `${first}${second}`;
};

export function ReportExportMenu({
  fileName,
  rows,
  sheetName = 'Report',
  title,
  subtitle,
  onEmail,
  emailRecipientLabel,
  onPdf,
  size = 'sm',
}: ReportExportMenuProps) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | 'email' | null>(null);

  const exportXlsx = () => {
    setBusy('xlsx');
    try {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const colCount = headers.length || 1;
      const lastCol = colLetter(colCount - 1);

      // Build sheet manually so we can prepend a title block.
      const aoa: (string | number | null)[][] = [];
      let headerRowIndex = 0; // 0-based index into aoa where the column-header row sits.
      if (title) {
        aoa.push([title, ...Array(Math.max(0, colCount - 1)).fill('')]);
        headerRowIndex += 1;
      }
      if (subtitle) {
        aoa.push([subtitle, ...Array(Math.max(0, colCount - 1)).fill('')]);
        headerRowIndex += 1;
      }
      if (title || subtitle) {
        aoa.push(Array(colCount).fill('')); // spacer row
        headerRowIndex += 1;
      }
      aoa.push(headers);
      for (const r of rows) aoa.push(headers.map((h) => (r[h] as any) ?? ''));

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Merge title / subtitle across the whole header.
      const merges: XLSX.Range[] = [];
      let r = 0;
      if (title) {
        merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 1 } });
        const cell = ws[`A${r + 1}`];
        if (cell) cell.s = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'left' } };
        r += 1;
      }
      if (subtitle) {
        merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 1 } });
        const cell = ws[`A${r + 1}`];
        if (cell) cell.s = { font: { italic: true, sz: 11 }, alignment: { horizontal: 'left' } };
        r += 1;
      }
      if (merges.length) ws['!merges'] = merges;

      // Column widths — auto-fit-ish.
      ws['!cols'] = headers.map((h) => {
        const headerLen = String(h).length;
        const maxCell = rows.reduce((m, row) => {
          const v = String(row[h] ?? '');
          const longestLine = v.split('\n').reduce((mm, ln) => Math.max(mm, ln.length), 0);
          return Math.max(m, longestLine);
        }, 0);
        return { wch: Math.min(60, Math.max(14, Math.max(headerLen, maxCell) + 2)) };
      });

      // Wrap-text for any cell that contains a newline (mainly the schedule column).
      for (let rowIdx = headerRowIndex + 1; rowIdx < aoa.length; rowIdx++) {
        for (let cIdx = 0; cIdx < colCount; cIdx++) {
          const addr = `${colLetter(cIdx)}${rowIdx + 1}`;
          const cell = ws[addr];
          if (cell && typeof cell.v === 'string' && cell.v.includes('\n')) {
            cell.s = { ...(cell.s || {}), alignment: { wrapText: true, vertical: 'top' } };
          }
        }
      }

      // Print setup: landscape, repeat title + header rows on every page.
      ws['!margins'] = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
      (ws as any)['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
      // Print titles: repeat rows 1..(headerRowIndex+1).
      (ws as any)['!printHeader'] = [1, headerRowIndex + 1];
      // Header/footer text printed on every page.
      const safeTitle = (title || sheetName).replace(/&/g, '&&');
      (ws as any)['!print'] = { printHeader: [1, headerRowIndex + 1] };
      (ws as any)['!header'] = `&L&B${safeTitle}`;
      (ws as any)['!footer'] = '&LGenerated by InboxIQ&RPage &P of &N';

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

      // Workbook-level defined name so Excel repeats the top rows on every printed page.
      const sheetSafeName = sheetName.replace(/'/g, "''");
      (wb as any).Workbook = {
        ...((wb as any).Workbook || {}),
        Names: [
          ...(((wb as any).Workbook && (wb as any).Workbook.Names) || []),
          {
            Name: '_xlnm.Print_Titles',
            Ref: `'${sheetSafeName}'!$1:$${headerRowIndex + 1}`,
            Sheet: 0,
          },
          {
            Name: '_xlnm.Print_Area',
            Ref: `'${sheetSafeName}'!$A$1:$${lastCol}$${aoa.length}`,
            Sheet: 0,
          },
        ],
      };

      XLSX.writeFile(wb, `${fileName}.xlsx`);
      toast.success('Excel file downloaded');
    } catch (e: any) {
      toast.error(e?.message || 'Could not export Excel');
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = () => {
    setBusy('pdf');
    try {
      if (onPdf) onPdf();
      else window.print();
    } finally {
      setTimeout(() => setBusy(null), 500);
    }
  };

  const sendEmail = async () => {
    if (!onEmail) return;
    setBusy('email');
    try {
      await onEmail();
      toast.success(`Report emailed${emailRecipientLabel ? ` to ${emailRecipientLabel}` : ''}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not email report');
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={busy !== null}>
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
          Export
          <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">Export this report</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportPdf}>
          <Printer className="w-4 h-4 mr-2" /> PDF / Print
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportXlsx} disabled={rows.length === 0}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel (.xlsx)
        </DropdownMenuItem>
        {onEmail && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={sendEmail}>
              <Mail className="w-4 h-4 mr-2" /> Email to me
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
