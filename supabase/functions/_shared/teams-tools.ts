// Shared tool implementations for the InboxIQ Teams bot.
// deno-lint-ignore-file no-explicit-any
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageNumber,
  Header as DocxHeader,
  Footer as DocxFooter,
  LevelFormat,
} from "https://esm.sh/docx@8.5.0";
// All Microsoft Graph calls run as the END USER (per-user OAuth tokens
// stored in oauth_token_vault, decrypted with TOKEN_ENCRYPTION_KEY).
// Web search runs through OpenAI's web-enabled chat model so we don't
// need a separate Perplexity / Firecrawl key.

const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

/* ---------------- token crypto (mirrors ai-assistant-chat) ---------------- */

async function decryptToken(encrypted: string, keyString: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const keyData = new TextEncoder().encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(out);
}
async function encryptToken(token: string, keyString: string): Promise<string> {
  const keyData = new TextEncoder().encode(keyString.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + new Uint8Array(enc).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function refreshMicrosoftToken(refreshToken: string) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
      client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  return await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
}

/* ---------------- user identity ---------------- */

export interface ResolvedUser {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  microsoftAccessToken: string | null;
}

/**
 * Resolve a Teams sender (AAD object id + email) to an InboxIQ user and a
 * valid Microsoft Graph access token belonging to that user.
 */
export async function resolveTeamsUser(opts: {
  aadObjectId: string | null;
  senderEmail: string | null;
  organizationId: string;
}): Promise<ResolvedUser | null> {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 1. Find profile by email (most reliable across SSO + manual signup)
  let profile: any = null;
  if (opts.senderEmail) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(opts.senderEmail.toLowerCase())}&organization_id=eq.${opts.organizationId}&select=user_id,organization_id,email,full_name&limit=1`,
      { headers }
    );
    const arr = await r.json();
    if (Array.isArray(arr) && arr[0]) profile = arr[0];
  }

  if (!profile) return null;

  // 2. Load Microsoft tokens
  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_token_vault?user_id=eq.${profile.user_id}&provider=eq.outlook&select=*&limit=1`,
    { headers }
  );
  const tokens = await tokRes.json();
  let accessToken: string | null = null;

  if (Array.isArray(tokens) && tokens[0]) {
    const td = tokens[0];
    const expired = td.expires_at && new Date(td.expires_at) < new Date();
    if (!expired) {
      accessToken = await decryptToken(td.encrypted_access_token, TOKEN_ENCRYPTION_KEY);
    } else if (td.encrypted_refresh_token) {
      const refresh = await decryptToken(td.encrypted_refresh_token, TOKEN_ENCRYPTION_KEY);
      const fresh = await refreshMicrosoftToken(refresh);
      if (fresh) {
        accessToken = fresh.access_token;
        const updates: Record<string, string> = {
          encrypted_access_token: await encryptToken(fresh.access_token, TOKEN_ENCRYPTION_KEY),
          expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (fresh.refresh_token) {
          updates.encrypted_refresh_token = await encryptToken(fresh.refresh_token, TOKEN_ENCRYPTION_KEY);
        }
        await fetch(
          `${SUPABASE_URL}/rest/v1/oauth_token_vault?user_id=eq.${profile.user_id}&provider=eq.outlook`,
          { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(updates) }
        );
      }
    }
  }

  return {
    userId: profile.user_id,
    organizationId: profile.organization_id,
    email: profile.email,
    fullName: profile.full_name,
    microsoftAccessToken: accessToken,
  };
}

/* ---------------- Microsoft Graph helpers ---------------- */

