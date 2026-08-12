import { configurado } from './supabaseClient.js';
import {
  onAuthChange, cadastrar, entrar, sair,
  getPerfil, atualizarPerfil,
  getDadosTurma,
  getRespostas, marcarPresenca, removerResposta, apagarHistoricoCompleto,
  salvarInscricaoPush,
  adminListarPerfis, adminAtualizarAssinatura,
} from './data-layer.js';
import { PRECO_MENSAL, CONTATO_ASSINATURA, VAPID_PUBLIC_KEY } from './config.js';

// ---------- Utilidades de data (sempre horário local, formato YYYY-MM-DD) ----------
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function todayStr() {
  return toISODate(new Date());
}
function addDays(dateStr, n) {
  const d = parseISODate(dateStr);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function fmtBR(dateStr) {
  const d = parseISODate(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function weekday(dateStr) {
  return parseISODate(dateStr).getDay();
}

const NOMES_DIA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const LS_NOTIF = 'faltas.notifEnabled';

// ---------- Estado da aplicação ----------
const app = document.getElementById('app');
let statusApp = 'carregando'; // sem-config | carregando | login | bloqueado | erro | app
let sessao = null;
let perfil = null;
let turma = null;
let disciplinas = [];
let feriados = [];
let semanas = [];
let eventos = [];
let horarios = [];
let respostas = {};
let gestaoDados = null;

let abaAtual = 'hoje';
let faltasModo = 'materia';
let calModo = 'lista';
let calMes = null;
let calSelecionado = null;
let authModo = 'entrar';
let authErro = '';
let authCarregando = false;

// ---------- Regras de calendário / faltas ----------
function faltasBaseDe(disc) {
  const override = (perfil && perfil.faltas_base_override) || {};
  return Object.prototype.hasOwnProperty.call(override, disc.id) ? override[disc.id] : disc.faltas_base;
}
function faltasAtuais(disc) {
  let total = faltasBaseDe(disc);
  for (const [data, marcado] of Object.entries(respostas)) {
    if (marcado && marcado[disc.id]) {
      const valor = disc.dias[String(weekday(data))];
      if (valor) total += valor;
    }
  }
  return total;
}
function isFeriado(dateStr) {
  return feriados.some(f => f.data === dateStr);
}
function isSemanaSemAulaRegular(dateStr) {
  return semanas.some(s => dateStr >= s.inicio && dateStr <= s.fim);
}
function disciplinasDoDia(dateStr) {
  const wd = String(weekday(dateStr));
  return disciplinas.filter(d => Object.prototype.hasOwnProperty.call(d.dias, wd));
}
function isDiaLetivoComAula(dateStr) {
  if (isFeriado(dateStr)) return false;
  if (isSemanaSemAulaRegular(dateStr)) return false;
  return disciplinasDoDia(dateStr).length > 0;
}
function diasPendentes() {
  if (!turma) return [];
  const pendentes = [];
  let d = turma.data_inicio_registro;
  const hoje = todayStr();
  while (d <= hoje) {
    if (isDiaLetivoComAula(d) && !Object.prototype.hasOwnProperty.call(respostas, d)) pendentes.push(d);
    d = addDays(d, 1);
  }
  return pendentes;
}
function acessoLiberado() {
  if (!perfil) return false;
  if (perfil.is_admin) return true;
  if (!['trial', 'ativa'].includes(perfil.assinatura_status)) return false;
  return perfil.assinatura_ate >= todayStr();
}

async function salvarCheckin(data, disciplinaIdsFaltou) {
  await marcarPresenca(sessao.user.id, data, disciplinaIdsFaltou);
  const registro = {};
  disciplinaIdsFaltou.forEach(id => { registro[id] = true; });
  respostas[data] = registro;
}

// ---------- Notificações ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
async function inscreverPush(reg) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await salvarInscricaoPush(sessao.user.id, sub.toJSON());
}
async function ativarNotificacoes() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Este navegador não suporta notificações push.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    alert('Permissão de notificação não concedida.');
    render();
    return;
  }
  localStorage.setItem(LS_NOTIF, 'true');
  try {
    const reg = await navigator.serviceWorker.ready;
    await inscreverPush(reg);
    reg.showNotification('Lembretes ativados', {
      body: 'Você vai receber um aviso nos dias de aula que ainda não confirmou presença, mesmo com o app fechado.',
      icon: 'icons/icon-192.png',
    });
  } catch (e) {
    console.error(e);
    alert('Não foi possível ativar o lembrete em segundo plano neste navegador.');
  }
  atualizarBadge();
  render();
}
async function atualizarBadge() {
  if (statusApp !== 'app') return;
  const n = diasPendentes().length;
  if ('setAppBadge' in navigator) {
    try {
      if (n > 0) await navigator.setAppBadge(n);
      else await navigator.clearAppBadge();
    } catch {}
  }
}
function notificarSeNecessario() {
  if (statusApp !== 'app') return;
  if (localStorage.getItem(LS_NOTIF) !== 'true') return;
  if (Notification.permission !== 'granted') return;
  const n = diasPendentes().length;
  if (n === 0) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification('Faltas pendentes', {
      body: n === 1 ? 'Você tem 1 dia para confirmar presença.' : `Você tem ${n} dias para confirmar presença.`,
      icon: 'icons/icon-192.png',
      tag: 'faltas-pendentes',
    });
  });
}

