# Nikkore Inbox Rebrand

## Goal
Replace the visible EnergyForward/InboxIQ identity with **Nikkore Inbox**, using the supplied Nikkore wordmark and object mark throughout the app and customer emails.

## Changes
- Add the supplied Nikkore logo files to the app’s managed assets and create a square Nikkore favicon.
- Update the sign-in page, desktop and mobile navigation, page titles, metadata, and other user-facing labels to **Nikkore Inbox**.
- Update authentication, welcome, notification, and report email content to use Nikkore Inbox branding and colors.
- Replace legacy logo artwork in visible app surfaces, extension artwork, and Teams package artwork where compatible.
- Update default organization/display values that still say EnergyForward, without rewriting existing customer organization names.
- Add tenant branding fields so each organization can keep its own company name/logo while the platform remains Nikkore Inbox.
- Remove stale legacy branding references from help text, examples, manifests, and documentation.

## Compatibility and safety
- Preserve the current production domain, sender addresses, OAuth callback URLs, extension host permissions, and the current super-admin login until replacement Nikkore infrastructure is supplied and verified.
- Treat those remaining EnergyForward strings as operational identifiers only, never visible product branding.
- Keep all organization data isolated through the existing organization ID and access policies.

## Verification
- Check the sign-in page and authenticated navigation at desktop and mobile sizes.
- Verify the favicon, logo rendering, page metadata, email template output, and application build.
- Report any operational EnergyForward identifiers intentionally retained and what is needed to replace them later.
