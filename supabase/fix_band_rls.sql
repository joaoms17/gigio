-- Permite que qualquer utilizador autenticado veja uma banda pelo invite_code
-- (necessário para o fluxo de "entrar com código" antes de ser membro)
create policy "bands_select_by_invite" on public.bands for select
  using (auth.uid() is not null);

-- Nota: esta policy é mais permissiva que o necessário.
-- Uma alternativa mais restrita seria usar uma função RPC.
-- Por agora, qualquer utilizador autenticado pode ver qualquer banda —
-- mas só membros podem ver os detalhes dos membros (protegido por band_members_select).