async function graph<T = any>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Graph ${path} -> ${res.status} ${await res.text()}`);
  return await res.json() as T;
}

/* ---------------- Tools ---------------- */

export async function searchEmails(token: string, query: string, top = 8): Promise<string> {
  try {
    const data = await graph<any>(token,
      `/me/messages?$search="${encodeURIComponent(query)}"&$top=${top}&$select=subject,from,bodyPreview,receivedDateTime,webLink,conversationId`
    );
    if (!data.value?.length) return 'No emails found.';
    return data.value.map((m: any, i: number) => {
      const from = m.from?.emailAddress?.address ?? 'unknown';
      return `${i + 1}. [${m.receivedDateTime?.slice(0, 10)}] ${m.subject}\n   From: ${from}\n   ${(m.bodyPreview ?? '').slice(0, 200)}\n   Link: ${m.webLink ?? ''}`;
    }).join('\n\n');
  } catch (e) {
    return `Email search failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function getEmailThread(token: string, conversationId: string): Promise<string> {
  try {
    const data = await graph<any>(token,
      `/me/messages?$filter=conversationId eq '${conversationId}'&$orderby=receivedDateTime asc&$top=20&$select=subject,from,bodyPreview,receivedDateTime`
    );
    if (!data.value?.length) return 'Thread not found.';
    return data.value.map((m: any) =>
      `[${m.receivedDateTime?.slice(0, 16).replace('T', ' ')}] ${m.from?.emailAddress?.address}: ${m.bodyPreview?.slice(0, 300)}`
    ).join('\n---\n');
  } catch (e) {
    return `Thread fetch failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function getCalendarEvents(token: string, daysAhead = 7): Promise<string> {
  try {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + daysAhead * 86400000).toISOString();
    const data = await graph<any>(token,
      `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=20&$select=subject,start,end,location,attendees,organizer,bodyPreview&$orderby=start/dateTime`
    );
    if (!data.value?.length) return `No events in the next ${daysAhead} days.`;
    return data.value.map((e: any) => {
      const when = `${e.start?.dateTime?.slice(0, 16).replace('T', ' ')} → ${e.end?.dateTime?.slice(11, 16)}`;
      const att = (e.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean).slice(0, 5).join(', ');
      return `• ${when} — ${e.subject}\n  Location: ${e.location?.displayName ?? '—'}\n  Attendees: ${att || '—'}`;
    }).join('\n\n');
  } catch (e) {
    return `Calendar fetch failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function searchOneDrive(token: string, query: string): Promise<string> {
  try {
    const data = await graph<any>(token,
      `/me/drive/root/search(q='${encodeURIComponent(query)}')?$top=8&$select=name,webUrl,lastModifiedDateTime,size,file`
    );
    if (!data.value?.length) return 'No files found.';
    return data.value.map((f: any, i: number) =>
      `${i + 1}. ${f.name}\n   Modified: ${f.lastModifiedDateTime?.slice(0, 10)}\n   Link: ${f.webUrl}`
    ).join('\n\n');
  } catch (e) {
    return `OneDrive search failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function searchTeamsChats(token: string, query: string): Promise<string> {
  try {
    const data = await graph<any>(token, `/search/query`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          entityTypes: ['chatMessage'],
          query: { queryString: query },
          from: 0, size: 10,
        }],
      }),
    });
    const hits = data?.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
    if (!hits.length) return 'No Teams messages found.';
    return hits.map((h: any, i: number) => {
      const r = h.resource ?? {};
      const from = r.from?.user?.displayName ?? r.from?.emailAddress ?? 'unknown';
      const preview = (r.body?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${i + 1}. [${r.createdDateTime?.slice(0, 10)}] ${from}: ${preview}`;
    }).join('\n\n');
  } catch (e) {
    return `Teams chat search failed: ${e instanceof Error ? e.message : e}`;
  }
}

/* ---------------- Artifact generation (HTML / docs / code / anything) ----------------
 * Generates a self-contained file (HTML dashboard, report, code, etc.),
 * uploads it to the user's OneDrive, and returns a sharable link.
 * This makes the bot able to "create" things like ChatGPT/Claude can.
 */

const ARTIFACT_MODEL = 'gpt-4o';

