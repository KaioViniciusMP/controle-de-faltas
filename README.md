# Minha Frequência — ADS 2B NOITE

App para acompanhar presença na faculdade: pergunta dia a dia se você foi às aulas, calcula quantas faltas ainda restam por matéria (e por dia da semana), mostra o calendário de feriados/provas do semestre e manda lembretes. Funciona como PWA instalável no celular. Também tem contas de usuário e um painel de gestão de assinantes, pensado para eventualmente ser usado por outros alunos da turma mediante mensalidade.

## Funcionalidades

- **Hoje** — a cada dia de aula não respondido, pergunta quais matérias você faltou (ou confirma presença completa). Pula sozinho feriados e semanas de prova.
- **Faltas** — duas visões:
  - *Por matéria*: faltas usadas / permitidas, com barra de progresso e alerta perto do limite.
  - *Por dia da semana*: quantas vezes ainda dá pra faltar aquele dia inteiro sem estourar o limite de nenhuma matéria (mostra qual matéria é o "gargalo").
- **Calendário** — feriados, provas (PAI I/II/III), prazos, em lista, em grade de mês (com o dia atual destacado) ou na visão "Grade" com o horário, sala e professor de cada aula da semana.
- **Gestão** *(só para admins)* — lista de usuários cadastrados, status da assinatura (trial/ativa/inadimplente/cancelada), validade, e resumo de receita estimada. Cobrança é manual (combinada fora do app) — não há integração de pagamento ainda.
- **Ajustes** — dados da conta, ativar lembretes, corrigir faltas iniciais, editar/apagar histórico, sair.

## Stack

