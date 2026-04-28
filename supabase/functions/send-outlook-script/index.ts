// Generates a personalized PowerShell setup script for Outlook (folder colors
// + add to Favorites) and emails it as an attachment to the requesting user
// from the org's agent shared mailbox via Microsoft Graph.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MS_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") || "";
const MS_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") || "";
const MS_TENANT_FALLBACK = Deno.env.get("MICROSOFT_TENANT_ID") || "";
const AGENT_FROM = "agent@energyforward.com";

async function getAppToken(tenantId: string): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

// Map hex colors to the closest Outlook Master Category color name.
const OUTLOOK_COLORS = [
  { name: "Red Category",        hex: "#E81123" },
  { name: "Orange Category",     hex: "#F7630C" },
  { name: "Peach Category",      hex: "#FFB900" },
  { name: "Yellow Category",     hex: "#FFF100" },
  { name: "Green Category",      hex: "#107C10" },
  { name: "Teal Category",       hex: "#00B294" },
  { name: "Olive Category",      hex: "#498205" },
  { name: "Blue Category",       hex: "#0078D4" },
  { name: "Purple Category",     hex: "#5C2D91" },
  { name: "Maroon Category",     hex: "#A4262C" },
  { name: "Steel Category",      hex: "#5D5A58" },
  { name: "DarkSteel Category",  hex: "#3B3A39" },
  { name: "Gray Category",       hex: "#737373" },
  { name: "DarkGray Category",   hex: "#4A4A4A" },
  { name: "Black Category",      hex: "#000000" },
];

function nearestOutlookColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  let best = OUTLOOK_COLORS[0];
  let bestDist = Infinity;
  for (const c of OUTLOOK_COLORS) {
    const ch = c.hex.replace("#", "");
    const cr = parseInt(ch.slice(0, 2), 16);
    const cg = parseInt(ch.slice(2, 4), 16);
    const cb = parseInt(ch.slice(4, 6), 16);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best.name;
}

// Map a hex color to the nearest colored Unicode "dot" emoji.
// These render as small colored circles in Outlook folder names — a friendlier
// alternative to a generic ⭐ that lets each folder show its category color.
const COLOR_DOTS = [
  { dot: "🔴", hex: "#E81123" }, // red
  { dot: "🟠", hex: "#F7630C" }, // orange
  { dot: "🟡", hex: "#FFB900" }, // yellow / peach
  { dot: "🟢", hex: "#107C10" }, // green
  { dot: "🔵", hex: "#0078D4" }, // blue
  { dot: "🟣", hex: "#5C2D91" }, // purple
  { dot: "🟤", hex: "#A4262C" }, // maroon / brown
  { dot: "⚫", hex: "#000000" }, // black
  { dot: "⚪", hex: "#737373" }, // gray
];

