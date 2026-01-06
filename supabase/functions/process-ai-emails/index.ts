import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AES-GCM decryption for tokens
async function decryptToken(encryptedData: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  return new TextDecoder().decode(decrypted);
}

// AES-GCM encryption for tokens
async function encryptToken(token: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString.padEnd(32, '0').slice(0, 32));
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(token)
  );
  
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

// Refresh Google access token
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) {
    console.error('Failed to refresh Google token:', await response.text());
    return null;
  }
  
  return await response.json();
}

// Refresh Microsoft access token
async function refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) {
    console.error('Failed to refresh Microsoft token:', await response.text());
    return null;
  }
  
  return await response.json();
}

interface TokenData {
  provider: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

// Get valid access token, refreshing if expired
async function getValidAccessToken(
  tokenData: TokenData,
  encryptionKey: string,
  userId: string
): Promise<string | null> {
  const isExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
  
  if (!isExpired) {
    return await decryptToken(tokenData.encrypted_access_token, encryptionKey);
  }
  
  console.log(`Token for ${tokenData.provider} is expired, refreshing...`);
  
  if (!tokenData.encrypted_refresh_token) {
    console.error(`No refresh token available for ${tokenData.provider}`);
    return null;
  }
  
  const refreshToken = await decryptToken(tokenData.encrypted_refresh_token, encryptionKey);
  let newTokens;
  
  if (tokenData.provider === 'google') {
    newTokens = await refreshGoogleToken(refreshToken);
  } else if (tokenData.provider === 'microsoft') {
    newTokens = await refreshMicrosoftToken(refreshToken);
  }
  
  if (!newTokens) return null;
  
  // Update token in vault
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const encryptedAccessToken = await encryptToken(newTokens.access_token, encryptionKey);
  const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
  
  const updatePayload: Record<string, string> = {
    encrypted_access_token: encryptedAccessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };
  
  if (tokenData.provider === 'microsoft' && 'refresh_token' in newTokens && newTokens.refresh_token) {
    updatePayload.encrypted_refresh_token = await encryptToken(String(newTokens.refresh_token), encryptionKey);
  }
  
  await fetch(
    `${supabaseUrl}/rest/v1/oauth_token_vault?user_id=eq.${userId}&provider=eq.${tokenData.provider}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updatePayload)
    }
  );
  
  return newTokens.access_token;
}

// Writing style prompts - STRICTLY ENFORCED
const WRITING_STYLE_PROMPTS: Record<string, string> = {
  professional: `WRITING STYLE: Professional & Polished
STRICT REQUIREMENTS:
- Use formal business language with proper grammar
- Maintain a respectful, authoritative tone
- Be thorough but concise - no fluff
- Use complete sentences and proper paragraphs
- Include appropriate professional greetings and sign-offs
- Avoid casual language, slang, or contractions`,

  friendly: `WRITING STYLE: Friendly & Approachable
STRICT REQUIREMENTS:
- Use warm, conversational language
- Be personable and relatable while professional
- Use contractions naturally (I'm, we're, you'll)
- Keep a positive, upbeat, helpful tone
- Be accommodating and show genuine interest
- Make the reader feel comfortable`,

  concierge: `WRITING STYLE: Concierge / White-Glove
STRICT REQUIREMENTS:
- Use elegant, refined, sophisticated language
- Be exceptionally courteous and attentive
- Use phrases like "It would be my pleasure", "I'm delighted to assist", "Please allow me to"
- Anticipate needs and offer proactive assistance
- Make the recipient feel valued, important, and well-cared for
- Show attention to detail in every sentence`,

  direct: `WRITING STYLE: Direct & Efficient
STRICT REQUIREMENTS:
- Get straight to the point immediately
- Use SHORT, CLEAR sentences only
- NO unnecessary pleasantries or small talk
- Focus ONLY on actionable information
- Be brief but not rude - just efficient
- Maximum 3-4 sentences for simple replies`,

  empathetic: `WRITING STYLE: Empathetic & Supportive
STRICT REQUIREMENTS:
- Acknowledge emotions and concerns explicitly
- Use understanding, compassionate language
- Validate the recipient's situation first
- Offer reassurance and emotional support
- Be patient and thorough in explanations
- Show you genuinely care about their needs`,
};

// Format style prompts - STRICTLY ENFORCED
const FORMAT_STYLE_PROMPTS: Record<string, string> = {
  concise: `RESPONSE FORMAT: Concise/Short
STRICT FORMAT RULES:
- Keep the ENTIRE response under 100 words
- Use minimal words while conveying the complete message
- No unnecessary elaboration
- Get to the point quickly`,

  detailed: `RESPONSE FORMAT: Detailed
STRICT FORMAT RULES:
- Provide a thorough explanation with full context
- Include reasoning and background information
- Cover all aspects of the topic comprehensively
- Use multiple paragraphs if needed`,

  'bullet-points': `RESPONSE FORMAT: Bullet Points
STRICT FORMAT RULES:
- Structure the MAIN content using bullet points (• or -)
- Each bullet should be a clear, complete point
- Use bullets for lists, steps, or key items
- Keep greeting and sign-off as regular text`,

  highlights: `RESPONSE FORMAT: Key Highlights Only
STRICT FORMAT RULES:
- Focus ONLY on the most important points
- Skip any background or context
- No fluff or filler content
- Maximum 2-3 key takeaways`,
};

// Category context
const CATEGORY_CONTEXT: Record<string, string> = {
  'Urgent': 'This is an urgent matter requiring immediate attention. Respond promptly.',
  'Follow Up': 'This is a follow-up to a previous conversation. Reference prior context.',
  'Approvals': 'This relates to approving or reviewing something. Be clear and decisive.',
  'Meetings': 'This relates to scheduling, confirming, or discussing meetings. Be specific with times. If you schedule a meeting, include the exact date, time, and duration.',
  'Customers': 'This is client-facing communication. Represent the business professionally.',
  'Vendors': 'This is communication with vendors, suppliers, or external partners.',
  'Internal': 'This is internal team communication. Can be slightly less formal.',
  'Projects': 'This relates to project updates, deliverables, or workstreams. Be specific.',
  'Finance': 'This relates to billing, payments, receipts, or financial matters. Be precise.',
  'FYI': 'This is informational communication for awareness. Keep it brief.',
};

// Interface for parsed meeting from AI response
interface ParsedMeeting {
  title: string;
  startDateTime: string; // ISO format
  endDateTime: string; // ISO format
  attendees: string[];
  description?: string;
}

// Create Google Calendar event with invite
async function createGoogleCalendarEvent(
  accessToken: string,
  meeting: ParsedMeeting,
  eventColor: string
): Promise<{ eventId: string; htmlLink: string } | null> {
  try {
    // Map hex color to Google Calendar colorId (1-11)
    const colorId = hexToGoogleCalendarColor(eventColor);
    
    const event = {
      summary: meeting.title,
      description: meeting.description || '',
      start: {
        dateTime: meeting.startDateTime,
        timeZone: 'UTC'
      },
      end: {
        dateTime: meeting.endDateTime,
        timeZone: 'UTC'
      },
      attendees: meeting.attendees.map(email => ({ email })),
      colorId: colorId,
      sendUpdates: 'all' // Send invite emails to all attendees
    };

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    if (!res.ok) {
      console.error('Failed to create Google Calendar event:', await res.text());
      return null;
    }

    const createdEvent = await res.json();
    console.log(`Created Google Calendar event: ${createdEvent.id}`);
    return { eventId: createdEvent.id, htmlLink: createdEvent.htmlLink };
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    return null;
  }
}

// Map hex color to Google Calendar colorId
function hexToGoogleCalendarColor(hex: string): string {
  const lowerHex = hex.toLowerCase();
  
  // Purple shades (default for AI events)
  if (lowerHex.includes('9333ea') || lowerHex.includes('8b5cf6') || lowerHex.includes('7c3aed')) {
    return '3'; // Purple/Grape
  }
  // Blue shades
  if (lowerHex.includes('3b82f6') || lowerHex.includes('2563eb')) {
    return '9'; // Blue
  }
  // Green shades
  if (lowerHex.includes('22c55e') || lowerHex.includes('16a34a')) {
    return '10'; // Green
  }
  // Red shades
  if (lowerHex.includes('ef4444') || lowerHex.includes('dc2626')) {
    return '11'; // Red
  }
  // Orange shades
  if (lowerHex.includes('f97316') || lowerHex.includes('ea580c')) {
    return '6'; // Orange
  }
  // Default to purple for AI events
  return '3';
}

// Create Microsoft Calendar event with invite
async function createMicrosoftCalendarEvent(
  accessToken: string,
  meeting: ParsedMeeting,
  _eventColor: string // Microsoft doesn't support event colors in the same way
): Promise<{ eventId: string; webLink: string } | null> {
  try {
    const event = {
      subject: meeting.title,
      body: {
        contentType: 'HTML',
        content: meeting.description || ''
      },
      start: {
        dateTime: meeting.startDateTime,
        timeZone: 'UTC'
      },
      end: {
        dateTime: meeting.endDateTime,
        timeZone: 'UTC'
      },
      attendees: meeting.attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required'
      })),
      isOnlineMeeting: false
    };

    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    if (!res.ok) {
      console.error('Failed to create Microsoft Calendar event:', await res.text());
      return null;
    }

    const createdEvent = await res.json();
    console.log(`Created Microsoft Calendar event: ${createdEvent.id}`);
    return { eventId: createdEvent.id, webLink: createdEvent.webLink };
  } catch (error) {
    console.error('Error creating Microsoft Calendar event:', error);
    return null;
  }
}

// Parse meeting details from AI response
function parseMeetingFromAIResponse(
  aiResponse: string,
  emailFrom: string,
  emailSubject: string
): ParsedMeeting | null {
  // Look for meeting marker in AI response
  const meetingMarker = '[[MEETING:';
  const markerStart = aiResponse.indexOf(meetingMarker);
  
  if (markerStart === -1) {
    return null;
  }
  
  const markerEnd = aiResponse.indexOf(']]', markerStart);
  if (markerEnd === -1) {
    return null;
  }
  
  const meetingJson = aiResponse.substring(markerStart + meetingMarker.length, markerEnd);
  
  try {
    const meetingData = JSON.parse(meetingJson);
    
    // Extract sender email from "From" field (e.g., "John Doe <john@example.com>")
    const emailMatch = emailFrom.match(/<([^>]+)>/) || [null, emailFrom];
    const senderEmail = emailMatch[1] || emailFrom;
    
    return {
      title: meetingData.title || `Meeting: ${emailSubject}`,
      startDateTime: meetingData.start,
      endDateTime: meetingData.end,
      attendees: [senderEmail, ...(meetingData.attendees || [])],
      description: meetingData.description || `Meeting scheduled via AI assistant regarding: ${emailSubject}`
    };
  } catch (error) {
    console.error('Failed to parse meeting JSON:', error);
    return null;
  }
}

// Remove meeting marker from AI response for clean email body
function removeMeetingMarkerFromResponse(aiResponse: string): string {
  const meetingMarker = '[[MEETING:';
  const markerStart = aiResponse.indexOf(meetingMarker);
  
  if (markerStart === -1) {
    return aiResponse;
  }
  
  const markerEnd = aiResponse.indexOf(']]', markerStart);
  if (markerEnd === -1) {
    return aiResponse;
  }
  
  // Remove the marker and any surrounding whitespace
  return (aiResponse.substring(0, markerStart) + aiResponse.substring(markerEnd + 2)).trim();
}

// Create calendar event and log it
// deno-lint-ignore no-explicit-any
async function createCalendarEventAndLog(
  provider: string,
  accessToken: string,
  meeting: ParsedMeeting,
  supabaseAdmin: any,
  userId: string,
  organizationId: string,
  connectionId: string,
  categoryId: string,
  categoryName: string,
  eventColor: string
): Promise<boolean> {
  try {
    let eventResult: { eventId: string; htmlLink?: string; webLink?: string } | null = null;
    
    if (provider === 'google') {
      eventResult = await createGoogleCalendarEvent(accessToken, meeting, eventColor);
    } else if (provider === 'microsoft') {
      eventResult = await createMicrosoftCalendarEvent(accessToken, meeting, eventColor);
    }
    
    if (!eventResult) {
      console.error('Failed to create calendar event');
      return false;
    }
    
    console.log(`Created ${provider} calendar event: ${eventResult.eventId}`);
    
    // Log the calendar event
    await supabaseAdmin.from('ai_activity_logs').insert({
      organization_id: organizationId,
      user_id: userId,
      connection_id: connectionId,
      category_id: categoryId,
      category_name: categoryName,
      activity_type: 'scheduled_event',
      email_subject: meeting.title,
      email_from: meeting.attendees.join(', ')
    });
    
    console.log(`Logged calendar event: ${meeting.title}`);
    return true;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return false;
  }
}

// Interface for availability hours
interface AvailabilityHour {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

// Find next available slot based on user's availability
// deno-lint-ignore no-explicit-any
async function findNextAvailableSlot(
  supabaseAdmin: any,
  connectionId: string,
  durationMinutes: number = 30
): Promise<{ start: Date; end: Date } | null> {
  // Get availability hours for this connection
  const { data } = await supabaseAdmin
    .from('availability_hours')
    .select('day_of_week, start_time, end_time, is_available')
    .eq('connection_id', connectionId)
    .eq('is_available', true)
    .order('day_of_week');
  
  const availabilityHours = data as AvailabilityHour[] | null;
  
  if (!availabilityHours?.length) {
    // Default to weekdays 9am-5pm if no availability set
    const now = new Date();
    const startOfDay = new Date(now);
    
    // Find next weekday
    while (startOfDay.getDay() === 0 || startOfDay.getDay() === 6) {
      startOfDay.setDate(startOfDay.getDate() + 1);
    }
    
    startOfDay.setHours(9, 0, 0, 0);
    
    // If today is a weekday but past 5pm, go to next weekday
    if (now.getDay() !== 0 && now.getDay() !== 6 && now.getHours() >= 17) {
      startOfDay.setDate(startOfDay.getDate() + 1);
      while (startOfDay.getDay() === 0 || startOfDay.getDay() === 6) {
        startOfDay.setDate(startOfDay.getDate() + 1);
      }
    }
    
    // If today is a weekday and within hours, use current time rounded up
    if (now.getDay() !== 0 && now.getDay() !== 6 && now.getHours() >= 9 && now.getHours() < 17) {
      const minutes = now.getMinutes();
      const roundedMinutes = Math.ceil(minutes / 15) * 15;
      startOfDay.setTime(now.getTime());
      startOfDay.setMinutes(roundedMinutes, 0, 0);
    }
    
    const end = new Date(startOfDay.getTime() + durationMinutes * 60000);
    return { start: startOfDay, end };
  }
  
  // Find next available slot based on user's availability
  const now = new Date();
  const checkDate = new Date(now);
  
  // Look up to 7 days ahead
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayOfWeek = checkDate.getDay();
    const availability = availabilityHours.find(a => a.day_of_week === dayOfWeek);
    
    if (availability) {
      const [startHour, startMin] = availability.start_time.split(':').map(Number);
      const [endHour, endMin] = availability.end_time.split(':').map(Number);
      
      const slotStart = new Date(checkDate);
      slotStart.setHours(startHour, startMin, 0, 0);
      
      const dayEnd = new Date(checkDate);
      dayEnd.setHours(endHour, endMin, 0, 0);
      
      // If this is today, adjust start time
      if (dayOffset === 0 && now > slotStart) {
        const minutes = now.getMinutes();
        const roundedMinutes = Math.ceil(minutes / 15) * 15;
        slotStart.setTime(now.getTime());
        slotStart.setMinutes(roundedMinutes, 0, 0);
      }
      
      // Check if there's enough time for the meeting
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
      if (slotEnd <= dayEnd) {
        return { start: slotStart, end: slotEnd };
      }
    }
    
    checkDate.setDate(checkDate.getDate() + 1);
  }
  
  return null;
}

// Mark email as read in Gmail
async function markGmailAsRead(accessToken: string, messageId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          removeLabelIds: ['UNREAD']
        })
      }
    );
    if (!res.ok) {
      console.error('Failed to mark Gmail as read:', await res.text());
      return false;
    }
    console.log(`Marked Gmail message ${messageId} as read`);
    return true;
  } catch (error) {
    console.error('Error marking Gmail as read:', error);
    return false;
  }
}

// Mark email as read in Outlook
async function markOutlookAsRead(accessToken: string, messageId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          isRead: true
        })
      }
    );
    if (!res.ok) {
      console.error('Failed to mark Outlook as read:', await res.text());
      return false;
    }
    console.log(`Marked Outlook message ${messageId} as read`);
    return true;
  } catch (error) {
    console.error('Error marking Outlook as read:', error);
    return false;
  }
}

// Gmail color mapping (hex to Gmail color name)
function hexToGmailColor(hex: string): { textColor: string; backgroundColor: string } {
  // Gmail only supports specific color combinations
  // Map common colors to closest Gmail color
  const lowerHex = hex.toLowerCase();
  
  // Blue shades
  if (lowerHex.includes('3b82f6') || lowerHex.includes('2563eb') || lowerHex.includes('1d4ed8')) {
    return { textColor: '#04502e', backgroundColor: '#a4c2f4' }; // Light blue
  }
  // Orange shades
  if (lowerHex.includes('f97316') || lowerHex.includes('ea580c') || lowerHex.includes('fb923c')) {
    return { textColor: '#7a2e0b', backgroundColor: '#ffbc6b' }; // Orange
  }
  // Green shades
  if (lowerHex.includes('22c55e') || lowerHex.includes('16a34a')) {
    return { textColor: '#0b4f30', backgroundColor: '#b3efd3' }; // Light green
  }
  // Red shades
  if (lowerHex.includes('ef4444') || lowerHex.includes('dc2626')) {
    return { textColor: '#8a1c0a', backgroundColor: '#f4cccc' }; // Light red
  }
  // Purple shades
  if (lowerHex.includes('8b5cf6') || lowerHex.includes('7c3aed')) {
    return { textColor: '#41236d', backgroundColor: '#d9d2e9' }; // Light purple
  }
  // Default to blue
  return { textColor: '#094228', backgroundColor: '#c9daf8' };
}

// Get or create Gmail AI label
async function getOrCreateGmailLabel(
  accessToken: string, 
  labelName: string, 
  color: string
): Promise<string | null> {
  try {
    // First, try to find existing label
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!listRes.ok) {
      console.error('Failed to list Gmail labels:', await listRes.text());
      return null;
    }
    
    const labels = await listRes.json();
    const existingLabel = labels.labels?.find(
      (l: { name: string }) => l.name === labelName
    );
    
    if (existingLabel) {
      return existingLabel.id;
    }
    
    // Create new label with color
    const gmailColor = hexToGmailColor(color);
    const createRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
          color: gmailColor
        })
      }
    );
    
    if (!createRes.ok) {
      console.error('Failed to create Gmail label:', await createRes.text());
      return null;
    }
    
    const newLabel = await createRes.json();
    console.log(`Created Gmail label: ${labelName} with id ${newLabel.id}`);
    return newLabel.id;
  } catch (error) {
    console.error('Error with Gmail label:', error);
    return null;
  }
}

// Apply Gmail label to message
async function applyGmailLabel(
  accessToken: string, 
  messageId: string, 
  labelId: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          addLabelIds: [labelId]
        })
      }
    );
    
    if (!res.ok) {
      console.error('Failed to apply Gmail label:', await res.text());
      return false;
    }
    
    console.log(`Applied Gmail label ${labelId} to message ${messageId}`);
    return true;
  } catch (error) {
    console.error('Error applying Gmail label:', error);
    return false;
  }
}

// Remove Gmail label from message
async function removeGmailLabel(
  accessToken: string, 
  messageId: string, 
  labelId: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          removeLabelIds: [labelId]
        })
      }
    );
    
    if (!res.ok) {
      console.error('Failed to remove Gmail label:', await res.text());
      return false;
    }
    
    console.log(`Removed Gmail label ${labelId} from message ${messageId}`);
    return true;
  } catch (error) {
    console.error('Error removing Gmail label:', error);
    return false;
  }
}

// Delete Gmail draft
async function deleteGmailDraft(accessToken: string, draftId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    
    if (!res.ok) {
      console.error('Failed to delete Gmail draft:', await res.text());
      return false;
    }
    
    console.log(`Deleted Gmail draft ${draftId}`);
    return true;
  } catch (error) {
    console.error('Error deleting Gmail draft:', error);
    return false;
  }
}

// Delete Outlook draft
async function deleteOutlookDraft(accessToken: string, draftId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draftId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    
    if (!res.ok) {
      console.error('Failed to delete Outlook draft:', await res.text());
      return false;
    }
    
    console.log(`Deleted Outlook draft ${draftId}`);
    return true;
  } catch (error) {
    console.error('Error deleting Outlook draft:', error);
    return false;
  }
}

// Get or create Outlook category (folder) for AI labels
async function getOrCreateOutlookCategory(
  accessToken: string, 
  categoryName: string, 
  color: string
): Promise<string | null> {
  try {
    // Map hex color to Outlook preset colors
    const outlookColor = hexToOutlookColor(color);
    
    // First, check existing categories
    const listRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!listRes.ok) {
      console.error('Failed to list Outlook categories:', await listRes.text());
      return null;
    }
    
    const categories = await listRes.json();
    const existing = categories.value?.find(
      (c: { displayName: string }) => c.displayName === categoryName
    );
    
    if (existing) {
      return categoryName;
    }
    
    // Create new category
    const createRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          displayName: categoryName,
          color: outlookColor
        })
      }
    );
    
    if (!createRes.ok) {
      // Category might already exist, try to use it anyway
      console.log('Category may already exist, continuing...');
      return categoryName;
    }
    
    console.log(`Created Outlook category: ${categoryName}`);
    return categoryName;
  } catch (error) {
    console.error('Error with Outlook category:', error);
    return null;
  }
}

// Map hex to Outlook preset color
function hexToOutlookColor(hex: string): string {
  const lowerHex = hex.toLowerCase();
  
  // Blue shades
  if (lowerHex.includes('3b82f6') || lowerHex.includes('2563eb')) return 'preset7'; // Blue
  // Orange shades
  if (lowerHex.includes('f97316') || lowerHex.includes('ea580c')) return 'preset1'; // Orange
  // Green shades
  if (lowerHex.includes('22c55e') || lowerHex.includes('16a34a')) return 'preset4'; // Green
  // Red shades
  if (lowerHex.includes('ef4444') || lowerHex.includes('dc2626')) return 'preset0'; // Red
  // Purple shades
  if (lowerHex.includes('8b5cf6') || lowerHex.includes('7c3aed')) return 'preset8'; // Purple
  
  return 'preset7'; // Default to blue
}

// Apply Outlook category to message
async function applyOutlookCategory(
  accessToken: string, 
  messageId: string, 
  categoryName: string
): Promise<boolean> {
  try {
    // First get current categories
    const getRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=categories`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    let currentCategories: string[] = [];
    if (getRes.ok) {
      const data = await getRes.json();
      currentCategories = data.categories || [];
    }
    
    // Add new category if not already present
    if (!currentCategories.includes(categoryName)) {
      currentCategories.push(categoryName);
    }
    
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          categories: currentCategories
        })
      }
    );
    
    if (!res.ok) {
      console.error('Failed to apply Outlook category:', await res.text());
      return false;
    }
    
    console.log(`Applied Outlook category ${categoryName} to message ${messageId}`);
    return true;
  } catch (error) {
    console.error('Error applying Outlook category:', error);
    return false;
  }
}

