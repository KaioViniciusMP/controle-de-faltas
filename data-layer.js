import { supabase } from './supabaseClient.js';

// ---------- Autenticação ----------
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
export async function cadastrar(email, senha) {
  const { data, error } = await supabase.auth.signUp({ email, password: senha });
  if (error) throw error;
  return data;
}
export async function entrar(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}
export async function sair() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ---------- Perfil ----------
export async function getPerfil(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}
export async function atualizarPerfil(userId, campos) {
  const { error } = await supabase.from('profiles').update(campos).eq('id', userId);
  if (error) throw error;
}

// ---------- Dados da turma (grade/calendário) ----------
export async function getDadosTurma(turmaId) {
  const [turma, disciplinas, feriados, semanas, eventos, horarios] = await Promise.all([
    supabase.from('turmas').select('*').eq('id', turmaId).single(),
    supabase.from('disciplinas').select('*').eq('turma_id', turmaId).order('nome'),
    supabase.from('feriados').select('*').eq('turma_id', turmaId).order('data'),
    supabase.from('semanas_sem_aula').select('*').eq('turma_id', turmaId).order('inicio'),
    supabase.from('eventos').select('*').eq('turma_id', turmaId).order('data'),
    supabase.from('horarios').select('*').eq('turma_id', turmaId).order('dia_semana').order('hora_inicio'),
  ]);
  for (const r of [turma, disciplinas, feriados, semanas, eventos, horarios]) {
    if (r.error) throw r.error;
  }
  return {
    turma: turma.data,
    disciplinas: disciplinas.data,
    feriados: feriados.data,
    semanas: semanas.data,
    eventos: eventos.data,
    horarios: horarios.data,
  };
}

// ---------- Presença ----------
export async function getRespostas(userId) {
  const [diasResp, respostas] = await Promise.all([
    supabase.from('dias_respondidos').select('data').eq('user_id', userId),
    supabase.from('respostas').select('data, disciplina_id').eq('user_id', userId),
  ]);
  if (diasResp.error) throw diasResp.error;
  if (respostas.error) throw respostas.error;

  // Reconstrói o mesmo formato usado antes no localStorage: { 'YYYY-MM-DD': { disciplinaId: true, ... } }
  const mapa = {};
  diasResp.data.forEach(({ data }) => { mapa[data] = {}; });
  respostas.data.forEach(({ data, disciplina_id }) => {
    if (!mapa[data]) mapa[data] = {};
    mapa[data][disciplina_id] = true;
  });
  return mapa;
}

export async function marcarPresenca(userId, data, disciplinaIdsFaltou) {
  const { error: e1 } = await supabase.from('respostas').delete().eq('user_id', userId).eq('data', data);
  if (e1) throw e1;

  if (disciplinaIdsFaltou.length > 0) {
    const linhas = disciplinaIdsFaltou.map((disciplina_id) => ({ user_id: userId, data, disciplina_id }));
    const { error: e2 } = await supabase.from('respostas').insert(linhas);
    if (e2) throw e2;
  }

  const { error: e3 } = await supabase.from('dias_respondidos').upsert({ user_id: userId, data });
  if (e3) throw e3;
}

export async function removerResposta(userId, data) {
  const { error: e1 } = await supabase.from('respostas').delete().eq('user_id', userId).eq('data', data);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('dias_respondidos').delete().eq('user_id', userId).eq('data', data);
  if (e2) throw e2;
}

export async function apagarHistoricoCompleto(userId) {
  const { error: e1 } = await supabase.from('respostas').delete().eq('user_id', userId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('dias_respondidos').delete().eq('user_id', userId);
  if (e2) throw e2;
}

// ---------- Push ----------
export async function salvarInscricaoPush(userId, sub) {
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function removerInscricaoPush(endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

// ---------- Gestão (admin) ----------
export async function adminListarPerfis() {
  const { data, error } = await supabase.from('profiles').select('*').order('criado_em', { ascending: false });
  if (error) throw error;
  return data;
}
export async function adminAtualizarAssinatura(userId, status, ate) {
  const { error } = await supabase.from('profiles').update({ assinatura_status: status, assinatura_ate: ate }).eq('id', userId);
  if (error) throw error;
}
