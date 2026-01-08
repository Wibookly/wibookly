import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useActiveEmail } from '@/contexts/ActiveEmailContext';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Send, Plus, Trash2, MessageSquare, Loader2, Mail, ExternalLink, Eye, Calendar, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { format, isToday, isYesterday, isThisWeek, isThisMonth } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface EmailResult {
  id: string;
  subject: string;
  from: string;
  preview: string;
  date: string;
  webLink?: string;
}

export default function AIChat() {
  const { user, organization } = useAuth();
  const { activeConnection } = useActiveEmail();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Email preview state
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailResult | null>(null);
  const [emailResults, setEmailResults] = useState<EmailResult[]>([]);

  // Voice recording
  const { isRecording, isTranscribing, startRecording, stopRecording } = useVoiceRecording({
    onTranscription: (text) => {
      setInput(prev => prev ? `${prev} ${text}` : text);
    },
  });

  // Fetch conversations (last 30 days)
  const { data: conversations = [], isLoading: loadingConversations } = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data, error } = await supabase
        .from('ai_chat_conversations')
        .select('*')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      return data as Conversation[];
    },
    enabled: !!user,
  });

  // Fetch messages for active conversation
  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['ai-messages', activeConversationId],
    queryFn: async () => {
      if (!activeConversationId) return [];
      
      const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data as Message[];
    },
    enabled: !!activeConversationId,
  });

  // Create new conversation
  const createConversation = useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await supabase
        .from('ai_chat_conversations')
        .insert({
          user_id: user!.id,
          organization_id: organization!.id,
          connection_id: activeConnection?.id || null,
          title,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
      setActiveConversationId(data.id);
    },
  });

  // Delete conversation
  const deleteConversation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('ai_chat_conversations')
        .delete()
        .eq('id', conversationId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
      if (activeConversationId) {
        setActiveConversationId(null);
      }
      toast.success('Conversation deleted');
    },
  });

  // Save message to database
  const saveMessage = async (conversationId: string, role: 'user' | 'assistant', content: string) => {
    const { error } = await supabase
      .from('ai_chat_messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
      });
    
    if (error) throw error;
  };

  // Update conversation title based on first message
  const updateConversationTitle = async (conversationId: string, firstMessage: string) => {
    const title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
    await supabase
      .from('ai_chat_conversations')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    
    queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
  };

  // Parse email results from AI response
  const parseEmailResults = (content: string): EmailResult[] => {
    const emailRegex = /\[EMAIL_RESULT\](.*?)\[\/EMAIL_RESULT\]/gs;
    const matches = content.matchAll(emailRegex);
    const results: EmailResult[] = [];
    
    for (const match of matches) {
      try {
        const emailData = JSON.parse(match[1]);
        results.push(emailData);
      } catch {
        // Skip malformed email data
      }
    }
    
    return results;
  };

  // Open email in provider
  const openInProvider = (email: EmailResult) => {
    if (email.webLink) {
      window.open(email.webLink, '_blank');
    } else if (activeConnection?.provider === 'google') {
      window.open(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(email.subject)}`, '_blank');
    } else if (activeConnection?.provider === 'outlook') {
      window.open(`https://outlook.live.com/mail/0/search/${encodeURIComponent(email.subject)}`, '_blank');
    }
  };

  // Send message and stream response
  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setEmailResults([]);

    try {
      let conversationId = activeConversationId;

      // Create new conversation if needed
      if (!conversationId) {
        const newConversation = await createConversation.mutateAsync('New Chat');
        conversationId = newConversation.id;
      }

      // Save user message
      await saveMessage(conversationId, 'user', userMessage);
      queryClient.invalidateQueries({ queryKey: ['ai-messages', conversationId] });

      // Update title if first message
      if (messages.length === 0) {
        await updateConversationTitle(conversationId, userMessage);
      }

      // Prepare messages for API
      const apiMessages = [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userMessage }
      ];

      // Call edge function
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          connectionId: activeConnection?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get response');
      }

      // Stream response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let textBuffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              setStreamingContent(fullContent);
              
              // Parse email results as they come in
              const emails = parseEmailResults(fullContent);
              if (emails.length > 0) {
                setEmailResults(emails);
              }
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Save assistant message (clean version without email tags)
      if (fullContent) {
        const cleanContent = fullContent.replace(/\[EMAIL_RESULT\].*?\[\/EMAIL_RESULT\]/gs, '').trim();
        await saveMessage(conversationId, 'assistant', cleanContent);
        queryClient.invalidateQueries({ queryKey: ['ai-messages', conversationId] });
      }

      // Update conversation timestamp
      await supabase
        .from('ai_chat_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

    } catch (error) {
      console.error('Error sending message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Group conversations by date
  const groupedConversations = conversations.reduce((groups, conv) => {
    const date = new Date(conv.created_at);
    let label = 'Older';
    
    if (isToday(date)) label = 'Today';
    else if (isYesterday(date)) label = 'Yesterday';
    else if (isThisWeek(date)) label = 'This Week';
    else if (isThisMonth(date)) label = 'This Month';
    
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
    return groups;
  }, {} as Record<string, Conversation[]>);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewChat = () => {
    setActiveConversationId(null);
    setInput('');
    setEmailResults([]);
  };

  // Render message content with clickable email cards
  const renderMessageContent = (content: string) => {
    // Remove email result tags for display
    const cleanContent = content.replace(/\[EMAIL_RESULT\].*?\[\/EMAIL_RESULT\]/gs, '').trim();
    return <p className="whitespace-pre-wrap">{cleanContent}</p>;
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar - Chat History */}
      <div className="w-64 border-r border-border bg-card/50 flex flex-col">
        <div className="p-3 border-b border-border">
          <Button onClick={startNewChat} className="w-full gap-2" variant="outline">
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-4">
            {loadingConversations ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3 text-center">
                No conversations yet
              </p>
            ) : (
              Object.entries(groupedConversations).map(([label, convs]) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-muted-foreground px-2 mb-1">{label}</p>
                  {convs.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        'group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors',
                        activeConversationId === conv.id
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-secondary/50'
                      )}
                      onClick={() => setActiveConversationId(conv.id)}
                    >
                      <MessageSquare className="w-4 h-4 flex-shrink-0" />
                      <span className="text-sm truncate flex-1">{conv.title}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation.mutate(conv.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="max-w-3xl mx-auto space-y-4">
            {!activeConversationId && messages.length === 0 && !isStreaming ? (
              <div className="flex flex-col items-center justify-center h-full py-20">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-semibold mb-2">AI Assistant</h2>
                <p className="text-muted-foreground text-center max-w-md mb-6">
                  I have full access to your emails and calendar. Ask me to find emails, search for information, check your schedule, or help you manage your inbox.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-lg">
                  <Card 
                    className="cursor-pointer hover:bg-secondary/50 transition-colors"
                    onClick={() => setInput('Show me emails from this week')}
                  >
                    <CardContent className="p-3 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-primary" />
                      <span className="text-sm">Show emails from this week</span>
                    </CardContent>
                  </Card>
                  <Card 
                    className="cursor-pointer hover:bg-secondary/50 transition-colors"
                    onClick={() => setInput("What's on my calendar today?")}
                  >
                    <CardContent className="p-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="text-sm">What's on my calendar?</span>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <>
                {loadingMessages ? (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-3/4 ml-auto" />
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex',
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] rounded-lg px-4 py-3',
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary'
                        )}
                      >
                        {renderMessageContent(message.content)}
                        <p className={cn(
                          'text-xs mt-1',
                          message.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        )}>
                          {format(new Date(message.created_at), 'HH:mm')}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                
                {/* Streaming message */}
                {isStreaming && streamingContent && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg px-4 py-3 bg-secondary">
                      {renderMessageContent(streamingContent)}
                    </div>
                  </div>
                )}
                
                {/* Email Results Cards */}
                {emailResults.length > 0 && (
                  <div className="space-y-2 mt-4">
                    <p className="text-sm font-medium text-muted-foreground">
                      Found {emailResults.length} email{emailResults.length !== 1 ? 's' : ''}:
                    </p>
                    {emailResults.map((email, index) => (
                      <Card key={index} className="overflow-hidden">
                        <CardContent className="p-0">
                          <div className="flex items-start gap-3 p-4">
                            <Mail className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium truncate">{email.subject}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">From: {email.from}</p>
                              {email.preview && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {email.preview}
                                </p>
                              )}
                              {email.date && (
                                <Badge variant="secondary" className="mt-2 text-xs">
                                  {email.date}
                                </Badge>
                              )}
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedEmail(email);
                                  setEmailPreviewOpen(true);
                                }}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openInProvider(email)}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                
                {/* Loading indicator */}
                {isStreaming && !streamingContent && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-4 py-3 bg-secondary">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search emails, ask about your calendar, or get help managing your inbox..."
              className="min-h-[52px] max-h-32 resize-none"
              disabled={isStreaming || isRecording || isTranscribing}
            />
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isStreaming || isTranscribing}
              variant={isRecording ? "destructive" : "outline"}
              size="icon"
              className="h-[52px] w-[52px] flex-shrink-0"
              title={isRecording ? "Stop recording" : "Start voice input"}
            >
              {isTranscribing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isRecording ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </Button>
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              size="icon"
              className="h-[52px] w-[52px] flex-shrink-0"
            >
              {isStreaming ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </Button>
          </div>
          {isRecording && (
            <p className="text-center text-sm text-destructive mt-2 animate-pulse">
              🎙️ Recording... Click the mic button to stop
            </p>
          )}
        </div>
      </div>

      {/* Email Preview Dialog */}
      <Dialog open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              {selectedEmail?.subject}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">From: {selectedEmail?.from}</p>
                {selectedEmail?.date && (
                  <p className="text-sm text-muted-foreground">{selectedEmail.date}</p>
                )}
              </div>
              <Button onClick={() => selectedEmail && openInProvider(selectedEmail)}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in {activeConnection?.provider === 'google' ? 'Gmail' : 'Outlook'}
              </Button>
            </div>
            <div className="border rounded-lg p-4 bg-secondary/30">
              <p className="whitespace-pre-wrap">{selectedEmail?.preview}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
