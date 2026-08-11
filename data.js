// Dados do 2º semestre 2026 - ADS 2B NOITE - Faculdade Impacta
// Extraídos do boletim (Notas e Faltas) e do Calendário Letivo 2026/2.
// Ajuste aqui se algo mudar (grade horária, feriados, faltas manuais).

// Dias da semana no padrão JS: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb

export const CURSO = 'Curso Superior de Tecnologia em Análise e Desenvolvimento de Sistemas';
export const TURMA = 'ADS 2B NOITE';
export const PERIODO = '2026/2';

// Data a partir da qual o app passa a perguntar sobre presença.
// As "faltasBase" abaixo já refletem tudo que aconteceu até o dia anterior a esta data
// (conferido com o boletim, impresso em 11/08/2026).
export const DATA_INICIO_REGISTRO = '2026-08-11';

// Cada matéria: em quais dias da semana tem aula e quantas faltas conta se perder aquele dia inteiro.
export const DISCIPLINAS = [
  {
    id: 'db',
    nome: 'Database Design',
    ch: 80,
    permitidas: 20,
    faltasBase: 2,
    dias: { 1: 2, 4: 2 }, // Segunda e Quinta
    pai: true,
  },
  {
    id: 'inov',
    nome: 'Innovation Lab: Advanced No/Low Code',
    ch: 40,
    permitidas: 10,
    faltasBase: 2,
    dias: { 1: 2 }, // Segunda
    pai: true,
  },
  {
    id: 'prog',
    nome: 'Programming & Algorithms',
    ch: 80,
    permitidas: 20,
    faltasBase: 0,
    dias: { 3: 2, 4: 2 }, // Quarta e Quinta
    pai: false,
  },
  {
    id: 'se',
    nome: 'Software Engineering',
    ch: 40,
    permitidas: 10,
    faltasBase: 0,
    dias: { 5: 2 }, // Sexta
    pai: false,
  },
  {
    id: 'sql',
    nome: 'SQL Fundamentals',
    ch: 80,
    permitidas: 20,
    faltasBase: 0,
    dias: { 3: 2, 5: 2 }, // Quarta e Sexta
    pai: false,
  },
];

// Feriados/recessos que caem em dia de aula (Seg/Qua/Qui/Sex) - o app não pergunta nesses dias.
export const FERIADOS = [
  { data: '2026-09-07', desc: 'Feriado - Independência do Brasil' },
  { data: '2026-10-12', desc: 'Feriado - Nossa Sra. Aparecida' },
  { data: '2026-11-02', desc: 'Feriado - Finados' },
  { data: '2026-11-20', desc: 'Feriado - Consciência Negra' },
];

// Semanas em que não há aula regular (período de provas oficiais/substitutivas) - o app não pergunta nessas semanas.
export const SEMANAS_SEM_AULA_REGULAR = [
  { inicio: '2026-11-23', fim: '2026-11-30', desc: 'Avaliações Oficiais' },
  { inicio: '2026-12-09', fim: '2026-12-15', desc: 'Provas Substitutivas' },
];

// Eventos importantes só para exibir como lembrete (não afetam o cálculo de faltas).
export const EVENTOS = [
  { data: '2026-08-11', desc: 'Prova PAI I (Noturno) — Database Design / Innovation Lab' },
  { data: '2026-09-19', desc: 'Prazo limite para lançamento da nota AP I' },
  { data: '2026-09-29', desc: 'Prova PAI II (Noturno) — Database Design / Innovation Lab' },
  { data: '2026-10-24', desc: 'Prazo limite para lançamento da nota AP II' },
  { data: '2026-10-28', desc: 'Prova PAI III (Noturno) — Database Design / Innovation Lab' },
  { data: '2026-11-23', desc: 'Prazo limite para cancelamento/trancamento de matrícula' },
  { data: '2026-11-23', desc: 'Início das Avaliações Oficiais (até 30/11)' },
  { data: '2026-12-07', desc: 'Prazo limite para solicitar Prova Substitutiva' },
  { data: '2026-12-09', desc: 'Início das Provas Substitutivas (até 15/12)' },
  { data: '2026-12-18', desc: 'Fechamento das Atas de Notas e Faltas' },
];

export const NOMES_DIA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
