-- Schema do "Faltas ADS 2B" para Supabase.
-- Rode este script inteiro em: Supabase > seu projeto > SQL Editor > New query > Run.
-- Pode rodar de novo do zero se precisar (usa "drop if exists").

-- ---------- Extensão para gen_random_uuid() ----------
create extension if not exists pgcrypto;

-- ---------- Limpeza (para poder reexecutar durante o desenvolvimento) ----------
drop table if exists public.respostas cascade;
drop table if exists public.dias_respondidos cascade;
drop table if exists public.profiles cascade;
drop table if exists public.eventos cascade;
drop table if exists public.semanas_sem_aula cascade;
drop table if exists public.feriados cascade;
drop table if exists public.disciplinas cascade;
drop table if exists public.turmas cascade;

-- ---------- Tabelas de referência (grade, calendário) ----------
create table public.turmas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  curso text not null,
  periodo text not null,
  data_inicio_registro date not null -- a partir de qual dia o app passa a perguntar presença (faltas_base já cobre tudo antes disso)
);

create table public.disciplinas (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  nome text not null,
  ch int not null,
  permitidas int not null,
  faltas_base int not null default 0,
  dias jsonb not null default '{}',   -- ex: {"1": 2, "4": 2}  (0=Dom..6=Sáb -> faltas se perder o dia)
  pai boolean not null default false
);

create table public.feriados (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  data date not null,
  descricao text not null
);

create table public.semanas_sem_aula (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  inicio date not null,
  fim date not null,
  descricao text not null
);

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  data date not null,
  descricao text not null
);

-- ---------- Perfil de cada usuário (conta + assinatura) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text,
  turma_id uuid references public.turmas(id),
  is_admin boolean not null default false,
  assinatura_status text not null default 'trial' check (assinatura_status in ('trial', 'ativa', 'inadimplente', 'cancelada')),
  assinatura_ate date not null default (current_date + interval '7 days'),
  faltas_base_override jsonb not null default '{}',
  criado_em timestamptz not null default now()
);

-- ---------- Respostas de presença (por usuário) ----------
create table public.dias_respondidos (
  user_id uuid not null references public.profiles(id) on delete cascade,
  data date not null,
  primary key (user_id, data)
);

create table public.respostas (
  user_id uuid not null references public.profiles(id) on delete cascade,
  data date not null,
  disciplina_id uuid not null references public.disciplinas(id) on delete cascade,
  primary key (user_id, data, disciplina_id)
);

-- ---------- Criação automática de perfil ao cadastrar (trial de 7 dias) ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  turma_padrao uuid := 'b7a1874d-b460-4ef0-898f-a4396e80adc4';
begin
  insert into public.profiles (id, email, turma_id)
  values (new.id, new.email, turma_padrao);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Helper para políticas de admin (evita recursão nas policies de profiles) ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Row Level Security ----------
alter table public.turmas enable row level security;
alter table public.disciplinas enable row level security;
alter table public.feriados enable row level security;
alter table public.semanas_sem_aula enable row level security;
alter table public.eventos enable row level security;
alter table public.profiles enable row level security;
alter table public.dias_respondidos enable row level security;
alter table public.respostas enable row level security;

-- Dados de grade/calendário: leitura liberada para qualquer usuário autenticado.
create policy "turmas: leitura autenticada" on public.turmas for select to authenticated using (true);
create policy "disciplinas: leitura autenticada" on public.disciplinas for select to authenticated using (true);
create policy "feriados: leitura autenticada" on public.feriados for select to authenticated using (true);
create policy "semanas_sem_aula: leitura autenticada" on public.semanas_sem_aula for select to authenticated using (true);
create policy "eventos: leitura autenticada" on public.eventos for select to authenticated using (true);

-- profiles: cada usuário vê/edita o próprio; admin vê e edita todos (gestão de assinaturas).
create policy "profiles: ver o proprio ou admin ve todos" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles: atualizar o proprio" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admin atualiza qualquer um" on public.profiles
  for update to authenticated
  using (public.is_admin());