// Remove Outlook category from message
async function removeOutlookCategory(
  accessToken: string, 
  messageId: string, 
  categoryName: string
): Promise<boolean> {
  try {
    // First get current categories
    const getRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=categories`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    let currentCategories: string[] = [];
    if (getRes.ok) {
      const data = await getRes.json();
      currentCategories = data.categories || [];
    }
    
    // Remove the category
    currentCategories = currentCategories.filter(c => c !== categoryName);
    
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          categories: currentCategories
        })
      }
    );
    
    if (!res.ok) {
      console.error('Failed to remove Outlook category:', await res.text());
      return false;
    }
    
    console.log(`Removed Outlook category ${categoryName} from message ${messageId}`);
    return true;
  } catch (error) {
    console.error('Error removing Outlook category:', error);
    return false;
  }
}

// Generate AI draft for an email (body only, signature added separately)
async function generateAIDraft(
  emailSubject: string,
  emailBody: string,
  emailFrom: string,
  categoryName: string,
  writingStyle: string,
  formatStyle: string = 'concise',
  senderName: string | null = null,
  _senderTitle: string | null = null, // Unused - signature handled separately
  nextAvailableSlot: { start: Date; end: Date } | null = null // For meeting scheduling
): Promise<string | null> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not configured');
    return null;
  }

  const cleanCategory = categoryName.replace(/^\d+:\s*/, '').trim();
  const stylePrompt = WRITING_STYLE_PROMPTS[writingStyle] || WRITING_STYLE_PROMPTS.professional;
  const formatPrompt = FORMAT_STYLE_PROMPTS[formatStyle] || FORMAT_STYLE_PROMPTS.concise;
  const categoryContext = CATEGORY_CONTEXT[cleanCategory] || '';

  // Build meeting scheduling context if available
  let meetingContext = '';
  if (nextAvailableSlot && cleanCategory === 'Meetings') {
    const startIso = nextAvailableSlot.start.toISOString();
    const endIso = nextAvailableSlot.end.toISOString();
    const formattedDate = nextAvailableSlot.start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const formattedTime = nextAvailableSlot.start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    const durationMins = Math.round((nextAvailableSlot.end.getTime() - nextAvailableSlot.start.getTime()) / 60000);
    
    meetingContext = `
MEETING SCHEDULING INSTRUCTIONS:
If the sender is requesting a meeting, call, appointment, or any scheduled event:
1. Propose the meeting for: ${formattedDate} at ${formattedTime} (${durationMins} minutes)
2. Include this EXACT marker at the END of your response (after all email content):
   [[MEETING:{"title":"Meeting with [sender name]","start":"${startIso}","end":"${endIso}","description":"Meeting regarding [topic]"}]]
3. Replace [sender name] and [topic] with appropriate values from the email
4. The marker will be removed before sending and used to create a calendar event with invite`;
  }

  // AI should generate body text only - NO signature (we add HTML signature separately)
  const systemPrompt = `You are an expert email assistant. Generate a reply to the email below.

${stylePrompt}

${formatPrompt}

CATEGORY: ${cleanCategory}
${categoryContext}
${meetingContext}

CRITICAL RULES (MUST FOLLOW):
1. STRICTLY FOLLOW the writing style requirements above - this is the most important rule
2. STRICTLY FOLLOW the response format requirements above
3. Generate a complete, ready-to-send email reply BODY ONLY
4. Do NOT include the subject line
5. Start with an appropriate greeting matching the style (e.g., "Dear ${senderName ? 'Ali' : 'recipient'},")
6. DO NOT include any closing phrases like "Thank you", "Thanks", "Best regards", "Sincerely", "Kind regards", "Warm regards", or similar sign-offs - the signature will be added automatically and already contains these
7. End your response with the last sentence of your actual email content, NOT a closing phrase or sign-off
8. Address the sender's main points
9. Output ONLY the email text - no explanations or notes
${meetingContext ? '10. If scheduling a meeting, ALWAYS include the [[MEETING:...]] marker at the very end' : ''}`;

  const userPrompt = `Reply to this email:

FROM: ${emailFrom}
SUBJECT: ${emailSubject}

BODY:
${emailBody.substring(0, 3000)}`;

  console.log(`Generating AI draft with style: ${writingStyle}, format: ${formatStyle}, sender: ${senderName || 'not specified'}${meetingContext ? ', with meeting slot' : ''}`);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('AI generation error:', error);
    return null;
  }
}

// Get Gmail email details
async function getGmailEmailDetails(accessToken: string, messageId: string): Promise<{
  subject: string;
  from: string;
  body: string;
  threadId: string;
  replyTo: string;
} | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) return null;
    
    const message = await res.json();
    const headers = message.payload?.headers || [];
    
    const getHeader = (name: string) => 
      headers.find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    
    // Extract body from parts
    let body = '';
    const extractBody = (part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
      if (part.parts) {
        for (const subpart of part.parts) {
          const text = extractBody(subpart as { mimeType?: string; body?: { data?: string }; parts?: unknown[] });
          if (text) return text;
        }
      }
      return '';
    };
    
    body = extractBody(message.payload || {});
    if (!body && message.payload?.body?.data) {
      body = atob(message.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    
    return {
      subject: getHeader('Subject'),
      from: getHeader('From'),
      body,
      threadId: message.threadId,
      replyTo: getHeader('Reply-To') || getHeader('From'),
    };
  } catch (error) {
    console.error('Error getting Gmail email:', error);
    return null;
  }
}

// Create Gmail draft with HTML content and return both draft ID and message ID
async function createGmailDraft(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
  threadId: string
): Promise<{ draftId: string; messageId: string } | null> {
  try {
    // Build RFC 2822 message with HTML content
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const message = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody
    ].join('\r\n');
    
    const encodedMessage = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          raw: encodedMessage,
          threadId: threadId
        }
      })
    });
    
    if (!res.ok) {
      console.error('Failed to create Gmail draft:', await res.text());
      return null;
    }
    
    const draft = await res.json();
    console.log(`Created Gmail draft: ${draft.id}, message: ${draft.message?.id}`);
    return { draftId: draft.id, messageId: draft.message?.id || null };
  } catch (error) {
    console.error('Error creating Gmail draft:', error);
    return null;
  }
}

// Send Gmail message with HTML content (for auto-reply) and return the sent message ID
async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
  threadId: string
): Promise<{ success: boolean; messageId: string | null }> {
  try {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const message = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody
    ].join('\r\n');
    
    const encodedMessage = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: encodedMessage,
        threadId: threadId
      })
    });
    
    if (!res.ok) {
      console.error('Failed to send Gmail message:', await res.text());
      return { success: false, messageId: null };
    }
    
    const sentMessage = await res.json();
    console.log(`Sent Gmail auto-reply, message ID: ${sentMessage.id}`);
    return { success: true, messageId: sentMessage.id || null };
  } catch (error) {
    console.error('Error sending Gmail message:', error);
    return { success: false, messageId: null };
  }
}

// Get Outlook email details
async function getOutlookEmailDetails(accessToken: string, messageId: string): Promise<{
  subject: string;
  from: string;
  body: string;
  conversationId: string;
  replyTo: string;
} | null> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=subject,from,body,conversationId,replyTo`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!res.ok) return null;
    
    const message = await res.json();
    
    return {
      subject: message.subject || '',
      from: message.from?.emailAddress?.address || '',
      body: message.body?.content || '',
      conversationId: message.conversationId || '',
      replyTo: message.replyTo?.[0]?.emailAddress?.address || message.from?.emailAddress?.address || '',
    };
  } catch (error) {
    console.error('Error getting Outlook email:', error);
    return null;
  }
}

