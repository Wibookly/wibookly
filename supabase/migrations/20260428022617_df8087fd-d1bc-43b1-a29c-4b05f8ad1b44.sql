insert into storage.buckets (id, name, public) values ('profile-photos', 'profile-photos', true) on conflict (id) do nothing;

create policy "Public read profile photos"
on storage.objects for select
using (bucket_id = 'profile-photos');

create policy "Service role write profile photos"
on storage.objects for insert
with check (bucket_id = 'profile-photos');

create policy "Service role update profile photos"
on storage.objects for update
using (bucket_id = 'profile-photos');