-- Storage bucket para imagens de projetos
-- Correr no SQL Editor do Supabase Dashboard

insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', true)
on conflict (id) do nothing;

-- Qualquer pessoa pode ver (bucket público)
create policy "project images are publicly readable"
on storage.objects for select
using (bucket_id = 'project-images');

-- Utilizadores autenticados podem fazer upload
create policy "authenticated users can upload project images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'project-images');

-- Utilizadores autenticados podem substituir
create policy "authenticated users can update project images"
on storage.objects for update
to authenticated
using (bucket_id = 'project-images');

-- Utilizadores autenticados podem apagar
create policy "authenticated users can delete project images"
on storage.objects for delete
to authenticated
using (bucket_id = 'project-images');