// Create Outlook draft with HTML content
async function createOutlookDraft(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
  conversationId: string
): Promise<string | null> {
  try {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    
    const res = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject: replySubject,
        body: {
          contentType: 'HTML',
          content: htmlBody
        },
        toRecipients: [
          {
            emailAddress: { address: to }
          }
        ],
        conversationId: conversationId,
        isDraft: true
      })
    });
    
    if (!res.ok) {
      console.error('Failed to create Outlook draft:', await res.text());
      return null;
    }
    
    const draft = await res.json();
    console.log(`Created Outlook draft: ${draft.id}`);
    return draft.id;
  } catch (error) {
    console.error('Error creating Outlook draft:', error);
    return null;
  }
}

// Send Outlook message (for auto-reply)
async function sendOutlookReply(
  accessToken: string,
  messageId: string,
  body: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          comment: body
        })
      }
    );
    
    if (!res.ok) {
      console.error('Failed to send Outlook reply:', await res.text());
      return false;
    }
    
    console.log('Sent Outlook auto-reply');
    return true;
  } catch (error) {
    console.error('Error sending Outlook reply:', error);
    return false;
  }
}

// Build Gmail search query from rule
// deno-lint-ignore no-explicit-any
function buildGmailSearchQuery(rule: any): string {
  const queryParts: string[] = [];
  
  if (rule.rule_type === 'sender') {
    queryParts.push(`from:${rule.rule_value}`);
  } else if (rule.rule_type === 'domain') {
    queryParts.push(`from:@${rule.rule_value}`);
  } else if (rule.rule_type === 'keyword') {
    queryParts.push(rule.rule_value);
  }

  if (rule.recipient_filter) {
    if (rule.recipient_filter === 'to_me') queryParts.push('to:me');
    else if (rule.recipient_filter === 'cc_me') queryParts.push('cc:me');
    else if (rule.recipient_filter === 'to_or_cc_me') queryParts.push('(to:me OR cc:me)');
  }

  if (rule.is_advanced) {
    const advancedParts: string[] = [];
    if (rule.subject_contains) {
      advancedParts.push(rule.subject_contains.includes(' ') 
        ? `subject:"${rule.subject_contains}"` 
        : `subject:${rule.subject_contains}`);
    }
    if (rule.body_contains) {
      advancedParts.push(rule.body_contains.includes(' ') 
        ? `"${rule.body_contains}"` 
        : rule.body_contains);
    }
    if (advancedParts.length > 0) {
      const connector = rule.condition_logic === 'or' ? ' OR ' : ' ';
      queryParts.push(`(${advancedParts.join(connector)})`);
    }
  }

  return queryParts.join(' ');
}

