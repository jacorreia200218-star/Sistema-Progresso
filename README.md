# Pioneiros

Aplicação web para acompanhar o **progresso pessoal dos Pioneiros (III Secção) do CNE** numa secção de um
agrupamento: escolha e negociação de trilhos, pedidos de validação com reflexão e vivências, registo das
decisões da reunião de Equipa, do Conselho de Guias e da Equipa de Animação, progresso anterior e anilha
de mérito.

> Ferramenta de acompanhamento **local**. Não substitui os registos oficiais do CNE nem o SIIE.
> O manual fornecido (`docs/fonte/`) é a referência desta implementação; isso não confirma que seja a
> edição atualmente em vigor.

- **Interface:** React + TypeScript + Vite (pensada primeiro para telemóvel).
- **Servidor:** Supabase (PostgreSQL, Auth, Storage) com RLS em todas as tabelas e regras em funções SQL.
- **Alojamento:** Vercel.

## Índice

1. [Estrutura do projeto](#1-estrutura-do-projeto)
2. [Antes de começar](#2-antes-de-começar)
3. [Criar e preparar o Supabase](#3-criar-e-preparar-o-supabase)
4. [Configurar os emails de autenticação](#4-configurar-os-emails-de-autenticação)
5. [Correr no teu computador](#5-correr-no-teu-computador)
6. [Criar o primeiro administrador](#6-criar-o-primeiro-administrador-de-forma-segura)
7. [Publicar na Vercel](#7-publicar-na-vercel)
8. [Demonstração vs. produção](#8-demonstração-vs-produção)
9. [Testes](#9-testes)
10. [Lista de verificação antes de usar dados reais](#10-lista-de-verificação-antes-de-usar-dados-reais)
11. [Como funciona (resumo)](#11-como-funciona-resumo)

## 1. Estrutura do projeto

```
catalog/                    Catálogo da III Secção extraído do manual (JSON), relatório e verificação
docs/fonte/                 Manual do Dirigente (PDF fonte)
docs/BACKUP.md              Exportação, cópias de segurança e restauro
docs/DECISOES.md            Decisões, regras locais e questões em aberto (ex.: membros sem email)
docs/CAMINHO.md             Regras pedagógicas do Caminho, estados e permissões
supabase/atualizacoes/      SQL para atualizar um projeto já instalado (colar no SQL Editor)
scripts/verify-catalog.mjs  Verifica o catálogo contra o PDF (posição de cada objetivo nas colunas)
scripts/generate-catalog-sql.mjs  Gera a migração SQL do catálogo a partir do JSON
supabase/migrations/        Esquema, permissões (RLS), funções, armazenamento, catálogo
supabase/bootstrap/         Criação segura da secção e do primeiro administrador
supabase/demo/              Preparação de um projeto de DEMONSTRAÇÃO (nunca em produção)
src/                        Interface (React)
tests/db/                   Testes do servidor: percurso completo, acessos indevidos, concorrência
tests/e2e/                  Testes de interface em telemóvel e computador (API simulada)
```

## 2. Antes de começar

Precisas de:

- Uma conta em [supabase.com](https://supabase.com) e outra em [vercel.com](https://vercel.com) (podes entrar com o GitHub).
- [Node.js](https://nodejs.org) 20 ou mais recente.
- O repositório no GitHub (a Vercel publica a partir dele).
- Opcional, mas recomendado: a [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase …` funciona sem instalar).

## 3. Criar e preparar o Supabase

1. Em supabase.com cria um **projeto novo** (ex.: `pioneiros-producao`), região **Europe (Frankfurt ou Paris)**.
   Guarda a palavra-passe da base de dados num local seguro.
2. Aplica as migrações (escolhe **uma** das formas):

   **a) Com a CLI (recomendado)**
   ```bash
   npm install
   npx supabase login
   npx supabase init            # só cria supabase/config.toml se ainda não existir
   npx supabase link --project-ref <ref-do-projeto>
   npx supabase db push         # aplica supabase/migrations/*.sql por ordem
   ```

   **b) Sem CLI (mais simples para começar):** no painel, abre **SQL Editor › New query**, cola o conteúdo
   de `supabase/instalar_tudo.sql` (todas as migrações num só ficheiro) e carrega em **Run**. Faz isto
   **uma única vez**, num projeto novo. (O ficheiro regenera-se com `npm run db:bundle`.)

3. Confirma em **Storage** que existem os buckets `fotografias` e `anexos`, ambos **privados**.
4. Em **Authentication › Sign In / Providers › Email**: mantém **Confirm email** ativo. Em
   **Authentication › Policies/Password**: palavra-passe mínima de 8 caracteres e, se o teu plano permitir,
   ativa a proteção contra palavras-passe divulgadas.
5. Em **Authentication › URL Configuration**:
   - **Site URL:** o endereço público da app (ex.: `https://pioneiros-xyz.vercel.app`).
   - **Redirect URLs:** acrescenta `https://pioneiros-xyz.vercel.app/**` e, para desenvolvimento, `http://localhost:5173/**`.
6. Em **Project Settings › API Keys** (ou botão **Connect**) copia:
   - o **Project URL** → `VITE_SUPABASE_URL`;
   - a **Publishable key** (`sb_publishable_…`) → `VITE_SUPABASE_PUBLISHABLE_KEY`.

   ⚠️ **Nunca** uses na app a *secret key* (`sb_secret_…`) nem a *service_role*: tudo o que começa por
   `VITE_` fica visível no browser. A app não precisa de chaves secretas.

## 4. Configurar os emails de autenticação

São necessários para confirmar contas e recuperar a palavra-passe.

1. **SMTP próprio (obrigatório em produção).** O serviço de email incluído no Supabase é só para testes:
   envia apenas para endereços autorizados da organização e tem um limite muito baixo por hora. Em
   **Authentication › Emails › SMTP Settings** configura um fornecedor (ex.: Brevo, Resend, Amazon SES,
   Postmark) com um remetente do teu domínio (ex.: `pioneiros@agrupamento.pt`). Depois ajusta o limite em
   **Authentication › Rate Limits**.
2. **Modelos em português.** Em **Authentication › Emails › Templates**, traduz pelo menos:
   - *Confirm signup* — assunto: «Confirma a tua conta Pioneiros»;
   - *Reset password* — assunto: «Recuperar o acesso aos Pioneiros».
   Mantém a variável `{{ .ConfirmationURL }}` no link.
3. Testa: cria uma conta, confirma o email, sai, e usa «Esqueci-me da palavra-passe».

Membros sem email próprio: ver `docs/DECISOES.md` (decisão da associação; não foi criada alternativa).

## 5. Correr no teu computador

```bash
cp .env.example .env.local     # e preenche os dois valores do passo 3.6
npm install
npm run dev                    # abre http://localhost:5173
```

## 6. Criar o primeiro administrador (de forma segura)

Ninguém pode escolher funções no registo; por isso o primeiro administrador é criado por quem tem acesso
ao painel do Supabase:

1. Na app, **cria a tua conta** e confirma o email.
2. No Supabase, abre **SQL Editor**, cola `supabase/bootstrap/primeiro_admin.sql`, substitui o nome do
   agrupamento, o nome da secção e o teu email, e executa.
3. Volta à app e entra: aparecem **Gestão** (administração técnica) e **Revisões** (dirigente).
4. Em **Gestão › Equipas** cria as equipas; em **Gestão › Convites** cria um convite (com validade e limite
   de usos) e partilha o link. Cada pessoa cria a sua conta, abre o link e fica **pendente** até aprovares
   em **Gestão › Membros**, onde atribuis a função e a equipa.
5. Para dar administração técnica a outra pessoa (sem ser dirigente, ou além disso), usa **Gestão › Membros**.
   A administração técnica não dá acesso ao progresso pedagógico.

## 7. Publicar na Vercel

1. Em vercel.com: **Add New › Project** e importa o repositório do GitHub.
2. Framework: **Vite** (o `vercel.json` já define build `npm run build` e pasta `dist`).
3. Em **Environment Variables** acrescenta `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`
   (e, no projeto de demonstração, `VITE_ENVIRONMENT_LABEL=Demonstração`).
4. **Deploy.** Copia o endereço final e atualiza **Site URL** e **Redirect URLs** no Supabase (passo 3.5).
5. O `vercel.json` encaminha todas as rotas para a app e define cabeçalhos de segurança e `noindex`.

### 7.1 Notificações push (telemóvel e computador)

1. Aplica a migração `20261020000100_notificacoes_push.sql` (num projeto já instalado:
   `supabase/atualizacoes/2026-10-20_notificacoes_push.sql` no SQL Editor). Se a extensão `pg_net` não
   ficar ativa, ativa-a em **Database › Extensions**.
2. Na Vercel, acrescenta a variável `SUPABASE_SECRET_KEY` com a chave secreta do Supabase
   (**Project Settings › API Keys › Secret keys**; serve também a antiga `service_role`) e volta a publicar.
3. As chaves VAPID são criadas automaticamente na primeira utilização e guardadas em `private.push_config`.
   Por omissão o aviso vai para `https://sistema-progresso.vercel.app/api/push`; noutro projeto (por exemplo, a
   demonstração) muda o endereço com `update private.push_config set endpoint = 'https://<app>/api/push';`.
4. Cada pessoa ativa em **Perfil › Notificações no telemóvel**. No iPhone (iOS 16.4 ou mais recente) a app tem de
   estar adicionada ao ecrã principal e ser aberta a partir do ícone.

## 8. Demonstração vs. produção

- Usa **dois projetos Supabase** e **dois projetos Vercel**: `pioneiros-demo` e `pioneiros-producao`.
- Em produção **não** há utilizadores nem progresso fictícios: nenhuma migração cria pessoas.
- Na demonstração, cria contas de teste pela app e corre `supabase/demo/demo_setup.sql` (recusa-se a correr
  num projeto que já tenha secções reais). Define `VITE_ENVIRONMENT_LABEL=Demonstração` para o rótulo aparecer.
- Não publiques a produção com dados reais antes de completares a secção 10.

## 9. Testes

| Comando | O que verifica |
|---|---|
| `npm run catalog:verify` | O catálogo confere com o PDF (requer `pdftotext`, do pacote *poppler-utils*). |
| `npm test` | Lógica de apresentação (estados dos trilhos, etapa, próxima ação, mensagens de erro). |
| `npm run test:db` | Servidor real em PostgreSQL local: registo e convites, entrada pendente, escolhas e trocas, submissão, devolução e nova versão, validação na Equipa, Conselho de Guias, opinião final, mérito, progresso anterior (incluindo desligar com formulário aberto), acessos indevidos, autoaprovação, escalada de função, antigo guia, pedidos duplicados, decisões concorrentes e ficheiros. |
| `npm run test:e2e` | Interface em telemóvel e computador (Chromium), com API simulada: navegação, estados com texto, falhas de rede sem falsas confirmações, formulários de decisão. |
| `npm run typecheck` / `npm run build` | Tipos e build de produção. |

`npm run test:db` precisa de um PostgreSQL 15+ local sem palavra-passe para o utilizador `postgres`
(por omissão em `localhost:54329`; altera com `PGTEST_URL`, `PGTEST_BASE` e `PGTEST_DB_URL`). Os ficheiros
`tests/db/supabase-stubs.sql` simulam apenas o que o Supabase fornece (papéis, `auth.uid()`, storage) e
**nunca** devem ser aplicados num projeto Supabase.

Para reconstruir a migração do catálogo depois de alterar o JSON: `npm run catalog:sql` (e cria uma
**nova** migração/versão em vez de alterar uma já aplicada — ver relatório do catálogo, secção 7).

## 10. Lista de verificação antes de usar dados reais

- [ ] Questões pedagógicas pendentes de `docs/DECISOES.md` e do relatório do catálogo revistas pela Equipa de Animação.
- [ ] Decisão sobre membros sem email próprio.
- [ ] SMTP próprio configurado e modelos de email em português testados (confirmação e recuperação).
- [ ] Site URL e Redirect URLs com o endereço de produção.
- [ ] Buckets `fotografias` e `anexos` privados.
- [ ] Primeiro administrador criado; convites de teste revogados.
- [ ] Teste manual com 3 contas reais (dirigente, guia, pioneiro) no projeto de demonstração.
- [ ] Primeira cópia de segurança feita e restauro ensaiado (`docs/BACKUP.md`).
- [ ] Informação aos encarregados de educação sobre os dados guardados (RGPD).

## 11. Como funciona (resumo)

- **Papéis:** *pioneiro* (o próprio percurso), *guia* (também pioneiro; acompanha só a sua equipa atual e
  regista as decisões da reunião de Equipa, nunca sobre os próprios pedidos), *dirigente* (Equipa de
  Animação: secção, negociação, Conselho de Guias, opinião final, progresso anterior, mérito) e
  *administração* (permissão técnica separada: membros, equipas, convites, configurações).
- **Etapas:** Desprendimento (adesão), Conhecimento, Vontade, Construção. Cada etapa: um trilho de cada uma
  das seis áreas, escolhido e negociado (não fixado à partida). A insígnia regista-se no início da etapa.
- **Pedido de trilho:** rascunho → submetido → (em revisão) → validado na equipa / devolvido (com
  comentário, nova versão). Alterar depois de submeter exige retirar (nova versão); o histórico mantém-se.
- **Etapa:** pedido separado quando os seis trilhos escolhidos estão validados → decisão do Conselho de Guias
  → opinião final da Equipa de Animação (fundamentação obrigatória se divergir). Só então fica concluída.
- **Progresso anterior** (`historical_progress_enabled`, ativo por omissão): pedidos vão diretos aos
  dirigentes; só contam depois de aprovados; a data aproximada fica separada da data da decisão.
  Desligar bloqueia novas submissões no servidor, sem afetar pedidos já submetidos nem aprovações.
- **Anilha de mérito:** elegibilidade calculada (18 trilhos + Construção concluída) mostrada à parte da
  atribuição registada por um dirigente, com data.
- **Caminho da secção** (`/caminho`): um mapa com o trilho desenhado e os marcos do manual ao longo dele, com as pessoas (avatares iguais,
  por ordem alfabética) no marco onde estão; «+N» abre a lista completa; pesquisa por nome e filtro por equipa
  ficam no endereço. Tocar numa pessoa abre um painel (lateral no computador, folha no telemóvel) com equipa,
  etapa atual, as seis áreas FACEIS e o próximo passo. Sem rankings nem arrastar: a posição resulta do progresso
  validado. Regras em `docs/CAMINHO.md`.
- **Início:** cartões-resumo por papel (dirigente: Pioneiros, Equipas, Pedidos pendentes, Etapas por validar;
  pioneiro: Etapa atual, Trilhos em desenvolvimento, Pedidos em validação, Trilhos validados), cada um com ligação
  para a vista já filtrada; distribuição por marcos; três entradas de atividade e «Ver atividade».
- **Histórico reconhecido vs. etapa atual:** a etapa só conta os trilhos confirmados para ela na negociação
  (regra do servidor); trilhos já validados ou reconhecidos e ainda não associados aparecem à parte.
- **Convites:** código curto (ex.: `AB7K-9M2P`, 8 caracteres sem O/0/I/1/L), aceite com ou sem hífen, espaços ou
  minúsculas, por ligação curta (`/c#AB7K-9M2P`) ou em «Tenho um convite». Antes de confirmar mostra a secção/equipa
  de destino. Na gestão: copiar código, copiar ligação, QR, validade, limite de utilizações, revogar e gerar novo.
  Gerado no servidor, único, com limite de tentativas (8 falhas em 15 min) contra adivinhação. Nunca dá funções;
  os convites antigos continuam válidos.
- **Vista por equipa** (Caminho › Por equipa): pessoas por ordem alfabética, agrupadas por equipa, com a etapa e o
  estado das seis áreas; com uma área escolhida agrupa as pessoas pelo trilho dessa área. Sem rankings.
- **Página do membro** em separadores: Resumo, Etapa (escolhas, negociação, trilhos reconhecidos por associar),
  Trilhos e Histórico (adesão, Promessa, etapas, pedidos, mérito). Data do acontecimento separada da data do registo;
  Promessa antes da decisão sobre a adesão ou registo retroativo exigem fundamentação.
- **Datas** sempre em DD/MM/AAAA (`formatDate` em `src/lib/labels.ts`; datas sem hora não mudam com o fuso).
- **Meu progresso** (`/meu-progresso`): três vistas ligadas — *Caminho* (posição, checklist das seis áreas
  com «por concluir / submetido / precisa de revisão / validado», validação da etapa e reconhecimento),
  *Áreas FACEIS* (seis cartões, filtros por estado que ficam no endereço) e *Pedidos* (estado, datas de
  validação e feedback dos devolvidos com ação). Cada trilho tem página própria com explicação, objetivos,
  palavras-chave, oportunidades escolhidas, vivências e o pedido de validação feito ali mesmo (área e trilho
  já definidos, rascunho, confirmação; o servidor impede pedidos duplicados). Submeter não conclui o trilho.
  Um dirigente sem percurso próprio consulta um pioneiro autorizado através de um seletor em «modo de
  consulta», sem ações do pioneiro. Capturas em `docs/capturas/` (`CAPTURAS=1 npx playwright test capturas`).
- **Trilhos** (`/trilhos`): resumo em árvore — áreas FACEIS → trilhos → objetivos e palavras-chave —, com
  pesquisa sem acentos, abrir/fechar tudo, o estado de cada trilho para quem tem percurso e, no fim, exemplos
  de oportunidades educativas do manual.
- **Entrada na secção:** cada pessoa cria a conta com o seu nome e, no pedido de entrada, indica a equipa. A
  administração confirma ou corrige a equipa, atribui a função e pode depois alterar nome, totem, equipa e
  função (fica no registo). Os trilhos escolhem-se primeiro pela área e depois dentro dela.
- **Símbolo:** a Rosa dos Ventos usada no cabeçalho, entrada, favicon e ícones da aplicação é o vetor
  original do Manual do Dirigente (p. 41), copiado sem alterações para `src/assets/rosa-dos-ventos.svg`.
- **Temas** Claro / Escuro / Sistema (Perfil › Aparência, ou o botão na barra superior).
- **Notificações** dentro da aplicação para pedidos e decisões.
- Detalhes de segurança e decisões em `docs/DECISOES.md`; catálogo em `catalog/RELATORIO_IMPORTACAO.md`.