// ---------- Fluxo de autenticação / carregamento ----------
function iniciar() {
  if (!configurado) { statusApp = 'sem-config'; render(); return; }
  onAuthChange(async (session) => {
    sessao = session;
    if (!session) {
      perfil = null; turma = null; disciplinas = []; feriados = []; semanas = []; eventos = []; respostas = {};
      statusApp = 'login';
      render();
      return;
    }
    await carregarTudo();
    setTimeout(notificarSeNecessario, 1500);
    if (localStorage.getItem(LS_NOTIF) === 'true' && Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then(inscreverPush).catch(() => {});
    }
  });
}

async function carregarTudo() {
  statusApp = 'carregando';
  render();
  try {
    perfil = await getPerfil(sessao.user.id);
    const dados = await getDadosTurma(perfil.turma_id);
    turma = dados.turma;
    disciplinas = dados.disciplinas;
    feriados = dados.feriados;
    semanas = dados.semanas;
    eventos = dados.eventos;
    horarios = dados.horarios;
    respostas = await getRespostas(sessao.user.id);
    statusApp = acessoLiberado() ? 'app' : 'bloqueado';
  } catch (e) {
    console.error(e);
    statusApp = 'erro';
  }
  render();
}

async function carregarGestao() {
  abaAtual = 'gestao';
  gestaoDados = null;
  render();
  try {
    gestaoDados = await adminListarPerfis();
  } catch (e) {
    console.error(e);
    gestaoDados = [];
  }
  render();
}

// ---------- Render: telas fora do app principal ----------
function renderSemConfig() {
  return `
    <main style="padding:1.5rem">
      <div class="card perigo">
        <h2>Configuração pendente</h2>
        <p>Preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> em <code>config.js</code> com os dados do seu projeto Supabase, e rode o script <code>supabase-schema.sql</code> no SQL Editor do projeto.</p>
      </div>
    </main>
  `;
}
function renderCarregando() {
  return '<main style="padding:1.5rem"><p>Carregando...</p></main>';
}
function renderErro() {
  return `
    <main style="padding:1.5rem">
      <div class="card perigo">
        <h2>Não foi possível carregar seus dados</h2>
        <p class="ajuda">Confira sua conexão e tente novamente.</p>
        <button id="btn-tentar-de-novo" class="botao">Tentar de novo</button>
      </div>
    </main>
  `;
}
function renderLogin() {
  return `
    <div class="tela-auth">
      <div class="tela-auth-topo">
        <div class="logo-auth">🎓</div>
        <h1>Minha Frequência</h1>
        <p class="subtitulo">ADS 2B NOITE · 2026/2</p>
      </div>
      <div class="card-auth">
        <div class="auth-toggle">
          <button type="button" data-authmodo="entrar" class="${authModo === 'entrar' ? 'active' : ''}">Entrar</button>
          <button type="button" data-authmodo="cadastrar" class="${authModo === 'cadastrar' ? 'active' : ''}">Criar conta</button>
        </div>
        <p class="auth-lead">${authModo === 'entrar' ? 'Que bom te ver de novo.' : 'Leva menos de um minuto.'}</p>
        <form id="form-auth">
          <label class="campo">
            <span>E-mail</span>
            <input type="email" name="email" placeholder="voce@exemplo.com" required autocomplete="email">
          </label>
          <label class="campo">
            <span>Senha</span>
            <input type="password" name="senha" placeholder="••••••••" required minlength="6" autocomplete="${authModo === 'entrar' ? 'current-password' : 'new-password'}">
          </label>
          ${authErro ? `<p class="auth-erro">${authErro}</p>` : ''}
          <div class="acoes">
            <button type="submit" class="botao" ${authCarregando ? 'disabled' : ''}>${authCarregando ? 'Aguarde...' : (authModo === 'entrar' ? 'Entrar' : 'Criar conta')}</button>
          </div>
        </form>
      </div>
      <p class="auth-rodape">Faculdade Impacta</p>
    </div>
  `;
}
function renderBloqueado() {
  const venceu = perfil.assinatura_ate < todayStr();
  return `
    <header class="topo">
      <h1>Minha Frequência</h1>
      <p class="subtitulo">${turma ? turma.nome : ''}</p>
    </header>
    <main>
      <div class="card perigo">
        <h2>${venceu ? 'Assinatura expirada' : 'Acesso indisponível'}</h2>
        <p>${venceu ? `Seu acesso venceu em ${fmtBR(perfil.assinatura_ate)}.` : `Sua assinatura está marcada como "${perfil.assinatura_status}".`}</p>
        <p class="ajuda">${CONTATO_ASSINATURA}</p>
        <button id="btn-sair-bloqueado" class="botao secundario">Sair</button>
      </div>
    </main>
  `;
}