async function generateArtifactContent(opts: {
  kind: string;
  topic: string;
  details?: string;
  brandColor?: string;
}): Promise<string> {
  const color = opts.brandColor || '#1e40af';
  let systemPrompt = '';
  let userPrompt = '';

  switch (opts.kind) {
    case 'html_dashboard':
      systemPrompt = 'You output ONLY raw HTML files. Never use markdown code fences. Never add commentary.';
      userPrompt = `Generate ONE complete, self-contained HTML5 file for a beautiful executive dashboard about: "${opts.topic}".
${opts.details ? `Extra context: ${opts.details}\n` : ''}
REQUIREMENTS:
- Single HTML file. All CSS inline in <style>. Chart.js v4 from CDN: https://cdn.jsdelivr.net/npm/chart.js
- Premium design: rounded cards (16px radius), soft shadows, generous whitespace, Inter/system font.
- Primary brand color: ${color}. Greens for positive, ambers/reds for negative. Light gray background (#f7f8fb), white cards.
- Header: title + subtitle + last-updated date.
- 4 KPI cards (number + label + % change with up/down arrow).
- 2-column section with 4+ charts: line (trend), bar (comparison), doughnut (breakdown), horizontal bar (ranking).
- Styled data table with 8+ rows.
- Generate REALISTIC dummy data: real-sounding company/region/product names, credible numbers (not 1,2,3,4).
- Charts render on page load. Legend bottom, smooth lines, rounded bars.
- Responsive + print-friendly.
- Footer: "Generated by InboxIQ • Sample data for presentation purposes".
- Output ONLY raw HTML starting with <!DOCTYPE html>.`;
      break;
    case 'html_page':
      systemPrompt = 'You output ONLY raw HTML. No markdown fences, no commentary.';
      userPrompt = `Generate ONE complete, self-contained HTML5 file: "${opts.topic}".
${opts.details ? `Details: ${opts.details}\n` : ''}
- All CSS inline. Modern, clean design. Brand color: ${color}.
- Responsive. Print-friendly.
- Output ONLY raw HTML starting with <!DOCTYPE html>.`;
      break;
    case 'markdown':
      systemPrompt = 'You output high-quality long-form Markdown documents.';
      userPrompt = `Write a thorough, well-structured Markdown document: "${opts.topic}".
${opts.details ? `Details: ${opts.details}\n` : ''}
- Use headings, lists, tables, bold/italic where appropriate.
- Be comprehensive — do not cut short.`;
      break;
    case 'code':
      systemPrompt = 'You write production-quality code. Output the full file contents only.';
      userPrompt = `Write the code requested: "${opts.topic}". ${opts.details ?? ''}
Output the file contents only — no markdown fences.`;
      break;
    case 'docx_document':
      // Handled separately via generateDocxBuffer — should not hit this path.
      systemPrompt = '';
      userPrompt = '';
      break;
    default:
      systemPrompt = 'You produce the requested artifact in full, no truncation.';
      userPrompt = `${opts.topic}\n${opts.details ?? ''}`;
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ARTIFACT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 12000,
    }),
  });
  if (!res.ok) throw new Error(`Artifact gen failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? '';
  content = content.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  return content;
}

async function uploadToOneDrive(opts: {
  graphToken: string;
  folder: string;
  filename: string;
  content: string | Uint8Array;
  contentType: string;
}): Promise<{ webUrl: string; shareUrl: string; fileId: string } | { error: string }> {
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(opts.folder)}/${encodeURIComponent(opts.filename)}:/content`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${opts.graphToken}`, 'Content-Type': opts.contentType },
      body: opts.content as any,
    }
  );
  if (!uploadRes.ok) {
    const txt = await uploadRes.text();
    return { error: `OneDrive upload failed (${uploadRes.status}): ${txt.slice(0, 300)}` };
  }
  const file = await uploadRes.json();
  let shareUrl: string = file.webUrl;
  try {
    const linkRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/createLink`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.graphToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'view', scope: 'organization' }),
      }
    );
    if (linkRes.ok) {
      const linkData = await linkRes.json();
      if (linkData?.link?.webUrl) shareUrl = linkData.link.webUrl;
    }
  } catch (_) { /* ignore */ }
  return { webUrl: file.webUrl, shareUrl, fileId: file.id };
}

