export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          group_id: string | null
          id: string
          organization_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          group_id?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          group_id?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      agent_messages: {
        Row: {
          channel: string
          content: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          external_message_id: string | null
          id: string
          metadata: Json
          organization_id: string
          rejected_reason: string | null
          response_to_id: string | null
          sender_aad_id: string | null
          sender_domain: string | null
          sender_email: string | null
          status: string
          subject: string | null
        }
        Insert: {
          channel: string
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: string
          external_message_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          rejected_reason?: string | null
          response_to_id?: string | null
          sender_aad_id?: string | null
          sender_domain?: string | null
          sender_email?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          channel?: string
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          external_message_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          rejected_reason?: string | null
          response_to_id?: string | null
          sender_aad_id?: string | null
          sender_domain?: string | null
          sender_email?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_response_to_id_fkey"
            columns: ["response_to_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_response_cache: {
        Row: {
          attachments: Json
          created_at: string
          expires_at: string
          model: string | null
          organization_id: string
          prompt_hash: string
          provider: string | null
          reply_html: string
        }
        Insert: {
          attachments?: Json
          created_at?: string
          expires_at?: string
          model?: string | null
          organization_id: string
          prompt_hash: string
          provider?: string | null
          reply_html: string
        }
        Update: {
          attachments?: Json
          created_at?: string
          expires_at?: string
          model?: string | null
          organization_id?: string
          prompt_hash?: string
          provider?: string | null
          reply_html?: string
        }
        Relationships: []
      }
      agent_settings: {
        Row: {
          allowed_sender_domains: string[]
          created_at: string
          email_agent_enabled: boolean
          graph_subscription_expires_at: string | null
          graph_subscription_id: string | null
          id: string
          organization_id: string
          shared_mailbox_address: string | null
          shared_mailbox_user_id: string | null
          teams_agent_enabled: boolean
          teams_bot_app_id: string | null
          teams_tenant_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_sender_domains?: string[]
          created_at?: string
          email_agent_enabled?: boolean
          graph_subscription_expires_at?: string | null
          graph_subscription_id?: string | null
          id?: string
          organization_id: string
          shared_mailbox_address?: string | null
          shared_mailbox_user_id?: string | null
          teams_agent_enabled?: boolean
          teams_bot_app_id?: string | null
          teams_tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_sender_domains?: string[]
          created_at?: string
          email_agent_enabled?: boolean
          graph_subscription_expires_at?: string | null
          graph_subscription_id?: string | null
          id?: string
          organization_id?: string
          shared_mailbox_address?: string | null
          shared_mailbox_user_id?: string | null
          teams_agent_enabled?: boolean
          teams_bot_app_id?: string | null
          teams_tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_activity_logs: {
        Row: {
          activity_type: string
          category_id: string | null
          category_name: string
          connection_id: string | null
          created_at: string
          email_from: string | null
          email_subject: string | null
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          activity_type: string
          category_id?: string | null
          category_name: string
          connection_id?: string | null
          created_at?: string
          email_from?: string | null
          email_subject?: string | null
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          activity_type?: string
          category_id?: string | null
          category_name?: string
          connection_id?: string | null
          created_at?: string
          email_from?: string | null
          email_subject?: string | null
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_activity_logs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_activity_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_conversations: {
        Row: {
          agent_mode: boolean
          connection_id: string | null
          context_email_thread_id: string | null
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_mode?: boolean
          connection_id?: string | null
          context_email_thread_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_mode?: boolean
          connection_id?: string | null
          context_email_thread_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_conversations_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_conversations_context_email_thread_id_fkey"
            columns: ["context_email_thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          citations: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          model_used: string | null
          role: string
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json | null
          tool_results: Json | null
        }
        Insert: {
          citations?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          model_used?: string | null
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
          tool_results?: Json | null
        }
        Update: {
          citations?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          model_used?: string | null
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
          tool_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          additional_context: string | null
          ai_calendar_event_color: string | null
          ai_draft_label_color: string | null
          ai_generated_sample: string | null
          ai_sent_label_color: string | null
          connection_id: string | null
          created_at: string
          example_reply_template: string | null
          format_style: string | null
          id: string
          organization_id: string
          updated_at: string
          writing_style: string
        }
        Insert: {
          additional_context?: string | null
          ai_calendar_event_color?: string | null
          ai_draft_label_color?: string | null
          ai_generated_sample?: string | null
          ai_sent_label_color?: string | null
          connection_id?: string | null
          created_at?: string
          example_reply_template?: string | null
          format_style?: string | null
          id?: string
          organization_id: string
          updated_at?: string
          writing_style?: string
        }
        Update: {
          additional_context?: string | null
          ai_calendar_event_color?: string | null
          ai_draft_label_color?: string | null
          ai_generated_sample?: string | null
          ai_sent_label_color?: string | null
          connection_id?: string | null
          created_at?: string
          example_reply_template?: string | null
          format_style?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
          writing_style?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_logs: {
        Row: {
          action: string
          block_reason: string | null
          completion_tokens: number
          cost_usd: number
          created_at: string
          domain_id: string | null
          error_message: string | null
          group_id: string | null
          id: string
          latency_ms: number | null
          metadata: Json
          model: string
          organization_id: string
          prompt_tokens: number
          provider: string
          status: string
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          block_reason?: string | null
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          domain_id?: string | null
          error_message?: string | null
          group_id?: string | null
          id?: string
          latency_ms?: number | null
          metadata?: Json
          model: string
          organization_id: string
          prompt_tokens?: number
          provider: string
          status?: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          block_reason?: string | null
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          domain_id?: string | null
          error_message?: string | null
          group_id?: string | null
          id?: string
          latency_ms?: number | null
          metadata?: Json
          model?: string
          organization_id?: string
          prompt_tokens?: number
          provider?: string
          status?: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_recipients: {
        Row: {
          created_at: string
          email: string | null
          email_enabled: boolean
          id: string
          is_active: boolean
          min_severity: string
          name: string | null
          phone: string | null
          sms_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_enabled?: boolean
          id?: string
          is_active?: boolean
          min_severity?: string
          name?: string | null
          phone?: string | null
          sms_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          email_enabled?: boolean
          id?: string
          is_active?: boolean
          min_severity?: string
          name?: string | null
          phone?: string | null
          sms_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      allowed_domains: {
        Row: {
          created_at: string
          created_by: string | null
          domain: string
          id: string
          is_active: boolean
          last_directory_sync_at: string | null
          max_users: number | null
          microsoft_consent_granted: boolean
          microsoft_consent_granted_at: string | null
          microsoft_tenant_id: string | null
          organization_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain: string
          id?: string
          is_active?: boolean
          last_directory_sync_at?: string | null
          max_users?: number | null
          microsoft_consent_granted?: boolean
          microsoft_consent_granted_at?: string | null
          microsoft_tenant_id?: string | null
          organization_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain?: string
          id?: string
          is_active?: boolean
          last_directory_sync_at?: string | null
          max_users?: number | null
          microsoft_consent_granted?: boolean
          microsoft_consent_granted_at?: string | null
          microsoft_tenant_id?: string | null
          organization_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      api_key_config: {
        Row: {
          encrypted_value: string
          id: string
          key_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          encrypted_value: string
          id?: string
          key_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          encrypted_value?: string
          id?: string
          key_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      availability_hours: {
        Row: {
          connection_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean
          organization_id: string
          start_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          day_of_week: number
          end_time?: string
          id?: string
          is_available?: boolean
          organization_id: string
          start_time?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean
          organization_id?: string
          start_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_hours_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_group_feature_overrides_v1: {
        Row: {
          created_at: string | null
          created_by: string | null
          domain_id: string | null
          feature_key: string | null
          group_id: string | null
          id: string | null
          is_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          domain_id?: string | null
          feature_key?: string | null
          group_id?: string | null
          id?: string | null
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          domain_id?: string | null
          feature_key?: string | null
          group_id?: string | null
          id?: string | null
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_group_features_v1: {
        Row: {
          created_at: string | null
          feature_key: string | null
          group_id: string | null
          id: string | null
          is_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          feature_key?: string | null
          group_id?: string | null
          id?: string | null
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          feature_key?: string | null
          group_id?: string | null
          id?: string | null
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_group_features_v2: {
        Row: {
          created_at: string | null
          daily_limit: number | null
          feature_key: string | null
          group_id: string | null
          id: string | null
          is_enabled: boolean | null
          model_assignment: string | null
          monthly_limit: number | null
          updated_at: string | null
          weekly_limit: number | null
        }
        Insert: {
          created_at?: string | null
          daily_limit?: number | null
          feature_key?: string | null
          group_id?: string | null
          id?: string | null
          is_enabled?: boolean | null
          model_assignment?: string | null
          monthly_limit?: number | null
          updated_at?: string | null
          weekly_limit?: number | null
        }
        Update: {
          created_at?: string | null
          daily_limit?: number | null
          feature_key?: string | null
          group_id?: string | null
          id?: string | null
          is_enabled?: boolean | null
          model_assignment?: string | null
          monthly_limit?: number | null
          updated_at?: string | null
          weekly_limit?: number | null
        }
        Relationships: []
      }
      backup_org_agent_budget_v1: {
        Row: {
          current_day: string | null
          daily_usd_cap: number | null
          max_concurrent_runs: number | null
          organization_id: string | null
          paused: boolean | null
          paused_reason: string | null
          spent_today_usd: number | null
          updated_at: string | null
        }
        Insert: {
          current_day?: string | null
          daily_usd_cap?: number | null
          max_concurrent_runs?: number | null
          organization_id?: string | null
          paused?: boolean | null
          paused_reason?: string | null
          spent_today_usd?: number | null
          updated_at?: string | null
        }
        Update: {
          current_day?: string | null
          daily_usd_cap?: number | null
          max_concurrent_runs?: number | null
          organization_id?: string | null
          paused?: boolean | null
          paused_reason?: string | null
          spent_today_usd?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_permission_groups_v1: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          domain_id: string | null
          id: string | null
          name: string | null
          organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_id?: string | null
          id?: string | null
          name?: string | null
          organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_id?: string | null
          id?: string | null
          name?: string | null
          organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_permission_groups_v2: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          domain_id: string | null
          id: string | null
          is_default_for_new_users: boolean | null
          monthly_price: number | null
          name: string | null
          organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          domain_id?: string | null
          id?: string | null
          is_default_for_new_users?: boolean | null
          monthly_price?: number | null
          name?: string | null
          organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          domain_id?: string | null
          id?: string | null
          is_default_for_new_users?: boolean | null
          monthly_price?: number | null
          name?: string | null
          organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          additional_context: string | null
          ai_draft_enabled: boolean
          ai_generated_sample: string | null
          auto_reply_enabled: boolean
          color: string
          connection_id: string | null
          created_at: string
          example_reply_template: string | null
          format_style: string | null
          id: string
          is_enabled: boolean
          is_follow_up: boolean
          last_synced_at: string | null
          last_synced_name: string | null
          name: string
          organization_id: string
          show_in_favorites: boolean
          sort_order: number
          updated_at: string
          writing_style: string
        }
        Insert: {
          additional_context?: string | null
          ai_draft_enabled?: boolean
          ai_generated_sample?: string | null
          auto_reply_enabled?: boolean
          color?: string
          connection_id?: string | null
          created_at?: string
          example_reply_template?: string | null
          format_style?: string | null
          id?: string
          is_enabled?: boolean
          is_follow_up?: boolean
          last_synced_at?: string | null
          last_synced_name?: string | null
          name: string
          organization_id: string
          show_in_favorites?: boolean
          sort_order?: number
          updated_at?: string
          writing_style?: string
        }
        Update: {
          additional_context?: string | null
          ai_draft_enabled?: boolean
          ai_generated_sample?: string | null
          auto_reply_enabled?: boolean
          color?: string
          connection_id?: string | null
          created_at?: string
          example_reply_template?: string | null
          format_style?: string | null
          id?: string
          is_enabled?: boolean
          is_follow_up?: boolean
          last_synced_at?: string | null
          last_synced_name?: string | null
          name?: string
          organization_id?: string
          show_in_favorites?: boolean
          sort_order?: number
          updated_at?: string
          writing_style?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          agent_conversation_id: string | null
          created_at: string | null
          folder_id: string | null
          id: string
          is_archived: boolean | null
          organization_id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_conversation_id?: string | null
          created_at?: string | null
          folder_id?: string | null
          id?: string
          is_archived?: boolean | null
          organization_id: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_conversation_id?: string | null
          created_at?: string | null
          folder_id?: string | null
          id?: string
          is_archived?: boolean | null
          organization_id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "chat_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          organization_id: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachments: Json | null
          citations: Json | null
          completion_tokens: number | null
          content: string
          conversation_id: string
          cost_usd: number | null
          created_at: string | null
          id: string
          model_used: string | null
          prompt_tokens: number | null
          role: string
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          citations?: Json | null
          completion_tokens?: number | null
          content: string
          conversation_id: string
          cost_usd?: number | null
          created_at?: string | null
          id?: string
          model_used?: string | null
          prompt_tokens?: number | null
          role: string
          user_id: string
        }
        Update: {
          attachments?: Json | null
          citations?: Json | null
          completion_tokens?: number | null
          content?: string
          conversation_id?: string
          cost_usd?: number | null
          created_at?: string | null
          id?: string
          model_used?: string | null
          prompt_tokens?: number | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_attempts: {
        Row: {
          app_origin: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          meta: Json
          organization_id: string
          provider: string
          stage: string
          user_id: string
        }
        Insert: {
          app_origin?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          meta?: Json
          organization_id: string
          provider: string
          stage: string
          user_id: string
        }
        Update: {
          app_origin?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          meta?: Json
          organization_id?: string
          provider?: string
          stage?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_brief_schedules: {
        Row: {
          brief_type: string
          connection_id: string | null
          created_at: string
          day_of_week: number
          id: string
          is_enabled: boolean
          last_sent_at: string | null
          organization_id: string
          recipient_email: string | null
          send_time: string
          sender_email: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brief_type?: string
          connection_id?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_enabled?: boolean
          last_sent_at?: string | null
          organization_id: string
          recipient_email?: string | null
          send_time: string
          sender_email?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brief_type?: string
          connection_id?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_enabled?: boolean
          last_sent_at?: string | null
          organization_id?: string
          recipient_email?: string | null
          send_time?: string
          sender_email?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discovered_tenant_users: {
        Row: {
          account_enabled: boolean
          created_at: string
          department: string | null
          display_name: string | null
          domain_id: string
          email: string
          id: string
          invited_at: string | null
          invited_user_id: string | null
          is_licensed: boolean
          job_title: string | null
          last_seen_at: string
          ms_user_id: string
          office_location: string | null
          organization_id: string
          profile_photo_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_enabled?: boolean
          created_at?: string
          department?: string | null
          display_name?: string | null
          domain_id: string
          email: string
          id?: string
          invited_at?: string | null
          invited_user_id?: string | null
          is_licensed?: boolean
          job_title?: string | null
          last_seen_at?: string
          ms_user_id: string
          office_location?: string | null
          organization_id: string
          profile_photo_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_enabled?: boolean
          created_at?: string
          department?: string | null
          display_name?: string | null
          domain_id?: string
          email?: string
          id?: string
          invited_at?: string | null
          invited_user_id?: string | null
          is_licensed?: boolean
          job_title?: string | null
          last_seen_at?: string
          ms_user_id?: string
          office_location?: string | null
          organization_id?: string
          profile_photo_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovered_tenant_users_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovered_tenant_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          body_clean: string | null
          body_raw: string | null
          cc_emails: string[]
          connection_id: string
          created_at: string
          embedding: string | null
          from_email: string | null
          id: string
          metadata: Json
          organization_id: string
          provider: string
          provider_message_id: string
          sent_at: string | null
          subject: string | null
          thread_id: string | null
          to_emails: string[]
          user_id: string
        }
        Insert: {
          body_clean?: string | null
          body_raw?: string | null
          cc_emails?: string[]
          connection_id: string
          created_at?: string
          embedding?: string | null
          from_email?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          provider: string
          provider_message_id: string
          sent_at?: string | null
          subject?: string | null
          thread_id?: string | null
          to_emails?: string[]
          user_id: string
        }
        Update: {
          body_clean?: string | null
          body_raw?: string | null
          cc_emails?: string[]
          connection_id?: string
          created_at?: string
          embedding?: string | null
          from_email?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          provider?: string
          provider_message_id?: string
          sent_at?: string | null
          subject?: string | null
          thread_id?: string | null
          to_emails?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_profiles: {
        Row: {
          connection_id: string
          created_at: string
          default_meeting_duration: number
          email_signature: string | null
          full_name: string | null
          id: string
          mobile: string | null
          organization_id: string
          phone: string | null
          profile_photo_url: string | null
          show_company_logo: boolean | null
          show_profile_photo: boolean | null
          signature_color: string | null
          signature_enabled: boolean
          signature_font: string | null
          signature_logo_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          connection_id: string
          created_at?: string
          default_meeting_duration?: number
          email_signature?: string | null
          full_name?: string | null
          id?: string
          mobile?: string | null
          organization_id: string
          phone?: string | null
          profile_photo_url?: string | null
          show_company_logo?: boolean | null
          show_profile_photo?: boolean | null
          signature_color?: string | null
          signature_enabled?: boolean
          signature_font?: string | null
          signature_logo_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          connection_id?: string
          created_at?: string
          default_meeting_duration?: number
          email_signature?: string | null
          full_name?: string | null
          id?: string
          mobile?: string | null
          organization_id?: string
          phone?: string | null
          profile_photo_url?: string | null
          show_company_logo?: boolean | null
          show_profile_photo?: boolean | null
          signature_color?: string | null
          signature_enabled?: boolean
          signature_font?: string | null
          signature_logo_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_profiles_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_threads: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          last_message_at: string | null
          message_count: number
          metadata: Json
          organization_id: string
          participants: string[]
          provider: string
          provider_thread_id: string
          subject: string | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          metadata?: Json
          organization_id: string
          participants?: string[]
          provider: string
          provider_thread_id: string
          subject?: string | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          metadata?: Json
          organization_id?: string
          participants?: string[]
          provider?: string
          provider_thread_id?: string
          subject?: string | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      extraction_regression_log: {
        Row: {
          connection_id: string | null
          created_at: string
          duration_ms: number | null
          error_kind: string | null
          error_message: string | null
          external_id: string | null
          file_name: string | null
          id: string
          source_type: string
          status: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_kind?: string | null
          error_message?: string | null
          external_id?: string | null
          file_name?: string | null
          id?: string
          source_type: string
          status: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_kind?: string | null
          error_message?: string | null
          external_id?: string | null
          file_name?: string | null
          id?: string
          source_type?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      feature_model_pricing: {
        Row: {
          dollar_per_task: number
          feature_id: string
          last_updated: string
          model_id: string
          updated_by: string | null
        }
        Insert: {
          dollar_per_task: number
          feature_id: string
          last_updated?: string
          model_id: string
          updated_by?: string | null
        }
        Update: {
          dollar_per_task?: number
          feature_id?: string
          last_updated?: string
          model_id?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      follow_up_settings: {
        Row: {
          auto_draft_enabled: boolean
          auto_reply_enabled: boolean
          bcc_domain: string
          business_days: number[]
          business_hours_end: number
          business_hours_only: boolean
          business_hours_start: number
          connection_id: string
          created_at: string
          daily_audit_enabled: boolean
          id: string
          is_enabled: boolean
          last_audit_at: string | null
          last_audit_summary: Json | null
          organization_id: string
          reminder_intervals_days: number[]
          reminder_max_count: number
          skip_if_replied: boolean
          stop_aliases: string[]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_draft_enabled?: boolean
          auto_reply_enabled?: boolean
          bcc_domain?: string
          business_days?: number[]
          business_hours_end?: number
          business_hours_only?: boolean
          business_hours_start?: number
          connection_id: string
          created_at?: string
          daily_audit_enabled?: boolean
          id?: string
          is_enabled?: boolean
          last_audit_at?: string | null
          last_audit_summary?: Json | null
          organization_id: string
          reminder_intervals_days?: number[]
          reminder_max_count?: number
          skip_if_replied?: boolean
          stop_aliases?: string[]
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_draft_enabled?: boolean
          auto_reply_enabled?: boolean
          bcc_domain?: string
          business_days?: number[]
          business_hours_end?: number
          business_hours_only?: boolean
          business_hours_start?: number
          connection_id?: string
          created_at?: string
          daily_audit_enabled?: boolean
          id?: string
          is_enabled?: boolean
          last_audit_at?: string | null
          last_audit_summary?: Json | null
          organization_id?: string
          reminder_intervals_days?: number[]
          reminder_max_count?: number
          skip_if_replied?: boolean
          stop_aliases?: string[]
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      follow_up_trackers: {
        Row: {
          action_mode: string
          auto_sent_at: string | null
          bcc_alias: string
          cancellation_alias: string | null
          cancelled_at: string | null
          cc_recipients: Json
          connection_id: string
          conversation_id: string | null
          created_at: string
          days_after_send: number
          draft_id: string | null
          drafted_at: string | null
          due_at: string
          id: string
          last_reminder_at: string | null
          message_id: string
          metadata: Json
          next_reminder_at: string | null
          organization_id: string
          reminder_count: number
          replied_at: string | null
          sent_at: string
          skip_reason: string | null
          status: string
          subject: string | null
          to_recipients: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          action_mode?: string
          auto_sent_at?: string | null
          bcc_alias: string
          cancellation_alias?: string | null
          cancelled_at?: string | null
          cc_recipients?: Json
          connection_id: string
          conversation_id?: string | null
          created_at?: string
          days_after_send: number
          draft_id?: string | null
          drafted_at?: string | null
          due_at: string
          id?: string
          last_reminder_at?: string | null
          message_id: string
          metadata?: Json
          next_reminder_at?: string | null
          organization_id: string
          reminder_count?: number
          replied_at?: string | null
          sent_at: string
          skip_reason?: string | null
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          action_mode?: string
          auto_sent_at?: string | null
          bcc_alias?: string
          cancellation_alias?: string | null
          cancelled_at?: string | null
          cc_recipients?: Json
          connection_id?: string
          conversation_id?: string | null
          created_at?: string
          days_after_send?: number
          draft_id?: string | null
          drafted_at?: string | null
          due_at?: string
          id?: string
          last_reminder_at?: string | null
          message_id?: string
          metadata?: Json
          next_reminder_at?: string | null
          organization_id?: string
          reminder_count?: number
          replied_at?: string | null
          sent_at?: string
          skip_reason?: string | null
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      group_cost_caps: {
        Row: {
          group_id: string
          id: string
          per_request_usd: number | null
          per_user_daily_usd: number | null
          per_user_monthly_usd: number | null
          per_user_weekly_usd: number | null
          updated_at: string | null
        }
        Insert: {
          group_id: string
          id?: string
          per_request_usd?: number | null
          per_user_daily_usd?: number | null
          per_user_monthly_usd?: number | null
          per_user_weekly_usd?: number | null
          updated_at?: string | null
        }
        Update: {
          group_id?: string
          id?: string
          per_request_usd?: number | null
          per_user_daily_usd?: number | null
          per_user_monthly_usd?: number | null
          per_user_weekly_usd?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_cost_caps_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_feature_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          domain_id: string
          feature_key: string
          group_id: string
          id: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain_id: string
          feature_key: string
          group_id: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain_id?: string
          feature_key?: string
          group_id?: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_feature_overrides_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_feature_overrides_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_features: {
        Row: {
          created_at: string
          daily_limit: number
          feature_key: string
          group_id: string
          id: string
          is_enabled: boolean
          limit_term: string
          model_assignment: string | null
          monthly_limit: number | null
          rollover: string
          updated_at: string
          weekly_limit: number | null
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          feature_key: string
          group_id: string
          id?: string
          is_enabled?: boolean
          limit_term?: string
          model_assignment?: string | null
          monthly_limit?: number | null
          rollover?: string
          updated_at?: string
          weekly_limit?: number | null
        }
        Update: {
          created_at?: string
          daily_limit?: number
          feature_key?: string
          group_id?: string
          id?: string
          is_enabled?: boolean
          limit_term?: string
          model_assignment?: string | null
          monthly_limit?: number | null
          rollover?: string
          updated_at?: string
          weekly_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "group_features_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      help_articles: {
        Row: {
          category: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          keywords: string[]
          slug: string
          sort_order: number
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          keywords?: string[]
          slug: string
          sort_order?: number
          summary?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          keywords?: string[]
          slug?: string
          sort_order?: number
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_health: {
        Row: {
          id: string
          integration_key: string
          last_checked_at: string
          latency_ms: number | null
          message: string | null
          metadata: Json
          status: string
          updated_at: string
        }
        Insert: {
          id?: string
          integration_key: string
          last_checked_at?: string
          latency_ms?: number | null
          message?: string | null
          metadata?: Json
          status: string
          updated_at?: string
        }
        Update: {
          id?: string
          integration_key?: string
          last_checked_at?: string
          latency_ms?: number | null
          message?: string | null
          metadata?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          id: string
          integration_key: string
          setting_key: string
          setting_value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          integration_key: string
          setting_key: string
          setting_value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          integration_key?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: string
          organization_id: string
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: string
          organization_id: string
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: string
          organization_id?: string
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          connection_id: string | null
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          organization_id: string
          token_count: number | null
          user_id: string
        }
        Insert: {
          chunk_index: number
          connection_id?: string | null
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          organization_id: string
          token_count?: number | null
          user_id: string
        }
        Update: {
          chunk_index?: number
          connection_id?: string | null
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          organization_id?: string
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          chunk_count: number
          connection_id: string | null
          content: string
          created_at: string
          error_message: string | null
          external_id: string | null
          extracted_metadata: Json
          extraction_error: string | null
          extraction_status: string
          id: string
          indexed_at: string | null
          metadata: Json
          organization_id: string
          source_ref: string | null
          source_type: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_count?: number
          connection_id?: string | null
          content: string
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          extracted_metadata?: Json
          extraction_error?: string | null
          extraction_status?: string
          id?: string
          indexed_at?: string | null
          metadata?: Json
          organization_id: string
          source_ref?: string | null
          source_type: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_count?: number
          connection_id?: string | null
          content?: string
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          extracted_metadata?: Json
          extraction_error?: string | null
          extraction_status?: string
          id?: string
          indexed_at?: string | null
          metadata?: Json
          organization_id?: string
          source_ref?: string | null
          source_type?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      llm_call_logs: {
        Row: {
          connection_id: string | null
          conversation_id: string | null
          cost_usd: number
          created_at: string
          error: string | null
          id: string
          latency_ms: number | null
          metadata: Json
          model: string
          organization_id: string | null
          provider: string
          purpose: string | null
          tokens_in: number
          tokens_out: number
          user_id: string | null
        }
        Insert: {
          connection_id?: string | null
          conversation_id?: string | null
          cost_usd?: number
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          metadata?: Json
          model: string
          organization_id?: string | null
          provider: string
          purpose?: string | null
          tokens_in?: number
          tokens_out?: number
          user_id?: string | null
        }
        Update: {
          connection_id?: string | null
          conversation_id?: string | null
          cost_usd?: number
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          metadata?: Json
          model?: string
          organization_id?: string | null
          provider?: string
          purpose?: string | null
          tokens_in?: number
          tokens_out?: number
          user_id?: string | null
        }
        Relationships: []
      }
      m365_api_health: {
        Row: {
          api_name: string
          checked_at: string
          connection_id: string | null
          endpoint: string | null
          error_code: string | null
          error_message: string | null
          id: string
          response_ms: number | null
          status: string
          user_id: string
        }
        Insert: {
          api_name: string
          checked_at?: string
          connection_id?: string | null
          endpoint?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          response_ms?: number | null
          status: string
          user_id: string
        }
        Update: {
          api_name?: string
          checked_at?: string
          connection_id?: string | null
          endpoint?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          response_ms?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_api_health_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_sync_jobs: {
        Row: {
          completed_at: string | null
          connection_id: string
          created_at: string
          error_message: string | null
          id: string
          items_failed: number
          items_processed: number
          retry_after: string | null
          source: string
          started_at: string | null
          status: string
          sync_type: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          connection_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          items_failed?: number
          items_processed?: number
          retry_after?: string | null
          source: string
          started_at?: string | null
          status?: string
          sync_type: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          items_failed?: number
          items_processed?: number
          retry_after?: string | null
          source?: string
          started_at?: string | null
          status?: string
          sync_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_sync_jobs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_sync_state: {
        Row: {
          connection_id: string
          created_at: string
          delta_link: string | null
          id: string
          last_sync_at: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          delta_link?: string | null
          id?: string
          last_sync_at?: string | null
          source: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          delta_link?: string | null
          id?: string
          last_sync_at?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_sync_state_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_action_items: {
        Row: {
          assigned_to: string | null
          completed: boolean
          created_at: string
          description: string
          due_date: string | null
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          completed?: boolean
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          session_id: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          completed?: boolean
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_action_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "meeting_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_copilot_preferences: {
        Row: {
          copilot_enabled: boolean
          created_at: string
          id: string
          meeting_external_id: string
          tone_override: string | null
          user_id: string
        }
        Insert: {
          copilot_enabled?: boolean
          created_at?: string
          id?: string
          meeting_external_id: string
          tone_override?: string | null
          user_id: string
        }
        Update: {
          copilot_enabled?: boolean
          created_at?: string
          id?: string
          meeting_external_id?: string
          tone_override?: string | null
          user_id?: string
        }
        Relationships: []
      }
      meeting_copilot_settings: {
        Row: {
          auto_draft_followup: boolean
          auto_join_all: boolean
          created_at: string
          id: string
          microphone_device_id: string | null
          notify_detected: boolean
          notify_scheduled: boolean
          save_transcripts: boolean
          shortcuts: Json
          show_live_suggestions: boolean
          suggestion_style: string
          transcript_retention_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_draft_followup?: boolean
          auto_join_all?: boolean
          created_at?: string
          id?: string
          microphone_device_id?: string | null
          notify_detected?: boolean
          notify_scheduled?: boolean
          save_transcripts?: boolean
          shortcuts?: Json
          show_live_suggestions?: boolean
          suggestion_style?: string
          transcript_retention_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_draft_followup?: boolean
          auto_join_all?: boolean
          created_at?: string
          id?: string
          microphone_device_id?: string | null
          notify_detected?: boolean
          notify_scheduled?: boolean
          save_transcripts?: boolean
          shortcuts?: Json
          show_live_suggestions?: boolean
          suggestion_style?: string
          transcript_retention_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meeting_sessions: {
        Row: {
          attendees: Json
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          followup_body_html: string | null
          followup_subject: string | null
          id: string
          key_decisions: Json
          meeting_external_id: string | null
          meeting_title: string
          platform: string | null
          recap_email_sent_at: string | null
          recap_email_status: string | null
          started_at: string
          status: string
          summary: string | null
          summary_generated_at: string | null
          user_id: string
        }
        Insert: {
          attendees?: Json
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          followup_body_html?: string | null
          followup_subject?: string | null
          id?: string
          key_decisions?: Json
          meeting_external_id?: string | null
          meeting_title: string
          platform?: string | null
          recap_email_sent_at?: string | null
          recap_email_status?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          summary_generated_at?: string | null
          user_id: string
        }
        Update: {
          attendees?: Json
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          followup_body_html?: string | null
          followup_subject?: string | null
          id?: string
          key_decisions?: Json
          meeting_external_id?: string | null
          meeting_title?: string
          platform?: string | null
          recap_email_sent_at?: string | null
          recap_email_status?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          summary_generated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      meeting_suggestions: {
        Row: {
          content: string
          generated_at: string
          id: string
          session_id: string
          suggestion_type: string | null
          used: boolean
          user_id: string
        }
        Insert: {
          content: string
          generated_at?: string
          id?: string
          session_id: string
          suggestion_type?: string | null
          used?: boolean
          user_id: string
        }
        Update: {
          content?: string
          generated_at?: string
          id?: string
          session_id?: string
          suggestion_type?: string | null
          used?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_suggestions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "meeting_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_transcripts: {
        Row: {
          created_at: string
          id: string
          is_final: boolean
          session_id: string
          speaker: string | null
          speaker_color: string | null
          spoken_at: string
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_final?: boolean
          session_id: string
          speaker?: string | null
          speaker_color?: string | null
          spoken_at?: string
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_final?: boolean
          session_id?: string
          speaker?: string | null
          speaker_color?: string | null
          spoken_at?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "meeting_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_token_vault: {
        Row: {
          connection_id: string | null
          created_at: string | null
          encrypted_access_token: string
          encrypted_refresh_token: string | null
          expires_at: string | null
          id: string
          last_refresh_at: string | null
          last_refresh_error: string | null
          provider: string
          refresh_failure_count: number
          requires_reauth: boolean
          updated_at: string | null
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string | null
          encrypted_access_token: string
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          last_refresh_at?: string | null
          last_refresh_error?: string | null
          provider: string
          refresh_failure_count?: number
          requires_reauth?: boolean
          updated_at?: string | null
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string | null
          encrypted_access_token?: string
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          last_refresh_at?: string | null
          last_refresh_error?: string | null
          provider?: string
          refresh_failure_count?: number
          requires_reauth?: boolean
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_token_vault_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      org_agent_budget: {
        Row: {
          alert_email: string | null
          alert_thresholds: number[]
          auto_pause_enabled: boolean
          current_day: string
          current_month: string
          daily_usd_cap: number
          max_concurrent_runs: number
          monthly_usd_cap: number
          organization_id: string
          paused: boolean
          paused_reason: string | null
          spent_month_usd: number
          spent_today_usd: number
          updated_at: string
        }
        Insert: {
          alert_email?: string | null
          alert_thresholds?: number[]
          auto_pause_enabled?: boolean
          current_day?: string
          current_month?: string
          daily_usd_cap?: number
          max_concurrent_runs?: number
          monthly_usd_cap?: number
          organization_id: string
          paused?: boolean
          paused_reason?: string | null
          spent_month_usd?: number
          spent_today_usd?: number
          updated_at?: string
        }
        Update: {
          alert_email?: string | null
          alert_thresholds?: number[]
          auto_pause_enabled?: boolean
          current_day?: string
          current_month?: string
          daily_usd_cap?: number
          max_concurrent_runs?: number
          monthly_usd_cap?: number
          organization_id?: string
          paused?: boolean
          paused_reason?: string | null
          spent_month_usd?: number
          spent_today_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_agent_budget_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      permission_group_domain_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          domain_id: string
          group_id: string
          id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain_id: string
          group_id: string
          id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_group_domain_assignments_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_group_domain_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          domain_id: string | null
          id: string
          is_default_for_new_users: boolean
          max_categories: number
          monthly_price: number | null
          name: string
          organization_id: string
          price_per_user_mo: number
          scope_domain: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          domain_id?: string | null
          id?: string
          is_default_for_new_users?: boolean
          max_categories?: number
          monthly_price?: number | null
          name: string
          organization_id: string
          price_per_user_mo?: number
          scope_domain?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          domain_id?: string | null
          id?: string
          is_default_for_new_users?: boolean
          max_categories?: number
          monthly_price?: number | null
          name?: string
          organization_id?: string
          price_per_user_mo?: number
          scope_domain?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_groups_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_emails: {
        Row: {
          action_type: string
          category_id: string
          created_at: string
          draft_id: string | null
          email_id: string
          id: string
          organization_id: string
          provider: string
          sent_at: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          category_id: string
          created_at?: string
          draft_id?: string | null
          email_id: string
          id?: string
          organization_id: string
          provider: string
          sent_at?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          category_id?: string
          created_at?: string
          draft_id?: string | null
          email_id?: string
          id?: string
          organization_id?: string
          provider?: string
          sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processed_emails_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processed_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_connections: {
        Row: {
          calendar_connected: boolean
          calendar_connected_at: string | null
          connected_at: string | null
          connected_email: string | null
          created_at: string
          id: string
          inbox_followup_folder_id: string | null
          is_connected: boolean
          organization_id: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_connected?: boolean
          calendar_connected_at?: string | null
          connected_at?: string | null
          connected_email?: string | null
          created_at?: string
          id?: string
          inbox_followup_folder_id?: string | null
          is_connected?: boolean
          organization_id: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_connected?: boolean
          calendar_connected_at?: string | null
          connected_at?: string | null
          connected_email?: string | null
          created_at?: string
          id?: string
          inbox_followup_folder_id?: string | null
          is_connected?: boolean
          organization_id?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          body_contains: string | null
          category_id: string
          condition_logic: string
          connection_id: string | null
          created_at: string
          id: string
          is_advanced: boolean
          is_enabled: boolean
          last_synced_at: string | null
          organization_id: string
          recipient_filter: string | null
          rule_type: string
          rule_value: string
          subject_contains: string | null
          updated_at: string
        }
        Insert: {
          body_contains?: string | null
          category_id: string
          condition_logic?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          is_advanced?: boolean
          is_enabled?: boolean
          last_synced_at?: string | null
          organization_id: string
          recipient_filter?: string | null
          rule_type: string
          rule_value: string
          subject_contains?: string | null
          updated_at?: string
        }
        Update: {
          body_contains?: string | null
          category_id?: string
          condition_logic?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          is_advanced?: boolean
          is_enabled?: boolean
          last_synced_at?: string | null
          organization_id?: string
          recipient_filter?: string | null
          rule_type?: string
          rule_value?: string
          subject_contains?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_provider_config: {
        Row: {
          account_sid_hint: string | null
          created_at: string
          enabled: boolean
          from_number: string | null
          id: string
          provider: string
          updated_at: string
        }
        Insert: {
          account_sid_hint?: string | null
          created_at?: string
          enabled?: boolean
          from_number?: string | null
          id?: string
          provider?: string
          updated_at?: string
        }
        Update: {
          account_sid_hint?: string | null
          created_at?: string
          enabled?: boolean
          from_number?: string | null
          id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          organization_id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_issues: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string
          id: string
          organization_id: string
          page_url: string | null
          resolved_at: string | null
          status: string
          subject: string
          updated_at: string
          user_agent: string | null
          user_email: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description: string
          id?: string
          organization_id: string
          page_url?: string | null
          resolved_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_agent?: string | null
          user_email: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          page_url?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_agent?: string | null
          user_email?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_flags: {
        Row: {
          flag_key: string
          flag_value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          flag_key: string
          flag_value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          flag_key?: string
          flag_value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tool_diagnostics: {
        Row: {
          connection_id: string | null
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          error_kind: string | null
          error_message: string | null
          id: string
          organization_id: string | null
          status: string
          tool: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_kind?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          status: string
          tool: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_kind?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          status?: string
          tool?: string
          user_id?: string
        }
        Relationships: []
      }
      user_ai_profiles: {
        Row: {
          communication_style: string | null
          created_at: string
          custom_context: string | null
          id: string
          responsibilities: string | null
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          communication_style?: string | null
          created_at?: string
          custom_context?: string | null
          id?: string
          responsibilities?: string | null
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          communication_style?: string | null
          created_at?: string
          custom_context?: string | null
          id?: string
          responsibilities?: string | null
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_daily_spend: {
        Row: {
          day: string
          group_id: string | null
          id: string
          month: string
          organization_id: string
          request_count_today: number
          spent_month_usd: number
          spent_today_usd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          day?: string
          group_id?: string | null
          id?: string
          month?: string
          organization_id: string
          request_count_today?: number
          spent_month_usd?: number
          spent_today_usd?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          day?: string
          group_id?: string | null
          id?: string
          month?: string
          organization_id?: string
          request_count_today?: number
          spent_month_usd?: number
          spent_today_usd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_daily_spend_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feature_access: {
        Row: {
          created_at: string
          feature_key: string
          granted_by: string | null
          id: string
          is_enabled: boolean
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          granted_by?: string | null
          id?: string
          is_enabled?: boolean
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          granted_by?: string | null
          id?: string
          is_enabled?: boolean
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feature_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_group_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          group_id: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_id: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_id?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_group_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_invitations: {
        Row: {
          created_at: string
          domain_id: string | null
          email: string
          expires_at: string
          full_name: string | null
          group_id: string | null
          id: string
          invited_by: string | null
          mode: string
          organization_id: string
          token: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          domain_id?: string | null
          email: string
          expires_at?: string
          full_name?: string | null
          group_id?: string | null
          id?: string
          invited_by?: string | null
          mode?: string
          organization_id: string
          token: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          domain_id?: string | null
          email?: string
          expires_at?: string
          full_name?: string | null
          group_id?: string | null
          id?: string
          invited_by?: string | null
          mode?: string
          organization_id?: string
          token?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_overrides: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          feature_key: string | null
          id: string
          is_active: boolean
          organization_id: string
          override_type: string
          override_value: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          feature_key?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          override_type: string
          override_value: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          feature_key?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          override_type?: string
          override_value?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          communication_style: string | null
          company: string | null
          created_at: string
          department: string | null
          department_source: string | null
          domain_id: string | null
          email: string
          email_signature: string | null
          full_name: string | null
          id: string
          job_title_m365: string | null
          microsoft_auto_connect: boolean
          mobile: string | null
          onboarding_completed_at: string | null
          organization_id: string
          phone: string | null
          profile_photo_url: string | null
          requires_outlook_connect: boolean
          responsibilities: string | null
          role_description: string | null
          show_help_icons: boolean
          signature_color: string | null
          signature_font: string | null
          signature_logo_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          communication_style?: string | null
          company?: string | null
          created_at?: string
          department?: string | null
          department_source?: string | null
          domain_id?: string | null
          email: string
          email_signature?: string | null
          full_name?: string | null
          id?: string
          job_title_m365?: string | null
          microsoft_auto_connect?: boolean
          mobile?: string | null
          onboarding_completed_at?: string | null
          organization_id: string
          phone?: string | null
          profile_photo_url?: string | null
          requires_outlook_connect?: boolean
          responsibilities?: string | null
          role_description?: string | null
          show_help_icons?: boolean
          signature_color?: string | null
          signature_font?: string | null
          signature_logo_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          communication_style?: string | null
          company?: string | null
          created_at?: string
          department?: string | null
          department_source?: string | null
          domain_id?: string | null
          email?: string
          email_signature?: string | null
          full_name?: string | null
          id?: string
          job_title_m365?: string | null
          microsoft_auto_connect?: boolean
          mobile?: string | null
          onboarding_completed_at?: string | null
          organization_id?: string
          phone?: string | null
          profile_photo_url?: string | null
          requires_outlook_connect?: boolean
          responsibilities?: string | null
          role_description?: string | null
          show_help_icons?: boolean
          signature_color?: string | null
          signature_font?: string | null
          signature_logo_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "allowed_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          departments: string[]
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          departments?: string[]
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          departments?: string[]
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_activity_report: {
        Args: {
          _department?: string
          _end: string
          _start: string
          _user_id?: string
        }
        Returns: {
          ai_drafts: number
          auto_replies: number
          chats: number
          cost_usd: number
          daily_briefs: number
          department: string
          email: string
          email_agent: number
          follow_up: number
          full_name: string
          last_active: string
          meeting_copilot: number
          tokens_in: number
          tokens_out: number
          total_actions: number
          user_id: string
        }[]
      }
      admin_activity_timeseries: {
        Args: {
          _department?: string
          _end: string
          _start: string
          _user_id?: string
        }
        Returns: {
          action: string
          cost_usd: number
          day: string
          events: number
        }[]
      }
      admin_list_org_users: {
        Args: { _organization_id: string }
        Returns: {
          department: string
          departments_admin: string[]
          email: string
          full_name: string
          roles: string[]
          user_id: string
        }[]
      }
      admin_visible_departments: {
        Args: never
        Returns: {
          department: string
          user_count: number
        }[]
      }
      admin_visible_user_ids: {
        Args: { _caller: string }
        Returns: {
          department: string
          email: string
          full_name: string
          organization_id: string
          user_id: string
        }[]
      }
      cache_get_response: {
        Args: { _hash: string }
        Returns: {
          attachments: Json
          model: string
          provider: string
          reply_html: string
        }[]
      }
      cache_put_response: {
        Args: {
          _attachments: Json
          _hash: string
          _model: string
          _org_id: string
          _provider: string
          _reply_html: string
        }
        Returns: undefined
      }
      cancel_trackers_for_conversation: {
        Args: {
          _alias: string
          _connection_id: string
          _conversation_id: string
        }
        Returns: {
          message_id: string
        }[]
      }
      check_and_reserve_budget: {
        Args: { _est_cost_usd?: number; _org_id: string }
        Returns: {
          allowed: boolean
          cap: number
          reason: string
          spent: number
        }[]
      }
      check_user_budget: {
        Args: {
          _est_cost_usd?: number
          _organization_id: string
          _user_id: string
        }
        Returns: {
          allowed: boolean
          daily_remaining: number
          group_id: string
          monthly_remaining: number
          reason: string
        }[]
      }
      cleanup_old_chat_conversations: { Args: never; Returns: number }
      cleanup_old_meeting_transcripts: { Args: never; Returns: undefined }
      count_followup_impact: {
        Args: { _group_id: string }
        Returns: {
          affected_users: number
          pending_reminders: number
        }[]
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      disconnect_provider: { Args: { _provider: string }; Returns: boolean }
      enforce_llm_limits: {
        Args: {
          _est_cost_usd?: number
          _fallback_model?: string
          _feature_key: string
          _organization_id: string
          _user_id: string
        }
        Returns: {
          allowed: boolean
          daily_count_remaining: number
          feature_enabled: boolean
          group_id: string
          model: string
          org_daily_remaining: number
          reason: string
          user_daily_remaining: number
          user_monthly_remaining: number
        }[]
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_no_reply_tracker_category: {
        Args: { _connection_id: string }
        Returns: {
          additional_context: string | null
          ai_draft_enabled: boolean
          ai_generated_sample: string | null
          auto_reply_enabled: boolean
          color: string
          connection_id: string | null
          created_at: string
          example_reply_template: string | null
          format_style: string | null
          id: string
          is_enabled: boolean
          is_follow_up: boolean
          last_synced_at: string | null
          last_synced_name: string | null
          name: string
          organization_id: string
          show_in_favorites: boolean
          sort_order: number
          updated_at: string
          writing_style: string
        }
        SetofOptions: {
          from: "*"
          to: "categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_feature_usage_summary: {
        Args: {
          _feature_keys: string[]
          _organization_id: string
          _user_id: string
        }
        Returns: {
          enabled: boolean
          feature_key: string
          is_unlimited: boolean
          limit_count: number
          limit_term: string
          model: string
          remaining_count: number
          used_count: number
          user_daily_cap: number
          user_daily_spent: number
          user_monthly_cap: number
          user_monthly_spent: number
        }[]
      }
      get_my_connections: {
        Args: never
        Returns: {
          calendar_connected: boolean
          calendar_connected_at: string
          connected_at: string
          connected_email: string
          id: string
          is_connected: boolean
          organization_id: string
          provider: string
        }[]
      }
      get_my_profile: {
        Args: never
        Returns: {
          communication_style: string
          company: string
          created_at: string
          department: string
          email: string
          full_name: string
          id: string
          mobile: string
          organization_id: string
          phone: string
          profile_photo_url: string
          responsibilities: string
          role_description: string
          title: string
          updated_at: string
          user_id: string
        }[]
      }
      get_or_create_follow_up_settings: {
        Args: { _connection_id: string }
        Returns: {
          auto_draft_enabled: boolean
          auto_reply_enabled: boolean
          bcc_domain: string
          business_days: number[]
          business_hours_end: number
          business_hours_only: boolean
          business_hours_start: number
          connection_id: string
          created_at: string
          daily_audit_enabled: boolean
          id: string
          is_enabled: boolean
          last_audit_at: string | null
          last_audit_summary: Json | null
          organization_id: string
          reminder_intervals_days: number[]
          reminder_max_count: number
          skip_if_replied: boolean
          stop_aliases: string[]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "follow_up_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_org_user_directory: {
        Args: { _organization_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      get_user_organization_id: { Args: { _user_id: string }; Returns: string }
      get_user_organizations: {
        Args: { _user_id: string }
        Returns: {
          id: string
          name: string
          role: string
        }[]
      }
      get_user_override: {
        Args: { _feature_key: string; _override_type: string; _user_id: string }
        Returns: string
      }
      get_users_basic_info: {
        Args: { _user_ids: string[] }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      has_feature: {
        Args: { _feature_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_in_org: {
        Args: {
          _organization_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_current_user_super_admin: { Args: never; Returns: boolean }
      is_dept_admin: {
        Args: {
          _department: string
          _organization_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_domain_allowed: { Args: { _email: string }; Returns: boolean }
      is_org_admin: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin:
        | { Args: never; Returns: boolean }
        | { Args: { _email: string }; Returns: boolean }
      match_email_messages: {
        Args: {
          match_count?: number
          p_connection_id: string
          p_user_id: string
          query_embedding: string
        }
        Returns: {
          body_clean: string
          from_email: string
          id: string
          sent_at: string
          similarity: number
          subject: string
          thread_id: string
        }[]
      }
      match_knowledge_chunks: {
        Args: {
          match_count?: number
          p_connection_id: string
          p_user_id: string
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          id: string
          similarity: number
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      pause_followups_without_permission: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_agent_spend: {
        Args: { _cost_usd: number; _org_id: string }
        Returns: undefined
      }
      record_llm_spend: {
        Args: {
          _cost_usd: number
          _feature_key: string
          _group_id: string
          _metadata?: Json
          _model: string
          _organization_id: string
          _provider: string
          _tokens_in: number
          _tokens_out: number
          _user_id: string
        }
        Returns: undefined
      }
      record_user_spend: {
        Args: {
          _cost_usd: number
          _group_id: string
          _organization_id: string
          _user_id: string
        }
        Returns: undefined
      }
      resume_followups_with_permission: { Args: never; Returns: number }
      search_knowledge_hybrid: {
        Args: {
          match_count?: number
          p_connection_id?: string
          p_user_id: string
          query_embedding: string
          query_text: string
          strict_connection?: boolean
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          combined_score: number
          connection_id: string
          content: string
          document_id: string
          extracted_metadata: Json
          keyword_rank: number
          similarity: number
          source_ref: string
          source_type: string
          title: string
        }[]
      }
      signup_initialize_user: {
        Args: {
          _full_name: string
          _organization_name?: string
          _title?: string
        }
        Returns: string
      }
      trim_categories_to_group_cap: {
        Args: { _group_id?: string }
        Returns: number
      }
      try_acquire_conversation_lock: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      update_my_about_me: {
        Args: {
          _business_phone?: string
          _communication_style?: string
          _company?: string
          _department?: string
          _full_name?: string
          _mobile_phone?: string
          _responsibilities?: string
          _title?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "member" | "super_admin" | "org_admin" | "dept_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member", "super_admin", "org_admin", "dept_admin"],
    },
  },
} as const