// Build Outlook search filter
// deno-lint-ignore no-explicit-any
function buildOutlookFilter(rule: any): string {
  const filters: string[] = [];
  
  if (rule.rule_type === 'sender') {
    filters.push(`contains(from/emailAddress/address, '${rule.rule_value}')`);
  } else if (rule.rule_type === 'domain') {
    filters.push(`contains(from/emailAddress/address, '@${rule.rule_value}')`);
  } else if (rule.rule_type === 'keyword') {
    filters.push(`(contains(subject, '${rule.rule_value}') or contains(body/content, '${rule.rule_value}'))`);
  }
  
  if (rule.is_advanced) {
    const advancedFilters: string[] = [];
    if (rule.subject_contains) {
      advancedFilters.push(`contains(subject, '${rule.subject_contains}')`);
    }
    if (rule.body_contains) {
      advancedFilters.push(`contains(body/content, '${rule.body_contains}')`);
    }
    if (advancedFilters.length > 0) {
      const connector = rule.condition_logic === 'or' ? ' or ' : ' and ';
      filters.push(`(${advancedFilters.join(connector)})`);
    }
  }
  
  return filters.join(' and ');
}

// Email profile with signature fields (per-connection profile)
interface EmailProfile {
  connection_id: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  email_signature: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  signature_logo_url: string | null;
  signature_font: string | null;
  signature_color: string | null;
}

