-- Older permissive policies are OR-ed with newer policies and must be removed.
drop policy if exists "Public Upload to uploaded_images" on storage.objects;
drop policy if exists "Public Select from uploaded_images" on storage.objects;
drop policy if exists "Public Update uploaded_images" on storage.objects;
drop policy if exists "Public Read Uploaded Images" on storage.objects;
drop policy if exists "Authenticated Upload Uploaded Images" on storage.objects;
drop policy if exists "Owner Read Private Documents" on storage.objects;
drop policy if exists "Authenticated Upload Private Documents" on storage.objects;