// ---------- Render principal ----------
function render() {
  if (statusApp === 'app') atualizarBadge();

  if (statusApp === 'sem-config') { app.innerHTML = renderSemConfig(); return; }
  if (statusApp === 'carregando') { app.innerHTML = renderCarregando(); return; }
  if (statusApp === 'erro') {
    app.innerHTML = renderErro();
    document.getElementById('btn-tentar-de-novo').addEventListener('click', carregarTudo);
    return;
  }
  if (statusApp === 'login') {
    app.innerHTML = renderLogin();
    ligarEventosLogin();
    return;
  }
  if (statusApp === 'bloqueado') {
    app.innerHTML = renderBloqueado();
    document.getElementById('btn-sair-bloqueado').addEventListener('click', () => sair());
    return;
  }

  const abasHtml = `
    <nav class="tabs">
      <button data-tab="hoje" class="${abaAtual === 'hoje' ? 'active' : ''}">Hoje</button>
      <button data-tab="faltas" class="${abaAtual === 'faltas' ? 'active' : ''}">Faltas</button>
      <button data-tab="calendario" class="${abaAtual === 'calendario' ? 'active' : ''}">Calendário</button>
      ${perfil.is_admin ? `<button data-tab="gestao" class="${abaAtual === 'gestao' ? 'active' : ''}">Gestão</button>` : ''}
      <button data-tab="ajustes" class="${abaAtual === 'ajustes' ? 'active' : ''}">Ajustes</button>
    </nav>`;

  let conteudo = '';
  if (abaAtual === 'hoje') conteudo = renderHoje();
  else if (abaAtual === 'faltas') conteudo = renderFaltas();
  else if (abaAtual === 'calendario') conteudo = renderCalendario();
  else if (abaAtual === 'gestao' && perfil.is_admin) conteudo = renderGestao();
  else if (abaAtual === 'ajustes') conteudo = renderAjustes();

  app.innerHTML = `
    <header class="topo">
      <h1>Minha Frequência</h1>
      <p class="subtitulo">${turma.nome} · ${turma.periodo}</p>
    </header>
    ${abasHtml}
    <main>${conteudo}</main>
  `;

  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'gestao') { carregarGestao(); return; }
      abaAtual = btn.dataset.tab;
      render();
    });
  });

  ligarEventosDaAba();
}

function renderHoje() {
  const pendentes = diasPendentes();
  if (pendentes.length === 0) {
    const hoje = todayStr();
    const eventoHoje = eventos.find(e => e.data === hoje);
    return `
      <div class="card ok">
        <p>Tudo em dia! Nenhuma pendência de presença.</p>
      </div>
      ${eventoHoje ? `<div class="card evento"><strong>Hoje:</strong> ${eventoHoje.descricao}</div>` : ''}
      <button id="btn-notif" class="botao">${localStorage.getItem(LS_NOTIF) === 'true' ? 'Lembretes ativados ✓' : 'Ativar lembretes'}</button>
    `;
  }

  const data = pendentes[0];
  const wd = weekday(data);
  const discs = disciplinasDoDia(data);
  const restantes = pendentes.length - 1;

  return `
    <div class="card pendente">
      <p class="pendente-titulo">${NOMES_DIA_SEMANA[wd]}, ${fmtBR(data)}</p>
      <p class="pendente-sub">Marque as matérias em que você <strong>faltou</strong> nesse dia (deixe em branco se foi normalmente):</p>
      <form id="form-checkin">
        ${discs.map(d => `
          <label class="checkbox-linha">
            <input type="checkbox" name="falta" value="${d.id}">
            <span>${d.nome}</span>
          </label>
        `).join('')}
        <div class="acoes">
          <button type="submit" class="botao">Confirmar</button>
        </div>
      </form>
      ${restantes > 0 ? `<p class="aviso-restantes">+ ${restantes} dia(s) pendente(s) depois deste</p>` : ''}
    </div>
  `;
}