// Generate HTML email signature from profile fields
function generateEmailSignature(profile: EmailProfile): string {
  // If user has a custom email signature, use it
  if (profile.email_signature) {
    return `\n\n${profile.email_signature}`;
  }

  // Generate signature from profile fields
  const fontFamily = profile.signature_font || 'Arial, sans-serif';
  const textColor = profile.signature_color || '#333333';
  const name = profile.full_name;
  const userTitle = profile.title;
  const phone = profile.phone;
  const mobile = profile.mobile;
  const website = profile.website;
  const email = profile.email;
  const logoUrl = profile.signature_logo_url;

  // Build contact lines
  const contactLines: string[] = [];
  if (phone) {
    contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">📞</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;">Main: ${phone}</td></tr>`);
  }
  if (mobile) {
    contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">📱</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;">Mobile: ${mobile}</td></tr>`);
  }
  if (website) {
    const cleanUrl = website.replace(/^https?:\/\//, '');
    contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">🌐</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;"><a href="${website}" style="color: ${textColor}; text-decoration: none;">${cleanUrl}</a></td></tr>`);
  }
  if (email) {
    contactLines.push(`<tr><td style="padding: 2px 0; vertical-align: middle;"><span style="font-size: 14px;">✉️</span></td><td style="padding: 2px 0 2px 8px; vertical-align: middle;"><a href="mailto:${email}" style="color: ${textColor}; text-decoration: none;">${email}</a></td></tr>`);
  }

  // Only generate signature if there's content
  if (!name && !userTitle && contactLines.length === 0 && !logoUrl) {
    return '';
  }

  return `

<div style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
  <p style="margin: 0 0 12px 0;">Best regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="font-family: ${fontFamily}; font-size: 14px; color: ${textColor};">
    <tr>
      ${logoUrl ? `<td style="vertical-align: top; padding-right: 16px; border-right: 2px solid #e5e5e5;">
        <img src="${logoUrl}" alt="Logo" style="max-height: 80px; max-width: 120px;" />
      </td>` : ''}
      <td style="vertical-align: top; ${logoUrl ? 'padding-left: 16px;' : ''}">
        ${name ? `<div style="font-size: 16px; font-weight: bold; color: ${textColor}; margin-bottom: 2px;">${name}</div>` : ''}
        ${userTitle ? `<div style="font-size: 14px; color: #2563eb; margin-bottom: 8px;">${userTitle}</div>` : ''}
        ${contactLines.length > 0 ? `<table cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; color: ${textColor};">
          ${contactLines.join('')}
        </table>` : ''}
      </td>
    </tr>
  </table>
</div>`;
}

// Process emails for a single connection
async function processConnectionEmails(
  userId: string,
  organizationId: string,
  connectionId: string,
  profile: EmailProfile,
  categoryId: string | null = null
): Promise<{ draftsCreated: number; autoRepliesSent: number; errors: number }> {
  const results = { draftsCreated: 0, autoRepliesSent: 0, errors: 0 };
  
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;

  // Get categories with AI draft or auto-reply enabled for this connection
  let categoriesQuery = supabaseAdmin
    .from('categories')
    .select('id, name, writing_style, ai_draft_enabled, auto_reply_enabled, sort_order')
    .eq('organization_id', organizationId)
    .eq('connection_id', connectionId)
    .eq('is_enabled', true)
    .or('ai_draft_enabled.eq.true,auto_reply_enabled.eq.true');

  if (categoryId) {
    categoriesQuery = categoriesQuery.eq('id', categoryId);
  }

  const { data: aiCategories, error: catError } = await categoriesQuery;

  if (catError || !aiCategories?.length) {
    console.log(`No AI-enabled categories for user ${userId}`);
    return results;
  }

  console.log(`Found ${aiCategories.length} AI-enabled categories for user ${userId}`);

  // Get rules for AI-enabled categories (filtered by connection)
  const categoryIds = aiCategories.map(c => c.id);
  const { data: rules } = await supabaseAdmin
    .from('rules')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('connection_id', connectionId)
    .eq('is_enabled', true)
    .in('category_id', categoryIds);

  if (!rules?.length) {
    console.log(`No rules found for AI categories for user ${userId}`);
    return results;
  }

  // Get AI settings for label colors (for this connection)
  const { data: aiSettingsData } = await supabaseAdmin
    .from('ai_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('connection_id', connectionId)
    .maybeSingle();
  
  const aiDraftLabelColor = (aiSettingsData as Record<string, unknown>)?.ai_draft_label_color as string || '#3B82F6';
  const aiSentLabelColor = (aiSettingsData as Record<string, unknown>)?.ai_sent_label_color as string || '#F97316';
  const aiCalendarEventColor = (aiSettingsData as Record<string, unknown>)?.ai_calendar_event_color as string || '#9333EA';

  // Get the provider for this connection
  const { data: connectionData } = await supabaseAdmin
    .from('provider_connections')
    .select('provider')
    .eq('id', connectionId)
    .single();

  if (!connectionData?.provider) {
    console.log(`Connection ${connectionId} not found`);
    return results;
  }

  // Get tokens for this specific provider
  const { data: tokenDataList } = await supabaseAdmin
    .from('oauth_token_vault')
    .select('provider, encrypted_access_token, encrypted_refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', connectionData.provider);

  if (!tokenDataList?.length) {
    console.log(`No tokens for provider ${connectionData.provider} for user ${userId}`);
    return results;
  }

  // Get already processed emails to skip
  const { data: processedEmails } = await supabaseAdmin
    .from('processed_emails')
    .select('email_id, action_type, category_id')
    .eq('user_id', userId);

  const processedSet = new Set(
    (processedEmails || []).map(p => `${p.email_id}:${p.category_id}:${p.action_type}`)
  );

  // Map category ID to category info
  const categoryMap = new Map(aiCategories.map(c => [c.id, c]));
  
  // Cache for label IDs
  const gmailLabelCache: Record<string, string> = {};
  const outlookCategoryCache: Record<string, boolean> = {};

  // Process each provider
  for (const tokenRecord of tokenDataList) {
    const accessToken = await getValidAccessToken(
      tokenRecord as TokenData,
      encryptionKey,
      userId
    );
    
    if (!accessToken) {
      console.error(`Could not get token for ${tokenRecord.provider} for user ${userId}`);
      continue;
    }

    // Process each rule
    for (const rule of rules) {
      const category = categoryMap.get(rule.category_id);
      if (!category) continue;

      console.log(`Processing rule for category: ${category.name}, rule: ${JSON.stringify({ type: rule.rule_type, value: rule.rule_value, subject: rule.subject_contains })}`);

      let matchingMessages: { id: string }[] = [];
      
      // Get the category label name (format: "N: CategoryName")
      const categoryLabelName = `${(category.sort_order || 0) + 1}: ${category.name}`;

      if (tokenRecord.provider === 'google') {
        // First, search for unread emails with the category label
        const labelQuery = `label:"${categoryLabelName}" is:unread`;
        console.log(`Gmail label search query: ${labelQuery}`);
        const labelSearchRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(labelQuery)}&maxResults=50`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (labelSearchRes.ok) {
          const data = await labelSearchRes.json();
          if (data.messages?.length) {
            matchingMessages = data.messages;
            console.log(`Found ${matchingMessages.length} unread emails with category label`);
          }
        }
        
        // Also search by rule criteria for newly arrived emails
        if (matchingMessages.length === 0) {
          const query = buildGmailSearchQuery(rule) + ' is:unread newer_than:1d';
          console.log(`Gmail rule search query: ${query}`);
          const searchRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            matchingMessages = data.messages || [];
            console.log(`Gmail rule search found ${matchingMessages.length} emails`);
          } else {
            console.error(`Gmail search failed: ${await searchRes.text()}`);
          }
        }
      } else if (tokenRecord.provider === 'microsoft') {
        // Search for unread emails with the category
        const categoryFilter = `categories/any(c:c eq '${categoryLabelName}') and isRead eq false`;
        console.log(`Outlook category filter: ${categoryFilter}`);
        const categorySearchRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(categoryFilter)}&$top=50&$select=id`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (categorySearchRes.ok) {
          const data = await categorySearchRes.json();
          if (data.value?.length) {
            matchingMessages = data.value;
            console.log(`Found ${matchingMessages.length} unread emails with category`);
          }
        }
        
        // Also search by rule criteria
        if (matchingMessages.length === 0) {
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const filter = `${buildOutlookFilter(rule)} and receivedDateTime ge ${yesterday} and isRead eq false`;
          console.log(`Outlook rule filter: ${filter}`);
          const searchRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=50&$select=id`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (searchRes.ok) {
            const data = await searchRes.json();
            matchingMessages = data.value || [];
          }
        }
      }

      console.log(`Found ${matchingMessages.length} matching unread emails for rule`);

      // Process each matching email
      for (const msg of matchingMessages) {
        const needsDraft = category.ai_draft_enabled && 
          !processedSet.has(`${msg.id}:${category.id}:draft`);
        const needsAutoReply = category.auto_reply_enabled && 
          !processedSet.has(`${msg.id}:${category.id}:auto_reply`);

        if (!needsDraft && !needsAutoReply) {
          continue;
        }

        console.log(`Processing email ${msg.id} for ${category.name}`);

        let emailDetails;
        if (tokenRecord.provider === 'google') {
          emailDetails = await getGmailEmailDetails(accessToken, msg.id);
        } else {
          emailDetails = await getOutlookEmailDetails(accessToken, msg.id);
        }

        if (!emailDetails) {
          results.errors++;
          continue;
        }

        // Get next available slot for Meetings category
        const cleanCategoryName = category.name.replace(/^\d+:\s*/, '').trim();
        let nextAvailableSlot: { start: Date; end: Date } | null = null;
        if (cleanCategoryName === 'Meetings') {
          nextAvailableSlot = await findNextAvailableSlot(supabaseAdmin, connectionId, 30);
          if (nextAvailableSlot) {
            console.log(`Found next available slot: ${nextAvailableSlot.start.toISOString()}`);
          }
        }

        // Generate AI draft content (without signature - AI will just create the body)
        const aiDraftBody = await generateAIDraft(
          emailDetails.subject,
          emailDetails.body,
          emailDetails.from,
          category.name,
          category.writing_style,
          'concise',
          profile.full_name || null,
          null, // Don't pass title to AI - we'll add signature separately
          nextAvailableSlot // Pass available slot for meeting scheduling
        );

        if (!aiDraftBody) {
          console.error('Failed to generate AI draft');
          results.errors++;
          continue;
        }

        // Parse any meeting from AI response
        const parsedMeeting = parseMeetingFromAIResponse(
          aiDraftBody,
          emailDetails.from,
          emailDetails.subject
        );

        // Remove meeting marker from the response for clean email body
        const cleanAIDraftBody = removeMeetingMarkerFromResponse(aiDraftBody);

        // Generate the email signature from profile
        const emailSignature = generateEmailSignature(profile);
        
        // Combine draft body with signature for final content
        // Convert plain text body to HTML and append HTML signature
        const htmlBody = cleanAIDraftBody.replace(/\n/g, '<br>');
        const draftContent = `<div>${htmlBody}</div>${emailSignature}`;
        
        console.log(`Generated draft with signature for email ${msg.id}${parsedMeeting ? ' (includes meeting)' : ''}`);

        // Mark email as read since AI is handling it
        if (tokenRecord.provider === 'google') {
          await markGmailAsRead(accessToken, msg.id);
        } else {
          await markOutlookAsRead(accessToken, msg.id);
        }

        // Handle AI Draft
        if (needsDraft) {
          let draftId: string | null = null;
          let draftMessageId: string | null = null;

          if (tokenRecord.provider === 'google') {
            const gmailDraftResult = await createGmailDraft(
              accessToken,
              emailDetails.replyTo,
              emailDetails.subject,
              draftContent,
              (emailDetails as { threadId: string }).threadId
            );
            if (gmailDraftResult) {
              draftId = gmailDraftResult.draftId;
              draftMessageId = gmailDraftResult.messageId;
            }
          } else {
            draftId = await createOutlookDraft(
              accessToken,
              emailDetails.replyTo,
              emailDetails.subject,
              draftContent,
              (emailDetails as { conversationId: string }).conversationId
            );
          }

          if (draftId) {
            await supabaseAdmin.from('processed_emails').insert({
              organization_id: organizationId,
              user_id: userId,
              email_id: msg.id,
              category_id: category.id,
              provider: tokenRecord.provider,
              action_type: 'draft',
              draft_id: draftId
            });

            await supabaseAdmin.from('ai_activity_logs').insert({
              organization_id: organizationId,
              user_id: userId,
              connection_id: connectionId,
              category_id: category.id,
              category_name: category.name,
              activity_type: 'draft',
              email_subject: emailDetails.subject,
              email_from: emailDetails.from
            });

            results.draftsCreated++;
            console.log(`Created draft for email ${msg.id}`);
            
            // Build category label name (e.g., "10: FYI")
            const categoryLabelName = `${String(category.sort_order + 1).padStart(2, '0')}: ${category.name}`;
            
            // Apply AI Draft label to original email (numbered as 00:)
            const aiDraftLabelName = '00: AI Draft';
            if (tokenRecord.provider === 'google') {
              // Get/create the category label
              if (!gmailLabelCache[categoryLabelName]) {
                // Fetch category color from database
                const { data: catData } = await supabaseAdmin
                  .from('categories')
                  .select('color')
                  .eq('id', category.id)
                  .single();
                const catColor = catData?.color || '#3B82F6';
                const labelId = await getOrCreateGmailLabel(accessToken, categoryLabelName, catColor);
                if (labelId) gmailLabelCache[categoryLabelName] = labelId;
              }
              
              // Get/create AI Draft label
              if (!gmailLabelCache[aiDraftLabelName]) {
                const labelId = await getOrCreateGmailLabel(accessToken, aiDraftLabelName, aiDraftLabelColor);
                if (labelId) gmailLabelCache[aiDraftLabelName] = labelId;
              }
              
              // Apply category label to original email
              if (gmailLabelCache[categoryLabelName]) {
                await applyGmailLabel(accessToken, msg.id, gmailLabelCache[categoryLabelName]);
                console.log(`Applied ${categoryLabelName} label to original email ${msg.id}`);
              }
              
              // Apply AI Draft label to original email
              if (gmailLabelCache[aiDraftLabelName]) {
                await applyGmailLabel(accessToken, msg.id, gmailLabelCache[aiDraftLabelName]);
                // Also apply both labels to the draft message
                if (draftMessageId) {
                  if (gmailLabelCache[categoryLabelName]) {
                    await applyGmailLabel(accessToken, draftMessageId, gmailLabelCache[categoryLabelName]);
                  }
                  await applyGmailLabel(accessToken, draftMessageId, gmailLabelCache[aiDraftLabelName]);
                  console.log(`Applied ${categoryLabelName} and ${aiDraftLabelName} labels to draft message ${draftMessageId}`);
                }
              }
            } else {
              // Outlook: Create/get category labels
              if (!outlookCategoryCache[categoryLabelName]) {
                const { data: catData } = await supabaseAdmin
                  .from('categories')
                  .select('color')
                  .eq('id', category.id)
                  .single();
                const catColor = catData?.color || '#3B82F6';
                await getOrCreateOutlookCategory(accessToken, categoryLabelName, catColor);
                outlookCategoryCache[categoryLabelName] = true;
              }
              if (!outlookCategoryCache[aiDraftLabelName]) {
                await getOrCreateOutlookCategory(accessToken, aiDraftLabelName, aiDraftLabelColor);
                outlookCategoryCache[aiDraftLabelName] = true;
              }
              
              // Apply category label to original email
              await applyOutlookCategory(accessToken, msg.id, categoryLabelName);
              console.log(`Applied ${categoryLabelName} category to original email ${msg.id}`);
              
              // Apply AI Draft label to original email
              await applyOutlookCategory(accessToken, msg.id, aiDraftLabelName);
              
              // Also apply both labels to the draft message
              if (draftId) {
                await applyOutlookCategory(accessToken, draftId, categoryLabelName);
                await applyOutlookCategory(accessToken, draftId, aiDraftLabelName);
                console.log(`Applied ${categoryLabelName} and ${aiDraftLabelName} categories to draft message ${draftId}`);
              }
            }
            
            // Add to processed set to prevent duplicate processing
            processedSet.add(`${msg.id}:${category.id}:draft`);
            
            // Create calendar event if meeting was scheduled
            if (parsedMeeting) {
              await createCalendarEventAndLog(
                tokenRecord.provider,
                accessToken,
                parsedMeeting,
                supabaseAdmin,
                userId,
                organizationId,
                connectionId,
                category.id,
                category.name,
                aiCalendarEventColor
              );
            }
          }
        }

        // Handle Auto-Reply
        if (needsAutoReply) {
          let sent = false;
          let sentMessageId: string | null = null;

          // Check if there's an existing draft for this email that we need to clean up
          const { data: existingDraft } = await supabaseAdmin
            .from('processed_emails')
            .select('draft_id')
            .eq('email_id', msg.id)
            .eq('category_id', category.id)
            .eq('action_type', 'draft')
            .maybeSingle();

          if (tokenRecord.provider === 'google') {
            const gmailSendResult = await sendGmailMessage(
              accessToken,
              emailDetails.replyTo,
              emailDetails.subject,
              draftContent,
              (emailDetails as { threadId: string }).threadId
            );
            sent = gmailSendResult.success;
            sentMessageId = gmailSendResult.messageId;
          } else {
            sent = await sendOutlookReply(accessToken, msg.id, draftContent);
          }

          if (sent) {
            // Remove AI Draft label from original email and delete the draft
            const aiDraftLabelName = '00: AI Draft';
            
            if (tokenRecord.provider === 'google') {
              // Get or cache the AI Draft label ID
              if (!gmailLabelCache[aiDraftLabelName]) {
                const labelId = await getOrCreateGmailLabel(accessToken, aiDraftLabelName, aiDraftLabelColor);
                if (labelId) gmailLabelCache[aiDraftLabelName] = labelId;
              }
              
              // Remove AI Draft label from original email
              if (gmailLabelCache[aiDraftLabelName]) {
                await removeGmailLabel(accessToken, msg.id, gmailLabelCache[aiDraftLabelName]);
                console.log(`Removed ${aiDraftLabelName} label from original email ${msg.id}`);
              }
              
              // Delete the draft from Gmail if it exists
              if (existingDraft?.draft_id) {
                await deleteGmailDraft(accessToken, existingDraft.draft_id);
                console.log(`Deleted Gmail draft ${existingDraft.draft_id} after sending auto-reply`);
              }
            } else {
              // Remove AI Draft category from original email in Outlook
              await removeOutlookCategory(accessToken, msg.id, aiDraftLabelName);
              console.log(`Removed ${aiDraftLabelName} category from original email ${msg.id}`);
              
              // Delete the draft from Outlook if it exists
              if (existingDraft?.draft_id) {
                await deleteOutlookDraft(accessToken, existingDraft.draft_id);
                console.log(`Deleted Outlook draft ${existingDraft.draft_id} after sending auto-reply`);
              }
            }

            await supabaseAdmin.from('processed_emails').insert({
              organization_id: organizationId,
              user_id: userId,
              email_id: msg.id,
              category_id: category.id,
              provider: tokenRecord.provider,
              action_type: 'auto_reply',
              sent_at: new Date().toISOString()
            });

            await supabaseAdmin.from('ai_activity_logs').insert({
              organization_id: organizationId,
              user_id: userId,
              connection_id: connectionId,
              category_id: category.id,
              category_name: category.name,
              activity_type: 'auto_reply',
              email_subject: emailDetails.subject,
              email_from: emailDetails.from
            });

            results.autoRepliesSent++;
            console.log(`Sent auto-reply for email ${msg.id}`);
            
            // Build category label name (e.g., "10: FYI")
            const categoryLabelName = `${String(category.sort_order + 1).padStart(2, '0')}: ${category.name}`;
            
            // Apply AI Sent label to original email (numbered as 01:)
            const aiSentLabelName = '01: AI Sent';
            if (tokenRecord.provider === 'google') {
              // Get/create category label if not cached
              if (!gmailLabelCache[categoryLabelName]) {
                const { data: catData } = await supabaseAdmin
                  .from('categories')
                  .select('color')
                  .eq('id', category.id)
                  .single();
                const catColor = catData?.color || '#3B82F6';
                const labelId = await getOrCreateGmailLabel(accessToken, categoryLabelName, catColor);
                if (labelId) gmailLabelCache[categoryLabelName] = labelId;
              }
              
              // Get/create AI Sent label
              if (!gmailLabelCache[aiSentLabelName]) {
                const labelId = await getOrCreateGmailLabel(accessToken, aiSentLabelName, aiSentLabelColor);
                if (labelId) gmailLabelCache[aiSentLabelName] = labelId;
              }
              
              // Apply category label to original email
              if (gmailLabelCache[categoryLabelName]) {
                await applyGmailLabel(accessToken, msg.id, gmailLabelCache[categoryLabelName]);
                console.log(`Applied ${categoryLabelName} label to original email ${msg.id}`);
              }
              
              // Apply AI Sent label to original email
              if (gmailLabelCache[aiSentLabelName]) {
                await applyGmailLabel(accessToken, msg.id, gmailLabelCache[aiSentLabelName]);
                // Also apply both labels to the sent message
                if (sentMessageId) {
                  if (gmailLabelCache[categoryLabelName]) {
                    await applyGmailLabel(accessToken, sentMessageId, gmailLabelCache[categoryLabelName]);
                  }
                  await applyGmailLabel(accessToken, sentMessageId, gmailLabelCache[aiSentLabelName]);
                  console.log(`Applied ${categoryLabelName} and ${aiSentLabelName} labels to sent message ${sentMessageId}`);
                }
              }
            } else {
              // Outlook: Create/get category labels
              if (!outlookCategoryCache[categoryLabelName]) {
                const { data: catData } = await supabaseAdmin
                  .from('categories')
                  .select('color')
                  .eq('id', category.id)
                  .single();
                const catColor = catData?.color || '#3B82F6';
                await getOrCreateOutlookCategory(accessToken, categoryLabelName, catColor);
                outlookCategoryCache[categoryLabelName] = true;
              }
              if (!outlookCategoryCache[aiSentLabelName]) {
                await getOrCreateOutlookCategory(accessToken, aiSentLabelName, aiSentLabelColor);
                outlookCategoryCache[aiSentLabelName] = true;
              }
              
              // Apply category label to original email
              await applyOutlookCategory(accessToken, msg.id, categoryLabelName);
              console.log(`Applied ${categoryLabelName} category to original email ${msg.id}`);
              
              // Apply AI Sent label to original email
              await applyOutlookCategory(accessToken, msg.id, aiSentLabelName);
            }
            
            // Add to processed set
            processedSet.add(`${msg.id}:${category.id}:auto_reply`);
            
            // Create calendar event if meeting was scheduled
            if (parsedMeeting) {
              await createCalendarEventAndLog(
                tokenRecord.provider,
                accessToken,
                parsedMeeting,
                supabaseAdmin,
                userId,
                organizationId,
                connectionId,
                category.id,
                category.name,
                aiCalendarEventColor
              );
            }
          }
        }
      }
    }
  }

  return results;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse request body
    let categoryId: string | null = null;
    let cronMode = false;
    try {
      const body = await req.json();
      categoryId = body?.category_id || null;
      cronMode = body?.cron === true;
    } catch {
      // No body or invalid JSON - this is typical for cron calls
      cronMode = true;
    }

    // Detect if this is a cron call (anon key only, not a real user token)
    const isAnonKeyOnly = authHeader === `Bearer ${anonKey}`;
    const isCronCall = !authHeader || cronMode || isAnonKeyOnly;

    // CRON MODE: Process ALL connections with AI-enabled categories
    if (isCronCall) {
      console.log('=== CRON MODE: Processing all connections ===');
      
      // Get all connections that have AI-enabled categories
      const { data: connectionsWithAI } = await supabaseAdmin
        .from('categories')
        .select('connection_id, organization_id')
        .eq('is_enabled', true)
        .not('connection_id', 'is', null)
        .or('ai_draft_enabled.eq.true,auto_reply_enabled.eq.true');
      
      if (!connectionsWithAI?.length) {
        console.log('No connections with AI-enabled categories');
        return new Response(
          JSON.stringify({ message: 'No AI-enabled categories', processed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Get unique connection IDs
      const connectionIds = [...new Set(connectionsWithAI.map(c => c.connection_id))];
      console.log(`Found ${connectionIds.length} connections with AI-enabled categories`);
      
      const totalResults = { draftsCreated: 0, autoRepliesSent: 0, errors: 0, connectionsProcessed: 0 };
      
      // Process each connection
      for (const connId of connectionIds) {
        if (!connId) continue;
        
        // Get connection details
        const { data: connection } = await supabaseAdmin
          .from('provider_connections')
          .select('id, user_id, organization_id, connected_email')
          .eq('id', connId)
          .eq('is_connected', true)
          .single();
        
        if (!connection) {
          console.log(`Connection ${connId} not found or not connected`);
          continue;
        }
        
        // Get email profile for this connection
        const { data: emailProfile } = await supabaseAdmin
          .from('email_profiles')
          .select('*')
          .eq('connection_id', connId)
          .single();
        
        const profile: EmailProfile = emailProfile ? {
          connection_id: connId,
          full_name: emailProfile.full_name,
          title: emailProfile.title,
          email: connection.connected_email,
          email_signature: emailProfile.email_signature,
          phone: emailProfile.phone,
          mobile: emailProfile.mobile,
          website: emailProfile.website,
          signature_logo_url: emailProfile.signature_logo_url,
          signature_font: emailProfile.signature_font,
          signature_color: emailProfile.signature_color
        } : {
          connection_id: connId,
          full_name: null,
          title: null,
          email: connection.connected_email,
          email_signature: null,
          phone: null,
          mobile: null,
          website: null,
          signature_logo_url: null,
          signature_font: null,
          signature_color: null
        };
        
        console.log(`Processing connection ${connId} for user ${connection.user_id}`);
        
        try {
          const connResults = await processConnectionEmails(
            connection.user_id, 
            connection.organization_id, 
            connId,
            profile, 
            categoryId
          );
          totalResults.draftsCreated += connResults.draftsCreated;
          totalResults.autoRepliesSent += connResults.autoRepliesSent;
          totalResults.errors += connResults.errors;
          totalResults.connectionsProcessed++;
        } catch (connError) {
          console.error(`Error processing connection ${connId}:`, connError);
          totalResults.errors++;
        }
      }
      
      console.log(`=== CRON complete: ${totalResults.connectionsProcessed} connections, ${totalResults.draftsCreated} drafts, ${totalResults.autoRepliesSent} auto-replies ===`);
      
      return new Response(
        JSON.stringify({
          success: true,
          ...totalResults,
          message: `Processed ${totalResults.connectionsProcessed} connections: ${totalResults.draftsCreated} drafts, ${totalResults.autoRepliesSent} auto-replies`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // USER MODE: Process all of the authenticated user's connections
    console.log('=== USER MODE: Processing single user connections ===');
    
    const supabaseUserClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's organization
    const { data: profileData } = await supabaseAdmin
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();
    
    if (!profileData?.organization_id) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all connected emails for this user
    const { data: connections } = await supabaseAdmin
      .from('provider_connections')
      .select('id, connected_email')
      .eq('user_id', user.id)
      .eq('is_connected', true);

    if (!connections?.length) {
      return new Response(
        JSON.stringify({ message: 'No connected email accounts', draftsCreated: 0, autoRepliesSent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const totalResults = { draftsCreated: 0, autoRepliesSent: 0, errors: 0, connectionsProcessed: 0 };

    for (const conn of connections) {
      // Get email profile for this connection
      const { data: emailProfile } = await supabaseAdmin
        .from('email_profiles')
        .select('*')
        .eq('connection_id', conn.id)
        .maybeSingle();

      const profile: EmailProfile = emailProfile ? {
        connection_id: conn.id,
        full_name: emailProfile.full_name,
        title: emailProfile.title,
        email: conn.connected_email,
        email_signature: emailProfile.email_signature,
        phone: emailProfile.phone,
        mobile: emailProfile.mobile,
        website: emailProfile.website,
        signature_logo_url: emailProfile.signature_logo_url,
        signature_font: emailProfile.signature_font,
        signature_color: emailProfile.signature_color
      } : {
        connection_id: conn.id,
        full_name: null,
        title: null,
        email: conn.connected_email,
        email_signature: null,
        phone: null,
        mobile: null,
        website: null,
        signature_logo_url: null,
        signature_font: null,
        signature_color: null
      };

      try {
        const connResults = await processConnectionEmails(
          user.id,
          profileData.organization_id,
          conn.id,
          profile,
          categoryId
        );
        totalResults.draftsCreated += connResults.draftsCreated;
        totalResults.autoRepliesSent += connResults.autoRepliesSent;
        totalResults.errors += connResults.errors;
        totalResults.connectionsProcessed++;
      } catch (connError) {
        console.error(`Error processing connection ${conn.id}:`, connError);
        totalResults.errors++;
      }
    }

    console.log(`=== USER MODE complete: ${totalResults.connectionsProcessed} connections, ${totalResults.draftsCreated} drafts, ${totalResults.autoRepliesSent} auto-replies ===`);

    return new Response(
      JSON.stringify({
        success: true,
        ...totalResults,
        message: `Created ${totalResults.draftsCreated} drafts, sent ${totalResults.autoRepliesSent} auto-replies`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Process AI emails error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
