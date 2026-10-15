// Áreas futuras da app, ainda em desenvolvimento. Só páginas de apresentação:
// nada aqui guarda, lê ou altera dados. O estado «Em desenvolvimento» é exclusivo
// destas áreas e não se aplica ao progresso pedagógico dos pioneiros.
import { CalendarDays, FileText, Package, UserCog, Wallet } from 'lucide-react';

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
    description: 'Atividades, reuniões e prazos da secção num só calendário, com o que falta tratar para cada atividade.',
    features: [
      'Atividades, reuniões e prazos.',
      'Confirmação de presença.',
      'Alertas antes de cada atividade e de cada prazo.',
      'Pendências por atividade: autorização, pagamento, inscrição ou material necessário.',
      'Cada pessoa recebe apenas os alertas que lhe dizem respeito.',
    ],
  },
  {
    key: 'inventario', to: '/inventario', name: 'Inventário', short: 'Inventário', icon: Package,
    description: 'O material da sede, onde está, em que estado se encontra e quem o tem emprestado.',
    features: [
      'Material com quantidade, localização e estado.',
      'Empréstimos e devoluções.',
      'Necessidades de reparação ou reposição.',
    ],
  },
  {
    key: 'tesouraria', to: '/tesouraria', name: 'Tesouraria', short: 'Tesouraria', icon: Wallet,
    description: 'As contas da secção e das atividades, com consulta aberta e registo reservado a quem tem essa responsabilidade.',
    features: [
      'Receitas, despesas e saldo.',
      'Quotas.',
      'Contas de cada atividade.',
    ],
    access: [
      'Só dirigentes e tesoureiros autorizados criam, editam ou removem movimentos; os restantes apenas consultam.',
      'Dados pessoais, situações individuais de pagamento e comprovativos têm acesso restrito.',
      'As permissões são verificadas no servidor, e não apenas escondendo botões.',
    ],
  },
  {
    key: 'equipas', to: '/equipas-e-cargos', name: 'Equipas e cargos', short: 'Cargos', icon: UserCog,
    description: 'Quem faz parte de cada equipa e que cargos e responsabilidades tem, ano após ano.',
    features: [
      'Membros de cada equipa.',
      'Guia, subguia e restantes cargos, com as respetivas responsabilidades.',
      'Histórico por ano escutista.',
      'Datas de início e de fim de cada cargo.',
    ],
    access: ['Um cargo de equipa não dá, por si só, permissões de administração da aplicação.'],
  },
  {
    key: 'secretaria', to: '/secretaria', name: 'Secretaria', short: 'Secretaria', icon: FileText,
    description: 'As atas das reuniões, desde o rascunho até à versão final aprovada.',
    features: [
      'Ata por reunião, com data e participantes.',
      'Decisões, tarefas, responsáveis e prazos.',
      'Rascunho, aprovação e versão final.',
    ],
    access: ['O acesso a cada ata depende do tipo de reunião e do papel de cada pessoa.'],
  },
];

export const futureAreaByPath = new Map(FUTURE_AREAS.map((a) => [a.to, a]));