function renderFaltas() {
  return `
    <div class="cal-toggle">
      <button data-faltasmodo="materia" class="${faltasModo === 'materia' ? 'active' : ''}">Por matéria</button>
      <button data-faltasmodo="dia" class="${faltasModo === 'dia' ? 'active' : ''}">Por dia da semana</button>
    </div>
    ${faltasModo === 'dia' ? renderFaltasPorDia() : renderFaltasPorMateria()}
  `;
}

function renderFaltasPorMateria() {
  const linhas = disciplinas.map(d => {
    const atuais = faltasAtuais(d);
    const pct = Math.min(100, Math.round((atuais / d.permitidas) * 100));
    let status = 'status-ok';
    if (atuais >= d.permitidas) status = 'status-critico';
    else if (pct >= 70) status = 'status-atencao';
    const restam = Math.max(0, d.permitidas - atuais);
    return `
      <div class="disciplina-card ${status}">
        <div class="disciplina-cabecalho">
          <span class="disciplina-nome">${d.nome}${d.pai ? ' <span class="badge-pai">PAI</span>' : ''}</span>
          <span class="disciplina-numeros">${atuais} / ${d.permitidas}</span>
        </div>
        <div class="barra"><div class="barra-preenchida" style="width:${pct}%"></div></div>
        <p class="disciplina-detalhe">${atuais >= d.permitidas ? 'Limite de faltas atingido' : `${restam} falta(s) restante(s)`} · CH ${d.ch}h</p>
      </div>
    `;
  }).join('');
  return `<div class="lista-disciplinas">${linhas}</div>`;
}

// Para cada dia da semana que tem aula, calcula quantas vezes ainda dá pra faltar
// o dia inteiro sem estourar o limite de nenhuma matéria daquele dia (o "gargalo").
function renderFaltasPorDia() {
  const diasComAula = [...new Set(disciplinas.flatMap(d => Object.keys(d.dias).map(Number)))]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // ordena Seg..Dom

  const cartoes = diasComAula.map(wd => {
    const discsDoDia = disciplinas.filter(d => Object.prototype.hasOwnProperty.call(d.dias, String(wd)));
    const porDisciplina = discsDoDia.map(d => {
      const valor = d.dias[String(wd)];
      const restanteFaltas = Math.max(0, d.permitidas - faltasAtuais(d));
      return { nome: d.nome, valor, restanteFaltas, skipsRestantes: Math.floor(restanteFaltas / valor) };
    });
    const limite = Math.min(...porDisciplina.map(p => p.skipsRestantes));
    const limitantes = porDisciplina.filter(p => p.skipsRestantes === limite);

    // "Já faltou": matérias que só têm aula NESSE dia da semana dão a contagem exata
    // (toda falta acumulada nelas só pode ter vindo desse dia, incluindo faltas de antes
    // do app existir). Matérias que também têm aula em outro dia são ambíguas (não dá pra
    // saber em qual dos dias a falta aconteceu), então nesse caso conta só o que foi
    // respondido pelo próprio app.
    const discsUnicoDia = discsDoDia.filter(d => Object.keys(d.dias).length === 1);
    const jaFaltou = discsUnicoDia.length > 0
      ? Math.max(...discsUnicoDia.map(d => Math.floor(faltasAtuais(d) / d.dias[String(wd)])))
      : Object.entries(respostas).filter(([data, marcado]) => weekday(data) === wd && discsDoDia.some(d => marcado && marcado[d.id])).length;

    let status = 'status-ok';
    if (limite <= 0) status = 'status-critico';
    else if (limite <= 2) status = 'status-atencao';

    return `
      <div class="disciplina-card ${status}">
        <div class="disciplina-cabecalho">
          <span class="disciplina-nome">${NOMES_DIA_SEMANA[wd]}</span>
          <span class="disciplina-numeros">${limite <= 0 ? 'esgotado' : `${limite} falta(s) restante(s)`}</span>
        </div>
        <p class="disciplina-detalhe">Limitado por: ${limitantes.map(p => `${p.nome} (${p.restanteFaltas} falta(s) ÷ ${p.valor}/dia)`).join(', ')}</p>
        <p class="disciplina-detalhe muted">Matérias nesse dia: ${discsDoDia.map(d => d.nome).join(', ')} · já faltou ${jaFaltou} vez(es) nesse dia</p>
      </div>
    `;
  }).join('');

  return `<div class="lista-disciplinas">${cartoes}</div>`;
}