function nearestColorDot(hex: string): string {
  const h = (hex || "#737373").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  let best = COLOR_DOTS[0];
  let bestDist = Infinity;
  for (const c of COLOR_DOTS) {
    const ch = c.hex.replace("#", "");
    const cr = parseInt(ch.slice(0, 2), 16);
    const cg = parseInt(ch.slice(2, 4), 16);
    const cb = parseInt(ch.slice(4, 6), 16);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best.dot;
}

interface CategoryRow {
  name: string;
  color: string;
  sort_order: number;
  is_enabled: boolean;
  is_favorite?: boolean;
}

function buildPowerShell(userName: string, categories: CategoryRow[]): string {
  const enabled = categories.filter(c => c.is_enabled).sort((a, b) => a.sort_order - b.sort_order);
  const items = enabled.map(c => {
    const dot = nearestColorDot(c.color);
    const folderName = `${dot} ${String(c.sort_order + 1).padStart(2, "0")}: ${c.name}`;
    const colorName = nearestOutlookColor(c.color);
    const fav = c.is_favorite !== false ? "$true" : "$false";
    return `    [pscustomobject]@{ FolderName='${folderName.replace(/'/g, "''")}'; ColorName='${colorName}'; Favorite=${fav} }`;
  }).join(",`r`n");

  return `# ==============================================================
# InboxIQ — Outlook Setup Script
# Generated for: ${userName}
# Date: ${new Date().toISOString().slice(0, 10)}
#
# What this does (Windows + Outlook Desktop only):
#  1. Creates Outlook Master Categories matching your InboxIQ folder colors
#  2. Adds your InboxIQ folders to the Favorites pane
#
# How to run:
#  1. Save this file as InboxIQ-Setup.ps1
#  2. Right-click → Run with PowerShell
#  3. If blocked, run: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ==============================================================

\$ErrorActionPreference = 'Continue'

\$Categories = @(
${items}
)

Write-Host "Connecting to Outlook..." -ForegroundColor Cyan
try {
  \$Outlook = New-Object -ComObject Outlook.Application
  \$Namespace = \$Outlook.GetNamespace("MAPI")
  \$Inbox = \$Namespace.GetDefaultFolder(6)  # 6 = olFolderInbox
  \$Store = \$Inbox.Store
} catch {
  Write-Host "ERROR: Could not connect to Outlook. Make sure Outlook Desktop is installed and running." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# 1. Create / update Master Categories
Write-Host "Creating color categories..." -ForegroundColor Cyan
\$MasterCats = \$Namespace.Categories
foreach (\$item in \$Categories) {
  \$existing = \$null
  foreach (\$mc in \$MasterCats) { if (\$mc.Name -eq \$item.FolderName) { \$existing = \$mc; break } }
  if (\$existing) {
    Write-Host "  - Updating: \$(\$item.FolderName) → \$(\$item.ColorName)"
    \$existing.Color = [enum]::Parse([type]"Microsoft.Office.Interop.Outlook.OlCategoryColor", \$item.ColorName)
  } else {
    try {
      Write-Host "  + Creating: \$(\$item.FolderName) → \$(\$item.ColorName)"
      \$MasterCats.Add(\$item.FolderName, \$item.ColorName) | Out-Null
    } catch {
      Write-Host "    (Could not create '\$(\$item.FolderName)': \$_)" -ForegroundColor Yellow
    }
  }
}

# 2. Add folders to Favorites
Write-Host "Adding folders to Favorites..." -ForegroundColor Cyan
\$Favorites = \$null
try {
  # Outlook Favorites live on the active explorer's NavigationModule (Mail = 1)
  \$Explorer = \$Outlook.ActiveExplorer()
  if (\$Explorer -ne \$null) {
    \$NavModule = \$Explorer.NavigationPane.Modules.GetNavigationModule(1)  # 1 = olModuleMail
    \$Favorites = \$NavModule.NavigationGroups.GetDefaultNavigationGroup().NavigationFolders
  }
} catch {
  Write-Host "  (Favorites pane not available — you may need to open Outlook first)" -ForegroundColor Yellow
}

if (\$Favorites -ne \$null) {
  \$Root = \$Store.GetRootFolder()
  foreach (\$item in \$Categories) {
    if (-not \$item.Favorite) { continue }
    \$folder = \$null
    foreach (\$f in \$Root.Folders) { if (\$f.Name -eq \$item.FolderName) { \$folder = \$f; break } }
    if (\$folder -eq \$null) {
      foreach (\$f in \$Inbox.Folders) { if (\$f.Name -eq \$item.FolderName) { \$folder = \$f; break } }
    }
    if (\$folder) {
      try {
        \$alreadyFav = \$false
        foreach (\$nf in \$Favorites) { if (\$nf.DisplayName -eq \$item.FolderName) { \$alreadyFav = \$true; break } }
        if (-not \$alreadyFav) {
          Write-Host "  + Pinning to Favorites: \$(\$item.FolderName)"
          \$Favorites.Add(\$folder) | Out-Null
        } else {
          Write-Host "  · Already in Favorites: \$(\$item.FolderName)"
        }
      } catch {
        Write-Host "    (Skipped '\$(\$item.FolderName)': \$_)" -ForegroundColor Yellow
      }
    } else {
      Write-Host "    (Folder not found: '\$(\$item.FolderName)' — make sure InboxIQ has synced)" -ForegroundColor Yellow
    }
  }
}

Write-Host ""
Write-Host "Done! Restart Outlook for all changes to appear." -ForegroundColor Green
Read-Host "Press Enter to exit"
`;
}

function buildEmailHtml(userName: string, categoryCount: number): string {
  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;max-width:680px;margin:0 auto;padding:24px">
  <h1 style="font-size:22px;border-bottom:3px solid #0ea5e9;padding-bottom:10px">Your Outlook Setup Script is ready</h1>
  <p>Hi ${userName},</p>
  <p>Attached is a personalized PowerShell script (<code>InboxIQ-Setup.ps1</code>) that will:</p>
  <ul>
    <li>Create <strong>${categoryCount} color categories</strong> in your Outlook matching your InboxIQ folder colors</li>
    <li>Pin your InboxIQ folders to the <strong>Favorites pane</strong></li>
  </ul>
  <h2 style="font-size:16px;margin-top:24px">How to run it</h2>
  <ol>
    <li>Save the attached <code>InboxIQ-Setup.ps1</code> file to your computer</li>
    <li>Right-click it → <strong>Run with PowerShell</strong></li>
    <li>If Windows blocks the script, open PowerShell and run:<br/>
      <code style="background:#f1f5f9;padding:4px 8px;border-radius:4px">Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code>
    </li>
    <li>Restart Outlook when finished</li>
  </ol>
  <p style="background:#fef3c7;padding:12px;border-radius:6px;font-size:13px">
    <strong>Requirements:</strong> Windows + Outlook Desktop (this won't work on Outlook Web or Mac).
  </p>
  <hr style="margin-top:24px;border:none;border-top:1px solid #e2e8f0"/>
  <p style="color:#94a3b8;font-size:12px">Sent by InboxIQ Agent</p>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { connectionId } = await req.json();
    if (!connectionId) {
      return new Response(JSON.stringify({ error: "connectionId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify connection ownership + get user profile
    const { data: connection } = await supabase
      .from("provider_connections")
      .select("id, user_id, organization_id, connected_email")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .single();
    if (!connection) {
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name, email")
      .eq("user_id", user.id)
      .single();

    const recipient = connection.connected_email || profile?.email;
    if (!recipient) {
      return new Response(JSON.stringify({ error: "No recipient email found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("name, color, sort_order, is_enabled")
      .eq("connection_id", connectionId);
    if (catError) {
      console.error("Failed to load categories:", catError);
      return new Response(JSON.stringify({ error: "Failed to load categories", details: catError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cats: CategoryRow[] = ((categories as CategoryRow[]) || []).map(c => ({ ...c, is_favorite: true }));
    if (!cats.length) {
      return new Response(JSON.stringify({ error: "No categories to script" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userName = (profile?.full_name || recipient).split(" ")[0];
    const ps1 = buildPowerShell(profile?.full_name || recipient, cats);
    const html = buildEmailHtml(userName, cats.filter(c => c.is_enabled).length);

    // Send via Microsoft Graph from agent shared mailbox
    const tenantId = MS_TENANT_FALLBACK;
    if (!tenantId || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Microsoft Graph credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const appToken = await getAppToken(tenantId);

    const attachmentBytes = new TextEncoder().encode(ps1);
    let bin = "";
    for (let i = 0; i < attachmentBytes.length; i++) bin += String.fromCharCode(attachmentBytes[i]);
    const base64 = btoa(bin);

    const sendRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${AGENT_FROM}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${appToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: "Your Outlook Setup Script — InboxIQ",
            body: { contentType: "HTML", content: html },
            toRecipients: [{ emailAddress: { address: recipient } }],
            attachments: [
              {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: "InboxIQ-Setup.ps1",
                contentType: "text/plain",
                contentBytes: base64,
              },
            ],
          },
          saveToSentItems: false,
        }),
      }
    );
    if (!sendRes.ok) {
      const text = await sendRes.text();
      console.error("Graph sendMail failed:", sendRes.status, text);
      return new Response(JSON.stringify({ error: "Failed to send email", details: text }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, sent_to: recipient }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-outlook-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
