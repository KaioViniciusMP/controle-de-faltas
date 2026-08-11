// Edge Function agendada por cron (ver README - "Configurar lembretes em segundo plano").
// Busca quem ainda não confirmou presença hoje (users_pending_today, no schema.sql)
// e envia um Web Push (VAPID) pra cada dispositivo inscrito de cada um.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:kaio.pereira@ndevs.com.br';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: pendentes, error } = await supabase.rpc('users_pending_today');
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });
  if (!pendentes?.length) return new Response(JSON.stringify({ enviados: 0 }), { status: 200 });

  const userIds = pendentes.map((p: { user_id: string }) => p.user_id);
  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds);
  if (subsErr) return new Response(JSON.stringify({ error: subsErr }), { status: 500 });

  const payload = JSON.stringify({
    title: 'Marque sua presença de hoje',
    body: 'Você ainda não confirmou se teve aula/faltou hoje. Abra o app para registrar.',
    url: './index.html',
    tag: 'faltas-pendentes',
  });

  let enviados = 0;
  const idsParaRemover: string[] = [];

  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      enviados++;
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status;
      if (status === 404 || status === 410) idsParaRemover.push(s.id);
      else console.error('push falhou', s.endpoint, status, err?.message);
    }
  }));

  if (idsParaRemover.length) {
    await supabase.from('push_subscriptions').delete().in('id', idsParaRemover);
  }

  return new Response(JSON.stringify({ enviados, removidos: idsParaRemover.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