function renderCalendario() {
  return `
    <div class="cal-toggle">
      <button data-calmodo="lista" class="${calModo === 'lista' ? 'active' : ''}">Lista</button>
      <button data-calmodo="mes" class="${calModo === 'mes' ? 'active' : ''}">Mês</button>
      <button data-calmodo="grade" class="${calModo === 'grade' ? 'active' : ''}">Grade</button>
    </div>
    ${calModo === 'mes' ? renderCalendarioMes() : calModo === 'grade' ? renderGradeHoraria() : renderCalendarioLista()}
  `;
}

const PALETA_DISCIPLINAS = ['#8b5fbf', '#2e9e5b', '#d97a3b', '#e0629b', '#3b7dd9', '#d9a520'];
function corPorDisciplina() {
  const mapa = {};
  disciplinas.forEach((d, i) => { mapa[d.id] = PALETA_DISCIPLINAS[i % PALETA_DISCIPLINAS.length]; });
  return mapa;
}
function renderGradeHoraria() {
  if (horarios.length === 0) {
    return '<div class="card"><p>Grade horária ainda não cadastrada para sua turma.</p></div>';
  }
  const cores = corPorDisciplina();
  const porDia = {};
  for (const h of horarios) {
    (porDia[h.dia_semana] = porDia[h.dia_semana] || []).push(h);
  }
  const diasOrdenados = Object.keys(porDia).map(Number).sort((a, b) => a - b);
  return diasOrdenados.map(dia => `
    <div class="grade-dia">
      <h3>${NOMES_DIA_SEMANA[dia]}</h3>
      ${porDia[dia].map(h => {
        const disc = disciplinas.find(d => d.id === h.disciplina_id);
        return `
          <div class="grade-bloco">
            <div class="grade-bloco-topo">
              <span class="grade-cor" style="background:${cores[h.disciplina_id] || 'var(--navy)'}"></span>
              <span class="grade-nome">${disc ? disc.nome : '—'}</span>
              <span class="grade-horario">${h.hora_inicio}–${h.hora_fim}</span>
            </div>
            <p class="grade-detalhe">${h.professor} · ${h.sala}</p>
          </div>
        `;
      }).join('')}
    </div>
  `).join('');
}

function renderCalendarioLista() {
  const hoje = todayStr();
  const proximos = [
    ...feriados.map(f => ({ data: f.data, descricao: f.descricao, tipo: 'feriado' })),
    ...eventos.map(e => ({ data: e.data, descricao: e.descricao, tipo: 'evento' })),
  ]
    .filter(e => e.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data));

  if (proximos.length === 0) {
    return '<div class="card"><p>Sem mais eventos cadastrados neste semestre.</p></div>';
  }

  return `<div class="lista-eventos">${proximos.map(e => `
    <div class="evento-linha ${e.tipo}${e.data === hoje ? ' hoje' : ''}">
      <span class="evento-data">${fmtBR(e.data)}${e.data === hoje ? '<span class="badge-hoje">HOJE</span>' : ''}</span>
      <span class="evento-desc">${e.descricao}</span>
    </div>
  `).join('')}</div>`;
}

function irMesAnterior() {
  calMes.m -= 1;
  if (calMes.m < 0) { calMes.m = 11; calMes.y -= 1; }
  render();
}
function irMesSeguinte() {
  calMes.m += 1;
  if (calMes.m > 11) { calMes.m = 0; calMes.y += 1; }
  render();
}