/* ---------------- DOCX (real Word document) generator ----------------
 * Asks GPT to produce a structured JSON outline describing the policy /
 * report / memo, then renders a real .docx with the `docx` library and
 * uploads the binary to OneDrive. This is what lets the email agent
 * produce ChatGPT/Claude-quality Word documents.
 */

interface DocxBlock {
  type: 'heading' | 'paragraph' | 'bullets' | 'numbered' | 'table' | 'pagebreak' | 'signature';
  level?: 1 | 2 | 3;
  text?: string;
  items?: string[];
  rows?: string[][]; // first row = header
}

interface DocxSpec {
  title: string;
  subtitle?: string;
  meta?: { label: string; value: string }[]; // top metadata table
  blocks: DocxBlock[];
  footer?: string;
}

async function buildDocxSpec(opts: {
  topic: string;
  details?: string;
  brandColor?: string;
  companyName?: string;
}): Promise<DocxSpec> {
  const sys = `You produce a JSON outline for a polished, executive-ready Microsoft Word document (policy, report, memo, plan, or guide). Output STRICT JSON only — no markdown, no commentary. Match the depth and rigor of a document Claude or ChatGPT would produce: comprehensive, well-sectioned, with realistic detail. Aim for 8–14 substantive sections.`;

  const schemaHint = `Return JSON with this exact shape:
{
  "title": string,
  "subtitle": string (optional one-line tagline),
  "meta": [ { "label": string, "value": string } ]   // 4-6 rows for the cover metadata table (Document Name, Version, Effective Date, Review Date, Owner, Applies To, etc.)
  "blocks": [
    { "type": "heading", "level": 1|2|3, "text": string },
    { "type": "paragraph", "text": string },
    { "type": "bullets", "items": [string, ...] },
    { "type": "numbered", "items": [string, ...] },
    { "type": "table", "rows": [ [headerCells...], [cells...], ... ] },
    { "type": "pagebreak" },
    { "type": "signature" }   // renders signature block (Employee Name/Date, Employee Signature/Manager Signature)
  ],
  "footer": string   // short confidentiality / footer line
}
Rules:
- Use heading level 1 for major numbered sections (1. Purpose, 2. Scope, ...).
- Use heading level 2 for sub-sections (3.1 Eligibility, ...).
- Be substantive — each paragraph must add real content (no placeholders like "TBD").
- If the request involves a policy, ALWAYS include sections covering: Purpose, Scope, Eligibility/Issuance, Acceptable Use, Prohibited Use, Security Requirements, Care/Maintenance, Remote/Off-site Use, Loss/Theft/Damage (with IT + manager notification, police report, remote wipe), Return of Device, Monitoring/Privacy, Policy Violations, and an Acknowledgement signature block at the end.
- If the user's email mentions specific roles/titles/company name, weave them into the document naturally.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Topic / request: "${opts.topic}"\n\nAdditional context from the requester:\n${opts.details ?? '(none)'}\n\nCompany: ${opts.companyName ?? '(infer from context if mentioned, otherwise use "the Company")'}\n\n${schemaHint}` },
      ],
      temperature: 0.5,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) throw new Error(`Docx outline gen failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const spec = JSON.parse(raw) as DocxSpec;
  if (!spec.blocks || !Array.isArray(spec.blocks)) throw new Error('Invalid docx outline');
  return spec;
}

function hexToDocxColor(hex?: string): string {
  if (!hex) return '1E40AF';
  return hex.replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
}

async function renderDocxBuffer(spec: DocxSpec, brandColor?: string): Promise<Uint8Array> {
  const color = hexToDocxColor(brandColor);
  const children: any[] = [];

  // Title
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: spec.title, bold: true, size: 44, color })],
  }));
  if (spec.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new TextRun({ text: spec.subtitle, italics: true, size: 24, color: '555555' })],
    }));
  }

  // Metadata table
  if (spec.meta?.length) {
    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };
    const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
    children.push(new DocxTable({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3120, 6240],
      rows: spec.meta.map(m => new DocxTableRow({
        children: [
          new DocxTableCell({
            borders,
            width: { size: 3120, type: WidthType.DXA },
            shading: { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: m.label, bold: true })] })],
          }),
          new DocxTableCell({
            borders,
            width: { size: 6240, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun(m.value)] })],
          }),
        ],
      })),
    }));
    children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
  }

  // Blocks
  for (const b of spec.blocks) {
    if (b.type === 'heading') {
      const level = b.level ?? 1;
      children.push(new Paragraph({
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level === 1 ? 320 : 200, after: 120 },
        children: [new TextRun({
          text: b.text ?? '',
          bold: true,
          color: level === 1 ? color : '111827',
          size: level === 1 ? 30 : level === 2 ? 26 : 24,
        })],
      }));
    } else if (b.type === 'paragraph') {
      children.push(new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: b.text ?? '', size: 22 })],
      }));
    } else if (b.type === 'bullets') {
      for (const it of b.items ?? []) {
        children.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: it, size: 22 })],
        }));
      }
    } else if (b.type === 'numbered') {
      for (const it of b.items ?? []) {
        children.push(new Paragraph({
          numbering: { reference: 'numbers', level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: it, size: 22 })],
        }));
      }
    } else if (b.type === 'table' && b.rows?.length) {
      const cols = b.rows[0].length || 1;
      const totalWidth = 9360;
      const colWidth = Math.floor(totalWidth / cols);
      const colWidths = Array.from({ length: cols }, () => colWidth);
      const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };
      const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
      children.push(new DocxTable({
        width: { size: totalWidth, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: b.rows.map((row, idx) => new DocxTableRow({
          children: row.map(cell => new DocxTableCell({
            borders,
            width: { size: colWidth, type: WidthType.DXA },
            shading: idx === 0 ? { fill: 'E5E7EB', type: ShadingType.CLEAR, color: 'auto' } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: cell ?? '', bold: idx === 0, size: 22 })] })],
          })),
        })),
      }));
      children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
    } else if (b.type === 'pagebreak') {
      children.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun('')] }));
    } else if (b.type === 'signature') {
      const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };
      const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
      children.push(new Paragraph({ text: '', spacing: { before: 200 } }));
      children.push(new DocxTable({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4680, 4680],
        rows: [
          new DocxTableRow({
            children: [
              new DocxTableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: 'Employee Name', bold: true })] }), new Paragraph({ text: '' }), new Paragraph({ text: '' })] }),
              new DocxTableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: 'Date', bold: true })] }), new Paragraph({ text: '' }), new Paragraph({ text: '' })] }),
            ],
          }),
          new DocxTableRow({
            children: [
              new DocxTableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: 'Employee Signature', bold: true })] }), new Paragraph({ text: '' }), new Paragraph({ text: '' })] }),
              new DocxTableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: 'Manager Signature', bold: true })] }), new Paragraph({ text: '' }), new Paragraph({ text: '' })] }),
            ],
          }),
        ],
      }));
    }
  }

  const doc = new DocxDocument({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: {
        default: new DocxFooter({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: spec.footer ?? 'Confidential — Internal Use Only', italics: true, size: 18, color: '6B7280' }),
              new TextRun({ text: '   |   Page ', size: 18, color: '6B7280' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '6B7280' }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

export async function generateArtifact(
  graphToken: string | null,
  args: { kind: string; topic: string; details?: string; brand_color?: string; filename?: string; company_name?: string },
): Promise<string> {
  try {
    const kind = args.kind || 'html_dashboard';

    // ---- DOCX branch (binary) ----
    if (kind === 'docx_document') {
      const spec = await buildDocxSpec({
        topic: args.topic,
        details: args.details,
        brandColor: args.brand_color,
        companyName: args.company_name,
      });
      const buf = await renderDocxBuffer(spec, args.brand_color);
      const slug = (args.filename || args.topic).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'document';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const filename = `${slug}-${stamp}.docx`;
      const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      if (!graphToken) {
        return JSON.stringify({
          ok: true,
          delivered: 'inline',
          filename,
          size_kb: Math.round(buf.byteLength / 1024),
          note: 'No Microsoft account linked — Word document generated but could not be saved to OneDrive.',
        });
      }
      const uploaded = await uploadToOneDrive({
        graphToken, folder: 'InboxIQ-Artifacts', filename, content: buf, contentType: mime,
      });
      if ('error' in uploaded) return JSON.stringify({ ok: false, error: uploaded.error, filename });
      return JSON.stringify({
        ok: true,
        delivered: 'onedrive',
        filename,
        size_kb: Math.round(buf.byteLength / 1024),
        onedrive_url: uploaded.webUrl,
        share_url: uploaded.shareUrl,
        message: `Saved Word document "${filename}" to your OneDrive in folder "InboxIQ-Artifacts".`,
      });
    }

    // ---- Text-based branches (html, md, code) ----
    const content = await generateArtifactContent({
      kind,
      topic: args.topic,
      details: args.details,
      brandColor: args.brand_color,
    });

    const ext = kind === 'html_dashboard' || kind === 'html_page'
      ? 'html'
      : kind === 'markdown' ? 'md'
      : kind === 'code' ? 'txt'
      : 'txt';
    const mime = ext === 'html' ? 'text/html' : ext === 'md' ? 'text/markdown' : 'text/plain';

    const slug = (args.filename || args.topic).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'artifact';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const filename = `${slug}-${stamp}.${ext}`;

    if (!graphToken) {
      return JSON.stringify({
        ok: true,
        delivered: 'inline',
        filename,
        size_kb: Math.round(content.length / 1024),
        preview: content.slice(0, 1500),
        note: 'No Microsoft account linked — could not save to OneDrive. Showing preview only.',
      });
    }

    const uploaded = await uploadToOneDrive({
      graphToken,
      folder: 'InboxIQ-Artifacts',
      filename,
      content,
      contentType: mime,
    });
    if ('error' in uploaded) {
      return JSON.stringify({ ok: false, error: uploaded.error, filename });
    }

    return JSON.stringify({
      ok: true,
      delivered: 'onedrive',
      filename,
      size_kb: Math.round(content.length / 1024),
      onedrive_url: uploaded.webUrl,
      share_url: uploaded.shareUrl,
      message: `Saved "${filename}" to your OneDrive in folder "InboxIQ-Artifacts". Click the share link to open it.`,
    });
  } catch (e) {
    return `Artifact generation failed: ${e instanceof Error ? e.message : e}`;
  }
}

/* ---------------- Web search via OpenAI Responses API ----------------
 * Uses gpt-4.1 with the native `web_search` tool from the Responses API.
 * The model invokes web_search only when needed (not forced every call).
 */
export async function webSearch(query: string): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1',
        instructions: 'Answer the user query using fresh web information when needed. Include 2-4 source URLs at the end.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
      }),
    });
    if (!res.ok) return `Web search failed: ${res.status} ${await res.text()}`;
    const data = await res.json();
    // Extract text from the Responses API output
    let text = '';
    for (const item of (data.output ?? [])) {
      if (item.type === 'message') {
        for (const p of (item.content ?? [])) {
          if (p.type === 'output_text' && typeof p.text === 'string') text += p.text;
        }
      }
    }
    return text.trim() || '(no web results)';
  } catch (e) {
    return `Web search failed: ${e instanceof Error ? e.message : e}`;
  }
}

/* ---------------- Tool registry for OpenAI function calling ---------------- */

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the live internet for current information, news, facts, prices, definitions, or anything that requires up-to-date public knowledge. Use this for any question about the outside world.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_emails',
      description: "Search the user's own Outlook mailbox by keyword, sender, subject, or content. Returns subject, sender, preview, date, and a link.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Free-text search (e.g. "invoice from acme last week")' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_email_thread',
      description: 'Fetch the full message thread for a given conversationId returned by search_emails.',
      parameters: {
        type: 'object',
        properties: { conversation_id: { type: 'string' } },
        required: ['conversation_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar',
      description: "Get the user's upcoming calendar events.",
      parameters: {
        type: 'object',
        properties: { days_ahead: { type: 'integer', description: 'How many days to look ahead (default 7)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: "Search the user's OneDrive / SharePoint files by name or content (Word, Excel, PowerPoint, PDF, etc.).",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_teams_chats',
      description: "Search the user's past Microsoft Teams chat and channel messages by keyword.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_artifact',
      description: "Generate a complete, polished artifact (real Microsoft Word .docx document, HTML dashboard with charts and dummy data, HTML page, long Markdown report, code file, etc.) and save it to the user's OneDrive so they can open or present it. Use this whenever the user asks you to CREATE / BUILD / GENERATE / MAKE / DRAFT a policy, report, memo, plan, dashboard, presentation, page, document, or any file — anything ChatGPT or Claude could produce. For policies, memos, contracts, plans, procedures, handbooks, or anything that should look like a Word document, ALWAYS use kind='docx_document'. For visual dashboards with charts use 'html_dashboard'. Always call this instead of refusing.",
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['docx_document', 'html_dashboard', 'html_page', 'markdown', 'code', 'text'],
            description: "What to generate. 'docx_document' for real Word documents (policies, memos, reports, plans). 'html_dashboard' for visual dashboards with charts.",
          },
          topic: { type: 'string', description: 'What the artifact is about (e.g. "Company Laptop Policy for 4STEL Engineering").' },
          details: { type: 'string', description: 'All specifics from the requester — sections to include, tone, audience, requirements, branding, dummy data permission, etc. Be thorough; this drives quality.' },
          brand_color: { type: 'string', description: 'Optional hex color (e.g. "#1e40af") for theming.' },
          filename: { type: 'string', description: 'Optional filename slug (no extension).' },
          company_name: { type: 'string', description: 'Optional company name to weave into the document.' },
        },
        required: ['topic'],
      },
    },
  },
];

export async function executeTool(
  name: string,
  args: any,
  graphToken: string | null,
): Promise<string> {
  switch (name) {
    case 'search_web':
      return await webSearch(args.query);
    case 'search_emails':
      if (!graphToken) return 'No Microsoft account connected — cannot read emails.';
      return await searchEmails(graphToken, args.query);
    case 'get_email_thread':
      if (!graphToken) return 'No Microsoft account connected.';
      return await getEmailThread(graphToken, args.conversation_id);
    case 'get_calendar':
      if (!graphToken) return 'No Microsoft account connected — cannot read calendar.';
      return await getCalendarEvents(graphToken, args.days_ahead ?? 7);
    case 'search_documents':
      if (!graphToken) return 'No Microsoft account connected — cannot read OneDrive.';
      return await searchOneDrive(graphToken, args.query);
    case 'search_teams_chats':
      if (!graphToken) return 'No Microsoft account connected — cannot read Teams chats.';
      return await searchTeamsChats(graphToken, args.query);
    case 'generate_artifact':
      return await generateArtifact(graphToken, args);
    default:
      return `Unknown tool: ${name}`;
  }
}
