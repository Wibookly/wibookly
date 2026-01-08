-- Create table for AI chat conversations
CREATE TABLE public.ai_chat_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.provider_connections(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for AI chat messages
CREATE TABLE public.ai_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.ai_chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.ai_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_chat_conversations
CREATE POLICY "Users can view their own conversations" 
ON public.ai_chat_conversations 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations" 
ON public.ai_chat_conversations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations" 
ON public.ai_chat_conversations 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations" 
ON public.ai_chat_conversations 
FOR DELETE 
USING (auth.uid() = user_id);

-- RLS Policies for ai_chat_messages (via conversation ownership)
CREATE POLICY "Users can view messages in their conversations" 
ON public.ai_chat_messages 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.ai_chat_conversations 
    WHERE id = conversation_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can create messages in their conversations" 
ON public.ai_chat_messages 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.ai_chat_conversations 
    WHERE id = conversation_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete messages in their conversations" 
ON public.ai_chat_messages 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.ai_chat_conversations 
    WHERE id = conversation_id AND user_id = auth.uid()
  )
);

-- Create indexes for better performance
CREATE INDEX idx_ai_chat_conversations_user_id ON public.ai_chat_conversations(user_id);
CREATE INDEX idx_ai_chat_conversations_created_at ON public.ai_chat_conversations(created_at DESC);
CREATE INDEX idx_ai_chat_messages_conversation_id ON public.ai_chat_messages(conversation_id);
CREATE INDEX idx_ai_chat_messages_created_at ON public.ai_chat_messages(created_at);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_ai_chat_conversations_updated_at
BEFORE UPDATE ON public.ai_chat_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();