function renderCalendarioMes() {
  if (!calMes) {
    const h = new Date();
    calMes = { y: h.getFullYear(), m: h.getMonth() };
  }
  const { y, m } = calMes;
  const offsetSemana = new Date(y, m, 1).getDay();
  const diasNoMes = new Date(y, m + 1, 0).getDate();
  const hoje = todayStr();

  const celulas = [];
  for (let i = 0; i < offsetSemana; i++) celulas.push('<div class="cal-cel vazio"></div>');
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dateStr = toISODate(new Date(y, m, dia));
    const feriado = feriados.find(f => f.data === dateStr);
    const temEvento = eventos.some(e => e.data === dateStr);
    const semanaSemAula = isSemanaSemAulaRegular(dateStr);
    const temAula = disciplinasDoDia(dateStr).length > 0;
    const respondida = Object.prototype.hasOwnProperty.call(respostas, dateStr);
    const pendente = turma && dateStr >= turma.data_inicio_registro && dateStr <= hoje && isDiaLetivoComAula(dateStr) && !respondida;

    const confirmado = respondida && temAula;

    let classes = 'cal-cel';
    if (feriado) classes += ' cal-feriado';
    else if (semanaSemAula) classes += ' cal-semana-sem-aula';
    else if (pendente) classes += ' cal-pendente';
    else if (confirmado) classes += ' cal-confirmado';
    else if (temAula) classes += ' cal-tem-aula';
    if (temEvento) classes += ' cal-evento-marca';
    if (dateStr === hoje) classes += ' cal-hoje';
    if (dateStr === calSelecionado) classes += ' cal-selecionada';

    celulas.push(`
      <button type="button" class="${classes}" data-data="${dateStr}">
        <span class="cal-dia-num">${dia}</span>
      </button>
    `);
  }
  while (celulas.length % 7 !== 0) celulas.push('<div class="cal-cel vazio"></div>');

  return `
    <div class="cal-nav">
      <button type="button" id="cal-mes-anterior" class="botao-icone" aria-label="Mês anterior">‹</button>
      <span class="cal-mes-label">${NOMES_MES[m]} ${y}</span>
      <button type="button" id="cal-mes-seguinte" class="botao-icone" aria-label="Mês seguinte">›</button>
    </div>
    <div id="cal-mes-wrapper">
      <div class="cal-grid-cabecalho">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${celulas.join('')}</div>
    </div>
    <div class="cal-legenda">
      <span><i class="marcador marcador-feriado"></i>Feriado</span>
      <span><i class="marcador marcador-evento"></i>Prova/Prazo</span>
      <span><i class="marcador marcador-pendente"></i>Pendente</span>
      <span><i class="marcador marcador-ok"></i>Confirmado</span>
    </div>
    ${calSelecionado ? renderDetalheDia(calSelecionado) : '<p class="cal-dica">Toque em um dia para ver detalhes. Arraste pros lados pra trocar de mês.</p>'}
  `;
}

function renderDetalheDia(dateStr) {
  const wd = weekday(dateStr);
  const feriado = feriados.find(f => f.data === dateStr);
  const eventosDoDia = eventos.filter(e => e.data === dateStr);
  const semanaSemAula = semanas.find(s => dateStr >= s.inicio && dateStr <= s.fim);
  const discs = disciplinasDoDia(dateStr);
  const respondida = Object.prototype.hasOwnProperty.call(respostas, dateStr);
  const hoje = todayStr();
  const podeResponder = discs.length > 0 && !feriado && !semanaSemAula && turma && dateStr >= turma.data_inicio_registro && dateStr <= hoje;

  let corpo = `<p class="detalhe-titulo">${NOMES_DIA_SEMANA[wd]}, ${fmtBR(dateStr)}</p>`;
  if (feriado) corpo += `<p class="detalhe-linha feriado">${feriado.descricao}</p>`;
  if (semanaSemAula) corpo += `<p class="detalhe-linha muted">${semanaSemAula.descricao} — sem aula regular</p>`;
  eventosDoDia.forEach(e => { corpo += `<p class="detalhe-linha evento">${e.descricao}</p>`; });

  if (discs.length === 0 && !feriado && !semanaSemAula && eventosDoDia.length === 0) {
    corpo += '<p class="detalhe-linha muted">Sem aula regular neste dia.</p>';
  }

  if (discs.length > 0 && !feriado && !semanaSemAula) {
    if (respondida) {
      const marcados = Object.keys(respostas[dateStr]).filter(id => respostas[dateStr][id]);
      const nomes = marcados.map(id => disciplinas.find(d => d.id === id)?.nome).filter(Boolean);
      corpo += `<p class="detalhe-linha">${nomes.length ? 'Faltou: ' + nomes.join(', ') : 'Presença completa'}</p>`;
      corpo += `<button type="button" class="botao-link" id="cal-editar-dia" data-data="${dateStr}">editar resposta</button>`;
    } else if (podeResponder) {
      corpo += `
        <form id="form-checkin-cal" data-data="${dateStr}">
          ${discs.map(d => `
            <label class="checkbox-linha">
              <input type="checkbox" name="falta" value="${d.id}">
              <span>${d.nome}</span>
            </label>
          `).join('')}
          <div class="acoes"><button type="submit" class="botao">Confirmar presença</button></div>
        </form>
      `;
    } else if (dateStr > hoje) {
      corpo += '<p class="detalhe-linha muted">Dia ainda não chegou.</p>';
    }
  }

  return `<div class="card cal-detalhe">${corpo}</div>`;
}

