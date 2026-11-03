-- Learn : synchronisation entre appareils (Supabase).
-- À exécuter une fois dans le projet Supabase : SQL Editor → New query → coller → Run.
--
-- Une seule table d'enregistrements : abonnements (source), états d'articles (item), surlignages (highlight)
-- et boards (board). Chaque utilisateur ne voit que ses lignes (Row Level Security). En cas de modification
-- sur deux appareils, la plus récente gagne (updated_at fourni par l'appareil) ; server_at sert à ne
-- récupérer que ce qui a changé depuis la dernière synchronisation.

create table if not exists public.learn_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('source', 'item', 'highlight', 'board')),
  key text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at bigint not null,
  device text,
  server_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, key)
);

create index if not exists learn_records_pull on public.learn_records (user_id, server_at);

alter table public.learn_records enable row level security;

drop policy if exists "Chacun ses enregistrements" on public.learn_records;
create policy "Chacun ses enregistrements" on public.learn_records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Envoi groupé : n'écrase une ligne que si la version envoyée est plus récente.
create or replace function public.learn_push(records jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  written integer;
begin
  with incoming as (
    select r.kind, r.key, coalesce(r.data, '{}'::jsonb) as data, coalesce(r.deleted, false) as deleted, r.updated_at, r.device
    from jsonb_to_recordset(records) as r(kind text, key text, data jsonb, deleted boolean, updated_at bigint, device text)
  ), up as (
    insert into public.learn_records as t (user_id, kind, key, data, deleted, updated_at, device, server_at)
    select auth.uid(), kind, key, data, deleted, updated_at, device, clock_timestamp() from incoming
    on conflict (user_id, kind, key) do update
      set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at,
          device = excluded.device, server_at = clock_timestamp()
      where excluded.updated_at > t.updated_at
    returning 1
  )
  select count(*) into written from up;
  return written;
end;
$$;

grant execute on function public.learn_push(jsonb) to authenticated;
