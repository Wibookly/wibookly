import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listCategoriesTool from "./tools/list-categories";
import listPriorityEmailsTool from "./tools/list-priority-emails";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "inboxiq-mcp",
  title: "InboxIQ",
  version: "0.1.0",
  instructions:
    "Tools for InboxIQ. Use `whoami` to verify the signed-in user, `list_categories` to inspect the user's email categories, and `list_priority_emails` to fetch their open priority inbox items.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listCategoriesTool, listPriorityEmailsTool],
});
