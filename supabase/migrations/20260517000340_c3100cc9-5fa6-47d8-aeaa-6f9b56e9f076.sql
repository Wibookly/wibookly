
CREATE TABLE IF NOT EXISTS public.chat_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'New folder',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON public.chat_folders(user_id, sort_order, created_at);

ALTER TABLE public.chat_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own folders"
ON public.chat_folders
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_chat_folders_updated_at
BEFORE UPDATE ON public.chat_folders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.chat_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_folder ON public.chat_conversations(folder_id) WHERE folder_id IS NOT NULL;
