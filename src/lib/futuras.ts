// Áreas futuras da app, ainda em desenvolvimento. Só páginas de apresentação:
// nada aqui guarda, lê ou altera dados. O estado «Em desenvolvimento» é exclusivo
// destas áreas e não se aplica ao progresso pedagógico dos pioneiros.
import { CalendarDays, ClipboardCheck, FileText, Package, UserCog, Wallet } from 'lucide-react';

export type FutureArea = {
  key: string;
  to: string;
  name: string;
  short: string;
  icon: typeof CalendarDays;
  description: string;
  features: string[];
  access?: string[];
};

export const FUTURE_AREAS: FutureArea[] = [
  {
    key: 'calendario', to: '/calendario', name: 'Calendário escutista', short: 'Calendário', icon: CalendarDays,
    description: 'O ano inteiro numa só vista, com fins de semana, feriados e atividades, para planear sem percorrer listas.',
    features: [
      'Calendário anual e por ano escutista, com fins de semana e feriados assinalados.',
      'Atividades marcadas diretamente nas datas, de um ou vários dias.',
      'Alertas antes de cada atividade.',
      'Lista curta das próximas atividades.',
    ],
  },
  {
    key: 'presencas', to: '/presencas', name: 'Presenças', short: 'Presenças', icon: ClipboardCheck,
    description: 'A assiduidade de cada pessoa nas reuniões e atividades, para acompanhamento e sem rankings.',
    features: [
      'Quadro com membros e reuniões ou atividades.',
      'Presente, falta justificada, falta injustificada ou por registar.',
      'Taxa de assiduidade com a fórmula visível.',
      'Resumo por equipa e por período.',
    ],
    access: ['Só dirigentes e responsáveis autorizados registam ou corrigem presenças; as justificações são reservadas.'],
  },
  {
    key: 'inventario', to: '/inventario', name: 'Inventário', short: 'Inventário', icon: Package,
    description: 'O material da sede, onde está guardado, em que estado se encontra, quem o tem emprestado e o que falta comprar.',
    features: [
      'Material com tipo, quantidade, estado e local exato.',
      'Empréstimos e devoluções, totais ou parciais.',
      'Lista «A comprar», ligada à Tesouraria sem duplicações.',
    ],
  },
  {
    key: 'tesouraria', to: '/tesouraria', name: 'Tesouraria', short: 'Tesouraria', icon: Wallet,
    description: 'As contas da secção num painel claro, com consulta aberta e registo reservado a quem tem essa responsabilidade.',
    features: [
      'Saldo atual, receitas e despesas do período.',
      'Evolução do saldo e últimos movimentos.',
      'Resultado de cada atividade.',
    ],
    access: [
      'Só dirigentes e tesoureiros autorizados alteram dados; os restantes apenas consultam.',
      'Dados pessoais e comprovativos têm acesso restrito.',
      'As permissões são verificadas no servidor, e não apenas escondendo botões.',
    ],
  },
  {
    key: 'equipas', to: '/equipas-e-cargos', name: 'Equipas e cargos', short: 'Cargos', icon: UserCog,
    description: 'Quem faz parte de cada equipa e que cargos e responsabilidades tem, ano após ano.',
    features: [
      'Ficha de cada equipa, com membros e cargos.',
      'Guia, subguia e restantes cargos, com as respetivas responsabilidades.',
      'Histórico por ano escutista.',
    ],
    access: ['Um cargo de equipa não dá, por si só, permissões de administração da aplicação.'],
  },
  {
    key: 'secretaria', to: '/atas-e-tarefas', name: 'Atas e tarefas', short: 'Atas', icon: FileText,
    description: 'As atas das reuniões e atividades do calendário, com as tarefas que ficaram combinadas.',
    features: [
      'Ata ligada a um evento do calendário, com histórico de alterações.',
      'Tarefas com responsável, prazo e estado.',
      '«As minhas tarefas» para cada pessoa.',
    ],
    access: ['Cada ata é vista por quem pode ver o evento; as atas reservadas ficam só para os dirigentes.'],
  },
];

export const futureAreaByPath = new Map(FUTURE_AREAS.map((a) => [a.to, a]));