-- dias_respondidos / respostas: só o próprio usuário mexe nos seus dados de presença.
create policy "dias_respondidos: proprio usuario" on public.dias_respondidos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "respostas: proprio usuario" on public.respostas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Seed: turma ADS 2B NOITE 2026/2 (Faculdade Impacta) ----------
insert into public.turmas (id, nome, curso, periodo, data_inicio_registro) values
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', 'ADS 2B NOITE', 'Curso Superior de Tecnologia em Análise e Desenvolvimento de Sistemas', '2026/2', '2026-08-11');

insert into public.disciplinas (id, turma_id, nome, ch, permitidas, faltas_base, dias, pai) values
  ('6cb52351-f9c9-42a7-aaad-750f94bdb4f4', 'b7a1874d-b460-4ef0-898f-a4396e80adc4', 'Database Design', 80, 20, 2, '{"1":2,"4":2}', true),
  ('1a1e8fe2-e86f-4eaa-84c9-df6e1276c0bb', 'b7a1874d-b460-4ef0-898f-a4396e80adc4', 'Innovation Lab: Advanced No/Low Code', 40, 10, 2, '{"1":2}', true),
  ('e2b31113-53b5-4ba3-95de-0cee452dc2b6', 'b7a1874d-b460-4ef0-898f-a4396e80adc4', 'Programming & Algorithms', 80, 20, 0, '{"3":2,"4":2}', false),
  ('09aca68d-6f47-47ab-9e3e-2436761252ca', 'b7a1874d-b460-4ef0-898f-a4396e80adc4', 'Software Engineering', 40, 10, 0, '{"5":2}', false),
  ('6809a156-f9fa-4c23-87a0-ca1ef38b73e6', 'b7a1874d-b460-4ef0-898f-a4396e80adc4', 'SQL Fundamentals', 80, 20, 0, '{"3":2,"5":2}', false);

insert into public.feriados (turma_id, data, descricao) values
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-09-07', 'Feriado - Independência do Brasil'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-10-12', 'Feriado - Nossa Sra. Aparecida'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-11-02', 'Feriado - Finados'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-11-20', 'Feriado - Consciência Negra');

insert into public.semanas_sem_aula (turma_id, inicio, fim, descricao) values
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-11-23', '2026-11-30', 'Avaliações Oficiais'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-12-09', '2026-12-15', 'Provas Substitutivas');

insert into public.eventos (turma_id, data, descricao) values
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-08-11', 'Prova PAI I (Noturno) — Database Design / Innovation Lab'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-09-19', 'Prazo limite para lançamento da nota AP I'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-09-29', 'Prova PAI II (Noturno) — Database Design / Innovation Lab'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-10-24', 'Prazo limite para lançamento da nota AP II'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-10-28', 'Prova PAI III (Noturno) — Database Design / Innovation Lab'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-11-23', 'Prazo limite para cancelamento/trancamento de matrícula'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-11-23', 'Início das Avaliações Oficiais (até 30/11)'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-12-07', 'Prazo limite para solicitar Prova Substitutiva'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-12-09', 'Início das Provas Substitutivas (até 15/12)'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '2026-12-18', 'Fechamento das Atas de Notas e Faltas');

-- ---------- Depois de criar SUA conta pelo app, rode isto para virar admin ----------
-- update public.profiles set is_admin = true, assinatura_status = 'ativa', assinatura_ate = '2030-01-01' where email = 'contkaio@gmail.com';

-- =====================================================================
-- Lembretes em segundo plano (Web Push). Bloco adicionado depois da
-- primeira versão do schema - rode SÓ este bloco no SQL Editor, não o
-- arquivo inteiro (o topo dele tem "drop table cascade" e apagaria o
-- histórico de presença que já existe em produção).
-- =====================================================================

