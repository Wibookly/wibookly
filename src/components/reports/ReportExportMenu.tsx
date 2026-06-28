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
  /** Optional async hook for "Email to me". If omitted, the Email option is hidden. */
  onEmail?: () => Promise<void>;
  /** Label for the email recipient. Used only in toast. */
  emailRecipientLabel?: string;
  /** Optional custom PDF handler. Defaults to window.print(). */
  onPdf?: () => void;
  size?: 'sm' | 'default';
}

export function ReportExportMenu({
  fileName,
  rows,
  sheetName = 'Report',
  onEmail,
  emailRecipientLabel,
  onPdf,
  size = 'sm',
}: ReportExportMenuProps) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | 'email' | null>(null);

  const exportXlsx = () => {
    setBusy('xlsx');
    try {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
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
