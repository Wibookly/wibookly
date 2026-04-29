-- Rename existing "Follow Up" categories to "No Reply Tracker" and ensure is_follow_up flag set
UPDATE public.categories
SET name = 'No Reply Tracker', is_follow_up = true
WHERE name = 'Follow Up';

-- Also flag any other rows that look like follow-up trackers
UPDATE public.categories
SET is_follow_up = true
WHERE (name ILIKE '%follow up%' OR name ILIKE '%follow-up%' OR name ILIKE '%no reply%' OR name ILIKE '%no-reply%')
  AND is_follow_up = false;