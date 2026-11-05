alter table public.renters drop constraint if exists renters_phone_number_check;
alter table public.renters add constraint renters_phone_number_check check(phone_number is null or phone_number ~ '^[+]?[0-9][0-9 ()-]{6,19}$');
alter table public.owners drop constraint if exists owners_phone_number_check;
alter table public.owners add constraint owners_phone_number_check check(phone_number is null or phone_number ~ '^[+]?[0-9][0-9 ()-]{6,19}$');
alter table public.admins drop constraint if exists admins_phone_number_check;
alter table public.admins add constraint admins_phone_number_check check(phone_number is null or phone_number ~ '^[+]?[0-9][0-9 ()-]{6,19}$');
notify pgrst,'reload schema';
