import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Upload, UserPlus, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { PermissionGroup } from './PermissionGroupsPanel';

interface RowDraft {
  email: string;
  full_name: string;
  password: string;
  groups: string; // comma-separated names while editing
}

interface BulkResult {
  email: string;
  success: boolean;
  error?: string;
}

interface Props {
  groups: PermissionGroup[];
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  onCompleted: () => void;
}

const emptyRow = (): RowDraft => ({ email: '', full_name: '', password: '', groups: '' });

const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export default function BulkCreateUsersDialog({ groups, invoke, onCompleted }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RowDraft[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateRow = (idx: number, patch: Partial<RowDraft>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const addRow = () => setRows(prev => [...prev, emptyRow()]);
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));

  const groupNameToId = (name: string) => {
    const trimmed = name.trim().toLowerCase();
    return groups.find(g => g.name.toLowerCase() === trimmed)?.id ?? null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let parsedRows: any[] = [];
      if (ext === 'csv' || ext === 'txt') {
        const text = await file.text();
        const result = Papa.parse(text, { header: true, skipEmptyLines: true });
        parsedRows = result.data as any[];
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        parsedRows = XLSX.utils.sheet_to_json(sheet);
      } else {
        toast({ title: 'Unsupported file', description: 'Please upload .csv, .xlsx, or .xls', variant: 'destructive' });
        return;
      }

      const imported: RowDraft[] = parsedRows.map((r: any) => ({
        email: String(r.email ?? r.Email ?? '').trim(),
        full_name: String(r.full_name ?? r['Full Name'] ?? r.name ?? r.Name ?? '').trim(),
        password: String(r.password ?? r.Password ?? '').trim() || generatePassword(),
        groups: String(r.groups ?? r.Groups ?? '').trim(),
      })).filter(r => r.email);

      if (imported.length === 0) {
        toast({ title: 'No rows found', description: 'Check that your file has email, full_name, password, groups columns.', variant: 'destructive' });
        return;
      }
      setRows(imported);
      toast({ title: 'File imported', description: `${imported.length} rows ready. Review then click Create.` });
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    const valid = rows.filter(r => r.email.trim() && r.full_name.trim());
    if (valid.length === 0) {
      toast({ title: 'No rows to submit', description: 'Add at least one user with email and name.', variant: 'destructive' });
      return;
    }
    const payload = valid.map(r => {
      const groupIds = r.groups.split(',').map(n => groupNameToId(n)).filter((v): v is string => Boolean(v));
      return {
        email: r.email.trim(),
        full_name: r.full_name.trim(),
        password: r.password.trim() || generatePassword(),
        group_ids: groupIds,
      };
    });

    setSubmitting(true);
    setResults(null);
    try {
      const data = await invoke('bulk_create_users', { users: payload });
      setResults(data.results || []);
      const succeeded = data.summary?.succeeded ?? 0;
      const failed = data.summary?.failed ?? 0;
      toast({
        title: 'Bulk creation finished',
        description: `${succeeded} created, ${failed} failed.`,
        variant: failed > 0 ? 'destructive' : 'default',
      });
      if (succeeded > 0) onCompleted();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = 'email,full_name,password,groups\njohn@company.com,John Doe,,Standard\njane@company.com,Jane Smith,SecurePass123,"Power User,Executive"\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    setResults(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <UserPlus className="w-4 h-4" /> Bulk Create / Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Multiple Users</DialogTitle>
          <DialogDescription>
            Add users one row at a time, paste from a spreadsheet, or import a CSV/Excel file. Their domain must already be authorized.
            Groups column accepts comma-separated group names (e.g. <code className="text-xs bg-muted px-1 rounded">Standard,Power User</code>).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-2">
            <Upload className="w-4 h-4" /> Import CSV / Excel
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt" hidden onChange={handleFileUpload} />
          <Button variant="ghost" size="sm" onClick={downloadTemplate} className="gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Download CSV template
          </Button>
          {groups.length > 0 && (
            <div className="ml-auto text-xs text-muted-foreground">
              Available groups: {groups.map(g => g.name).join(', ')}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-[1.5fr_2fr_1.5fr_1.5fr_auto] gap-2 items-end p-2 rounded-md border border-border">
              <div className="space-y-1">
                {idx === 0 && <Label className="text-xs">Full Name</Label>}
                <Input placeholder="John Doe" value={row.full_name} onChange={e => updateRow(idx, { full_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className="text-xs">Email</Label>}
                <Input type="email" placeholder="john@company.com" value={row.email} onChange={e => updateRow(idx, { email: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className="text-xs">Password (auto if blank)</Label>}
                <Input type="text" placeholder="Auto-generate" value={row.password} onChange={e => updateRow(idx, { password: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className="text-xs">Groups (comma-separated)</Label>}
                <Input placeholder="Standard,Power User" value={row.groups} onChange={e => updateRow(idx, { groups: e.target.value })} />
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeRow(idx)} disabled={rows.length === 1}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addRow} className="gap-2 self-start">
          <Plus className="w-4 h-4" /> Add row
        </Button>

        {results && (
          <div className="border-t border-border pt-3 space-y-1 max-h-48 overflow-y-auto">
            <p className="text-sm font-semibold">Results</p>
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{r.email}</span>
                {r.success
                  ? <Badge variant="default">Created</Badge>
                  : <Badge variant="destructive" title={r.error}>{r.error || 'Failed'}</Badge>}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Create {rows.filter(r => r.email.trim()).length} Users
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
