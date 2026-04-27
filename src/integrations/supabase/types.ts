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
          connection_id: string | null
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
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
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
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
          ai_calendar_event_color: string | null
          ai_draft_label_color: string | null
          ai_sent_label_color: string | null
          connection_id: string | null
          created_at: string
          id: string
          organization_id: string
          updated_at: string
          writing_style: string
        }
        Insert: {
          ai_calendar_event_color?: string | null
          ai_draft_label_color?: string | null
          ai_sent_label_color?: string | null
          connection_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          updated_at?: string
          writing_style?: string
        }
        Update: {
          ai_calendar_event_color?: string | null
          ai_draft_label_color?: string | null
          ai_sent_label_color?: string | null
          connection_id?: string | null
          created_at?: string
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
          completion_tokens: number
          cost_usd: number
          created_at: string
          id: string
          metadata: Json
          model: string
          organization_id: string
          prompt_tokens: number
          provider: string
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          metadata?: Json
          model: string
          organization_id: string
          prompt_tokens?: number
          provider: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          metadata?: Json
          model?: string
          organization_id?: string
          prompt_tokens?: number
          provider?: string
          total_tokens?: number | null
          user_id?: string | null
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
      categories: {
        Row: {
          ai_draft_enabled: boolean
          auto_reply_enabled: boolean
          color: string
          connection_id: string | null
          created_at: string
          id: string
          is_enabled: boolean
          is_follow_up: boolean
          last_synced_at: string | null
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
          writing_style: string
        }
        Insert: {
          ai_draft_enabled?: boolean
          auto_reply_enabled?: boolean
          color?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_follow_up?: boolean
          last_synced_at?: string | null
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
          writing_style?: string
        }
        Update: {
          ai_draft_enabled?: boolean
          auto_reply_enabled?: boolean
          color?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_follow_up?: boolean
          last_synced_at?: string | null
          name?: string
          organization_id?: string
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
      discovered_tenant_users: {
        Row: {
          account_enabled: boolean
          created_at: string
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
          organization_id: string
          profile_photo_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_enabled?: boolean
          created_at?: string
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
          organization_id: string
          profile_photo_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_enabled?: boolean
          created_at?: string
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
      follow_up_trackers: {
        Row: {
          bcc_alias: string
          cc_recipients: Json
          connection_id: string
          conversation_id: string | null
          created_at: string
          days_after_send: number
          draft_id: string | null
          drafted_at: string | null
          due_at: string
          id: string
          message_id: string
          metadata: Json
          organization_id: string
          replied_at: string | null
          sent_at: string
          status: string
          subject: string | null
          to_recipients: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          bcc_alias: string
          cc_recipients?: Json
          connection_id: string
          conversation_id?: string | null
          created_at?: string
          days_after_send: number
          draft_id?: string | null
          drafted_at?: string | null
          due_at: string
          id?: string
          message_id: string
          metadata?: Json
          organization_id: string
          replied_at?: string | null
          sent_at: string
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          bcc_alias?: string
          cc_recipients?: Json
          connection_id?: string
          conversation_id?: string | null
          created_at?: string
          days_after_send?: number
          draft_id?: string | null
          drafted_at?: string | null
          due_at?: string
          id?: string
          message_id?: string
          metadata?: Json
          organization_id?: string
          replied_at?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          feature_key: string
          group_id: string
          id: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          group_id: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          group_id?: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
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
      oauth_token_vault: {
        Row: {
          created_at: string | null
          encrypted_access_token: string
          encrypted_refresh_token: string | null
          expires_at: string | null
          id: string
          provider: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          encrypted_access_token: string
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          provider: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          encrypted_access_token?: string
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          provider?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      permission_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          domain_id: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          domain_id?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          domain_id?: string | null
          id?: string
          name?: string
          organization_id?: string
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
          temp_password: string | null
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
          temp_password?: string | null
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
          temp_password?: string | null
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
      user_profiles: {
        Row: {
          created_at: string
          domain_id: string | null
          email: string
          email_signature: string | null
          full_name: string | null
          id: string
          microsoft_auto_connect: boolean
          mobile: string | null
          organization_id: string
          phone: string | null
          profile_photo_url: string | null
          requires_outlook_connect: boolean
          signature_color: string | null
          signature_font: string | null
          signature_logo_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          created_at?: string
          domain_id?: string | null
          email: string
          email_signature?: string | null
          full_name?: string | null
          id?: string
          microsoft_auto_connect?: boolean
          mobile?: string | null
          organization_id: string
          phone?: string | null
          profile_photo_url?: string | null
          requires_outlook_connect?: boolean
          signature_color?: string | null
          signature_font?: string | null
          signature_logo_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          created_at?: string
          domain_id?: string | null
          email?: string
          email_signature?: string | null
          full_name?: string | null
          id?: string
          microsoft_auto_connect?: boolean
          mobile?: string | null
          organization_id?: string
          phone?: string | null
          profile_photo_url?: string | null
          requires_outlook_connect?: boolean
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
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      disconnect_provider: { Args: { _provider: string }; Returns: boolean }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
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
          created_at: string
          email: string
          full_name: string
          id: string
          organization_id: string
          title: string
          updated_at: string
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
      is_domain_allowed: { Args: { _email: string }; Returns: boolean }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _email: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
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
    }
    Enums: {
      app_role: "admin" | "member"
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
      app_role: ["admin", "member"],
    },
  },
} as const
