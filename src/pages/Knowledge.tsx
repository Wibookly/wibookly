import { useEffect, useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Upload, FileText, Trash2, RefreshCw, Plus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface KnowledgeDocument {
  id: string;
  title: string;
  source_type: string;
  status: 'processing' | 'indexed' | 'failed';
  chunk_count: number;
  error_message: string | null;
  indexed_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

const ACCEPTED = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
};

export default function Knowledge() {
  const { user } = useAuth();
  const { activeConnection } = useActiveEmail();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualText, setManualText] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('knowledge_documents')
      .select('id, title, source_type, status, chunk_count, error_message, indexed_at, created_at, metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(`Failed to load documents: ${error.message}`);
    } else {
      setDocs((data ?? []) as KnowledgeDocument[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDocs();
    // Poll while any doc is processing
    const interval = setInterval(() => {
      setDocs((prev) => {
        if (prev.some((d) => d.status === 'processing')) fetchDocs();
        return prev;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchDocs]);

  const ingestFile = useCallback(
    async (file: File) => {
      if (!user) return;
      try {
        const path = `${user.id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from('knowledge-files')
          .upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;

        const { data, error } = await supabase.functions.invoke('ingest-document', {
          body: {
            storage_path: path,
            title: file.name,
            mime_type: file.type,
            filename: file.name,
            connection_id: activeConnection?.id ?? null,
            source_type: 'upload',
          },
        });
        if (error) throw error;
        toast.success(`Indexed "${file.name}" (${data.chunk_count} chunks)`);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed'}`);
      }
    },
    [user, activeConnection],
  );

  const onDrop = useCallback(
    async (files: File[]) => {
      setUploading(true);
      for (const file of files) {
        await ingestFile(file);
      }
      setUploading(false);
      fetchDocs();
    },
    [ingestFile, fetchDocs],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 20 * 1024 * 1024,
  });

  const saveManual = async () => {
    if (!manualTitle.trim() || !manualText.trim()) {
      toast.error('Title and content required');
      return;
    }
    setSavingManual(true);
    try {
      const { data, error } = await supabase.functions.invoke('ingest-document', {
        body: {
          title: manualTitle,
          source_type: 'manual',
          manual_text: manualText,
          connection_id: activeConnection?.id ?? null,
        },
      });
      if (error) throw error;
      toast.success(`Note indexed (${data.chunk_count} chunks)`);
      setManualOpen(false);
      setManualTitle('');
      setManualText('');
      fetchDocs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setSavingManual(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document and all its embeddings?')) return;
    const { error } = await supabase.from('knowledge_documents').delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Document deleted');
      fetchDocs();
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Knowledge Base</h1>
        <p className="text-muted-foreground mt-1">
          Upload documents and notes the AI can reference when drafting emails or answering questions.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Add to your knowledge base</CardTitle>
          <CardDescription>
            Drag PDFs, Word docs, text, or markdown files. Or add a manual note.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm">Indexing… this can take a moment for large files.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium">
                  {isDragActive ? 'Drop files here' : 'Drag files or click to upload'}
                </p>
                <p className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD · max 20 MB</p>
              </div>
            )}
          </div>

          <Dialog open={manualOpen} onOpenChange={setManualOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Add manual note
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>New manual note</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Title</label>
                  <Input
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="e.g. Pricing FAQ, Onboarding playbook"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Content</label>
                  <Textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    rows={12}
                    placeholder="Paste or type the text the AI should remember…"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setManualOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveManual} disabled={savingManual}>
                  {savingManual && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save & index
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Indexed documents</CardTitle>
            <CardDescription>{docs.length} item{docs.length === 1 ? '' : 's'}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchDocs}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nothing yet. Upload a file or add a note above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      {d.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{d.source_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {d.status === 'indexed' && (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Indexed
                        </Badge>
                      )}
                      {d.status === 'processing' && (
                        <Badge variant="outline" className="gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Processing
                        </Badge>
                      )}
                      {d.status === 'failed' && (
                        <Badge variant="destructive" className="gap-1" title={d.error_message ?? ''}>
                          <AlertCircle className="w-3 h-3" /> Failed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{d.chunk_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deleteDoc(d.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