- **Frontend**: HTML/CSS/JS puro, sem framework nem build step (ES Modules nativos do navegador).
- **Backend**: [Supabase](https://supabase.com) (Postgres + Auth), acessado direto do navegador via `supabase-js` (carregado do CDN `esm.sh`, sem instalação local).
- **PWA**: `manifest.json` + service worker (`sw.js`) para instalação no celular, cache offline (estratégia rede-primeiro) e notificações locais/badge.

Não há servidor próprio: tudo roda estático (`serve.js` é só um servidor local pra desenvolvimento) e os dados ficam no Supabase.

## Estrutura de arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Ponto de entrada, carrega `app.js` como módulo |
| `app.js` | Toda a lógica da interface: telas, cálculo de faltas, autenticação, gestão |
| `style.css` | Estilos (mobile-first, paleta navy/laranja) |
| `data-layer.js` | Funções que conversam com o Supabase (auth, perfil, turma, respostas, gestão) |
| `supabaseClient.js` | Cria o cliente do `supabase-js` a partir de `config.js` |
| `config.js` | URL/chave do projeto Supabase + configs comerciais (preço, contato) — **não commitar com dados sensíveis de produção sem necessidade** |
| `supabase-schema.sql` | Script único que cria todas as tabelas, políticas de segurança (RLS) e os dados iniciais da turma |
| `manifest.json` | Metadados do PWA (ícone, nome, cores) |
| `sw.js` | Service worker: cache offline e notificações (inclui recebimento de Web Push) |
| `serve.js` | Servidor HTTP local simples (`node serve.js`), sem dependências |
| `icons/` | Ícones do PWA (192px e 512px) |
| `data.js` | **Legado, não é mais usado** pelo app (a grade/calendário migraram para o Supabase). Mantido só de referência. |
| `supabase/functions/lembrete-diario/index.ts` | Edge Function (Deno) agendada por cron: dispara o lembrete diário (Web Push) para quem ainda não confirmou presença |

## Como rodar localmente

```powershell
node serve.js
```

Abra `http://localhost:8080` no navegador. Não abra o `index.html` direto como arquivo (`file://`) — o service worker e o Supabase precisam de `http://` ou `https://`.

Sempre que mudar algo em `app.js`/`style.css`, um F5 normal já basta (o service worker busca a versão mais nova primeiro). Se parecer que ficou preso numa versão antiga, abra o DevTools → Application → Service Workers → Unregister, e recarregue.

## Configurar o Supabase (do zero)

1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. Em **Project Settings → API**, copie a "Project URL" e a chave "anon public" e cole em `config.js`.
3. Em **SQL Editor → New query**, cole o conteúdo de `supabase-schema.sql` e rode. Isso cria as tabelas, as regras de segurança e já popula a turma ADS 2B NOITE 2026/2 com a grade horária e o calendário.
4. Em **Authentication → Sign In / Providers → User Signups**, desative "Confirm email" se quiser cadastro sem etapa de confirmação por e-mail (opcional — o app funciona dos dois jeitos).
5. Crie sua conta pela própria tela de login do app.
6. Volte no SQL Editor e rode a última linha do `supabase-schema.sql` (comentada, já com seu e-mail) para virar admin:
   ```sql
   update public.profiles set is_admin = true, assinatura_status = 'ativa', assinatura_ate = '2030-01-01' where email = 'seu@email.com';
   ```
7. Recarregue o app — a aba "Gestão" aparece só para quem é admin.

## Configurar lembretes em segundo plano (Web Push)

O app usa Web Push (VAPID) pra avisar o usuário nos dias de aula que ele ainda não confirmou presença, mesmo com o navegador fechado. É grátis (usa o serviço de push do próprio navegador — Chrome, Firefox, Safari — sem servidor de push próprio nem conta paga). A chave pública já vem em `config.js`; os passos abaixo são os que faltam, feitos direto no painel do Supabase (sem precisar de CLI):

1. No **SQL Editor**, cole e rode só o bloco de SQL sob o comentário "Lembretes em segundo plano (Web Push)" no final de `supabase-schema.sql` — **não** rode o arquivo inteiro, ele tem `drop table cascade` no topo e apagaria o histórico de presença que já existe.
2. Em **Edge Functions → Manage secrets**, cadastre:
   - `VAPID_PUBLIC_KEY` — mesmo valor que está em `config.js`.
   - `VAPID_PRIVATE_KEY` — a chave privada gerada junto (nunca vai pro repositório).
   - `VAPID_SUBJECT` — `mailto:` + um e-mail de contato seu.
3. Em **Edge Functions → Deploy a new function**, cole o conteúdo de `supabase/functions/lembrete-diario/index.ts` (nome da função: `lembrete-diario`).
4. Em **Cron Jobs** (ou **Integrations → Cron**, o nome varia por versão do painel), crie um agendamento apontando pra função `lembrete-diario`. O banco do Supabase roda em UTC, e o Brasil não tem mais horário de verão (`America/Sao_Paulo` = UTC-3 fixo) — some 3 horas ao horário local desejado pra montar o cron (ex.: 22h local = `0 1 * * *` em UTC, já no dia seguinte).
5. Teste: abra o app, clique em "Ativar lembretes" em Ajustes, depois use o botão de invocar/testar a função no painel — a notificação deve aparecer mesmo com o app fechado.

Se `npm:web-push` não rodar no runtime da Edge Function (não foi testado ao vivo), a alternativa é implementar a assinatura VAPID e a criptografia do payload manualmente com `crypto.subtle` — mais código, mas sem dependência externa.

## Modelo de dados

- `turmas` — uma turma/curso (nome, período, a partir de que data o app passa a perguntar presença).
- `disciplinas` — matérias de uma turma: carga horária, faltas permitidas, faltas "de base" (antes de existir o app), e em quais dias da semana tem aula e quanto cada ausência conta (`dias` é um JSON tipo `{"1": 2, "4": 2}`, onde a chave é o dia da semana — 0=domingo — e o valor é quantas faltas custa perder aquele dia).
- `feriados`, `semanas_sem_aula`, `eventos` — calendário da turma (dias sem aula e datas importantes).
- `horarios` — horário exato, sala e professor de cada aula (dia da semana, início/fim). É só pra exibição na tela "Calendário → Grade"; não entra no cálculo de faltas, que continua baseado só em `disciplinas.dias`.
- `profiles` — um por usuário: turma, se é admin, status/validade da assinatura, correções manuais de faltas iniciais. Criado automaticamente (trigger) quando alguém se cadastra, com 7 dias de trial.
- `dias_respondidos` / `respostas` — presença dia a dia de cada usuário (a existência de um registro em `dias_respondidos` indica "esse dia já foi respondido"; `respostas` guarda só as matérias em que faltou).

Segurança (RLS): cada usuário só lê/edita os próprios dados de presença; admins conseguem ver e atualizar a assinatura de qualquer perfil, mas não os dados de presença de outros usuários.

## Regras de negócio que valem a pena lembrar

- **Faltas "por dia da semana"**: quando uma matéria tem aula em mais de um dia (ex.: Database Design em segunda e quinta), não dá pra saber com certeza em qual dos dias uma falta antiga (de antes do app existir) aconteceu. Por isso, o "já faltou X vez(es) nesse dia" só é exato para matérias que têm aula em um único dia da semana; nos outros casos, conta só o que foi respondido dentro do próprio app.
- **Acesso liberado**: admins sempre têm acesso; os demais precisam estar com `assinatura_status` em `trial` ou `ativa` **e** `assinatura_ate` maior ou igual a hoje.
- **Notificações em segundo plano**: usam Web Push (VAPID) — funcionam com o navegador/PWA fechado em Chrome, Firefox e Edge, e em Safari a partir do iOS 16.4 quando o PWA foi instalado na tela inicial (não funciona numa aba comum do Safari). O envio diário é feito por uma Edge Function do Supabase agendada por cron (ver "Configurar lembretes em segundo plano" acima) — não há servidor próprio dedicado a isso.

## Limitações conhecidas / próximos passos

- Cobrança de assinatura é manual (o admin muda o status na aba Gestão depois de combinar o pagamento fora do app). Integração com Stripe/PIX automático ainda não existe.
- Só a turma ADS 2B NOITE está cadastrada. Não existe tela de auto-cadastro de grade/calendário para outras turmas — para atender outras turmas, o cadastro ainda precisa ser feito direto no banco (inserindo uma nova `turma` + `disciplinas` no Supabase).
- `data.js` ficou como código morto depois da migração para Supabase; pode ser removido quando quiser.