-- ---------- Inscrições de push (uma linha por dispositivo/navegador) ----------
drop table if exists public.push_subscriptions cascade;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: proprio usuario" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Quem precisa ser lembrado hoje ----------
-- Dia letivo com aula, ainda não respondido, com acesso liberado (admin ou
-- trial/ativa em dia). "Hoje" é calculado em America/Sao_Paulo, não em UTC,
-- pra não disparar no dia local errado perto da meia-noite UTC.
-- É o mesmo cálculo de isFeriado/isSemanaSemAulaRegular/disciplinasDoDia/
-- isDiaLetivoComAula em app.js, restrito ao dia de hoje.
create or replace function public.users_pending_today()
returns table(user_id uuid)
language sql
security definer set search_path = public
stable
as $$
  with hoje as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      extract(dow from (now() at time zone 'America/Sao_Paulo')::date)::text as dow
  )
  select p.id
  from public.profiles p
  join public.turmas t on t.id = p.turma_id
  cross join hoje h
  where (p.is_admin or (p.assinatura_status in ('trial', 'ativa') and p.assinatura_ate >= h.data))
    and h.data >= t.data_inicio_registro
    and not exists (select 1 from public.feriados f where f.turma_id = t.id and f.data = h.data)
    and not exists (select 1 from public.semanas_sem_aula s where s.turma_id = t.id and h.data between s.inicio and s.fim)
    and exists (select 1 from public.disciplinas d where d.turma_id = t.id and d.dias ? h.dow)
    and not exists (select 1 from public.dias_respondidos dr where dr.user_id = p.id and dr.data = h.data);
$$;

revoke all on function public.users_pending_today() from public, anon, authenticated;
grant execute on function public.users_pending_today() to service_role;

-- =====================================================================
-- Grade horária (horário exato, sala e professor de cada aula). Só pra
-- exibição na tela "Calendário → Grade" - não afeta o cálculo de faltas,
-- que continua usando só disciplinas.dias.
-- =====================================================================

drop table if exists public.horarios cascade;

create table public.horarios (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  disciplina_id uuid not null references public.disciplinas(id) on delete cascade,
  dia_semana int not null,             -- 0=Dom..6=Sáb, igual a disciplinas.dias
  hora_inicio text not null,           -- "19:00"
  hora_fim text not null,              -- "20:40"
  sala text not null,
  professor text not null
);

alter table public.horarios enable row level security;

create policy "horarios: leitura autenticada" on public.horarios for select to authenticated using (true);

-- Seed: grade da turma ADS 2B NOITE 2026/2
insert into public.horarios (turma_id, disciplina_id, dia_semana, hora_inicio, hora_fim, sala, professor) values
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '1a1e8fe2-e86f-4eaa-84c9-df6e1276c0bb', 1, '19:00', '20:40', 'Lab 201 Paraíso', 'Leonardo Bontempo'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '6cb52351-f9c9-42a7-aaad-750f94bdb4f4', 1, '21:00', '22:40', 'Sala 01 Paraíso', 'Alan Andrade dos Santos'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', 'e2b31113-53b5-4ba3-95de-0cee452dc2b6', 3, '19:00', '20:40', 'Lab 202 Paraíso', 'Gilberto Alves Pereira'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '6809a156-f9fa-4c23-87a0-ca1ef38b73e6', 3, '21:00', '22:40', 'Sala 101 Paraíso', 'Gustavo Bianchi Maia'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', 'e2b31113-53b5-4ba3-95de-0cee452dc2b6', 4, '19:00', '20:40', 'Sala 01 Paraíso', 'Gilberto Alves Pereira'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '6cb52351-f9c9-42a7-aaad-750f94bdb4f4', 4, '21:00', '22:40', 'Sala 01 Paraíso', 'Alan Andrade dos Santos'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '6809a156-f9fa-4c23-87a0-ca1ef38b73e6', 5, '19:00', '20:40', 'Lab 202 Paraíso', 'Gustavo Bianchi Maia'),
  ('b7a1874d-b460-4ef0-898f-a4396e80adc4', '09aca68d-6f47-47ab-9e3e-2436761252ca', 5, '21:00', '22:40', 'Sala 104 Paraíso', 'Fabio Nogueira de Campos');