function renderGestao() {
  if (gestaoDados === null) return '<div class="card"><p>Carregando assinantes...</p></div>';

  const hoje = todayStr();
  const total = gestaoDados.length;
  const ativos = gestaoDados.filter(p => ['trial', 'ativa'].includes(p.assinatura_status) && p.assinatura_ate >= hoje).length;
  const receita = (ativos * PRECO_MENSAL).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return `
    <div class="card">
      <h2>Resumo</h2>
      <div class="gestao-resumo">
        <div><span class="gestao-numero">${total}</span><span class="gestao-label">usuários</span></div>
        <div><span class="gestao-numero">${ativos}</span><span class="gestao-label">com acesso liberado</span></div>
        <div><span class="gestao-numero">${receita}</span><span class="gestao-label">receita estimada/mês</span></div>
      </div>
      <p class="ajuda">Estimativa simples (usuários com acesso liberado × preço mensal). A cobrança ainda é manual — combine fora do app (PIX etc.) e depois atualize o status aqui.</p>
    </div>
    <div class="lista-eventos">
      ${gestaoDados.map(p => `
        <div class="gestao-linha">
          <div class="gestao-linha-topo">
            <span class="gestao-email">${p.email}${p.is_admin ? ' <span class="badge-pai">ADMIN</span>' : ''}</span>
            <span class="gestao-desde">desde ${fmtBR(p.criado_em.slice(0, 10))}</span>
          </div>
          <form class="gestao-form" data-userid="${p.id}">
            <select name="status">
              ${['trial', 'ativa', 'inadimplente', 'cancelada'].map(s => `<option value="${s}" ${p.assinatura_status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <input type="date" name="ate" value="${p.assinatura_ate}">
            <button type="submit" class="botao-link">salvar</button>
          </form>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAjustes() {
  const notifOn = localStorage.getItem(LS_NOTIF) === 'true';
  return `
    <div class="card">
      <h2>Conta</h2>
      <p class="ajuda">${sessao.user.email}</p>
      <p class="ajuda">Assinatura: <strong>${perfil.assinatura_status}</strong> · válida até ${fmtBR(perfil.assinatura_ate)}</p>
      <button id="btn-sair" class="botao secundario">Sair da conta</button>
    </div>
    <div class="card">
      <h2>Lembretes</h2>
      <button id="btn-notif" class="botao">${notifOn ? 'Lembretes ativados ✓' : 'Ativar lembretes'}</button>
      <p class="ajuda">Manda um aviso nos dias de aula que você ainda não confirmou presença, mesmo com o app fechado. No iPhone, precisa ter instalado o app na tela de início pelo Safari (compartilhar → Adicionar à Tela de Início) para funcionar em segundo plano.</p>
    </div>
    <div class="card">
      <h2>Corrigir faltas iniciais</h2>
      <p class="ajuda">Use somente se o número não bater com o boletim oficial da faculdade.</p>
      <form id="form-base">
        ${disciplinas.map(d => `
          <label class="linha-base">
            <span>${d.nome}</span>
            <input type="number" min="0" name="${d.id}" value="${faltasBaseDe(d)}">
          </label>
        `).join('')}
        <div class="acoes"><button type="submit" class="botao">Salvar</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Histórico</h2>
      <button id="btn-historico" class="botao secundario">Ver / editar respostas registradas</button>
    </div>
    <div class="card perigo">
      <h2>Zerar dados</h2>
      <button id="btn-reset" class="botao perigo">Apagar todo o histórico registrado</button>
    </div>
  `;
}

function renderHistorico() {
  const datas = Object.keys(respostas).sort().reverse();
  if (datas.length === 0) {
    app.querySelector('main').innerHTML = '<div class="card"><p>Nenhum dia registrado ainda.</p></div><button id="btn-voltar" class="botao secundario">Voltar</button>';
  } else {
    app.querySelector('main').innerHTML = `
      <div class="lista-eventos">
        ${datas.map(data => {
          const marcados = Object.keys(respostas[data]).filter(id => respostas[data][id]);
          const nomes = marcados.map(id => disciplinas.find(d => d.id === id)?.nome).filter(Boolean);
          return `
            <div class="evento-linha">
              <span class="evento-data">${fmtBR(data)}</span>
              <span class="evento-desc">${nomes.length ? 'Faltou: ' + nomes.join(', ') : 'Presença completa'}</span>
              <button class="botao-link" data-del="${data}">excluir registro</button>
            </div>`;
        }).join('')}
      </div>
      <button id="btn-voltar" class="botao secundario">Voltar</button>
    `;
  }
  document.getElementById('btn-voltar').addEventListener('click', render);
  document.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerResposta(sessao.user.id, btn.dataset.del);
      delete respostas[btn.dataset.del];
      renderHistorico();
    });
  });
}

function ligarEventosLogin() {
  document.querySelectorAll('[data-authmodo]').forEach(btn => {
    btn.addEventListener('click', () => { authModo = btn.dataset.authmodo; authErro = ''; render(); });
  });
  const form = document.getElementById('form-auth');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    authErro = '';
    authCarregando = true;
    render();
    const email = form.elements['email'].value.trim();
    const senha = form.elements['senha'].value;
    try {
      if (authModo === 'entrar') {
        await entrar(email, senha);
      } else {
        const resultado = await cadastrar(email, senha);
        if (!resultado.session) {
          authErro = 'Conta criada! Verifique seu e-mail para confirmar antes de entrar.';
        }
      }
    } catch (e) {
      authErro = e.message || 'Não foi possível completar. Tente de novo.';
    }
    authCarregando = false;
    render();
  });
}

function ligarEventosDaAba() {
  const btnSair = document.getElementById('btn-sair');
  if (btnSair) btnSair.addEventListener('click', () => sair());

  const btnNotif = document.getElementById('btn-notif');
  if (btnNotif) btnNotif.addEventListener('click', ativarNotificacoes);

  const formCheckin = document.getElementById('form-checkin');
  if (formCheckin) {
    formCheckin.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = diasPendentes()[0];
      const marcados = [...formCheckin.querySelectorAll('input[name="falta"]:checked')].map(i => i.value);
      await salvarCheckin(data, marcados);
      render();
    });
  }

  document.querySelectorAll('[data-faltasmodo]').forEach(btn => {
    btn.addEventListener('click', () => { faltasModo = btn.dataset.faltasmodo; render(); });
  });

  document.querySelectorAll('[data-calmodo]').forEach(btn => {
    btn.addEventListener('click', () => { calModo = btn.dataset.calmodo; render(); });
  });

  const calMesAnterior = document.getElementById('cal-mes-anterior');
  if (calMesAnterior) calMesAnterior.addEventListener('click', irMesAnterior);
  const calMesSeguinte = document.getElementById('cal-mes-seguinte');
  if (calMesSeguinte) calMesSeguinte.addEventListener('click', irMesSeguinte);

  const calMesWrapper = document.getElementById('cal-mes-wrapper');
  if (calMesWrapper) {
    let touchStartX = null;
    let touchStartY = null;
    calMesWrapper.addEventListener('touchstart', (ev) => {
      touchStartX = ev.touches[0].clientX;
      touchStartY = ev.touches[0].clientY;
    }, { passive: true });
    calMesWrapper.addEventListener('touchend', (ev) => {
      if (touchStartX === null) return;
      const deltaX = ev.changedTouches[0].clientX - touchStartX;
      const deltaY = ev.changedTouches[0].clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;
      if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY)) return;
      if (deltaX < 0) irMesSeguinte(); else irMesAnterior();
    }, { passive: true });
  }

  document.querySelectorAll('.cal-cel[data-data]').forEach(btn => {
    btn.addEventListener('click', () => {
      calSelecionado = calSelecionado === btn.dataset.data ? null : btn.dataset.data;
      render();
    });
  });

  const formCheckinCal = document.getElementById('form-checkin-cal');
  if (formCheckinCal) {
    formCheckinCal.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = formCheckinCal.dataset.data;
      const marcados = [...formCheckinCal.querySelectorAll('input[name="falta"]:checked')].map(i => i.value);
      await salvarCheckin(data, marcados);
      render();
    });
  }

  const calEditarDia = document.getElementById('cal-editar-dia');
  if (calEditarDia) {
    calEditarDia.addEventListener('click', async () => {
      await removerResposta(sessao.user.id, calEditarDia.dataset.data);
      delete respostas[calEditarDia.dataset.data];
      render();
    });
  }

  document.querySelectorAll('.gestao-form').forEach(f => {
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const userId = f.dataset.userid;
      const status = f.elements['status'].value;
      const ate = f.elements['ate'].value;
      await adminAtualizarAssinatura(userId, status, ate);
      await carregarGestao();
    });
  });

  const formBase = document.getElementById('form-base');
  if (formBase) {
    formBase.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const override = {};
      disciplinas.forEach(d => {
        const v = Number(formBase.elements[d.id].value);
        override[d.id] = Number.isFinite(v) ? v : d.faltas_base;
      });
      await atualizarPerfil(sessao.user.id, { faltas_base_override: override });
      perfil.faltas_base_override = override;
      alert('Faltas iniciais atualizadas.');
      render();
    });
  }

  const btnHistorico = document.getElementById('btn-historico');
  if (btnHistorico) btnHistorico.addEventListener('click', renderHistorico);

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      if (confirm('Isso vai apagar todo o histórico de presenças registradas na sua conta. Continuar?')) {
        await apagarHistoricoCompleto(sessao.user.id);
        respostas = {};
        render();
      }
    });
  }
}

// ---------- Inicialização ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

iniciar();
