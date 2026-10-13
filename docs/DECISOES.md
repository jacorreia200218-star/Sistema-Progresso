# Decisões de implementação e questões em aberto

## Questões pedagógicas a confirmar

| # | Questão | Situação atual |
|---|---|---|
| Q1 | C4 e C7 têm texto idêntico no manual (p. 43). | Importados como impressos e marcados **pendentes** na aplicação. Confirmar com fonte oficial; corrigir cria uma nova versão do catálogo. |
| Q2 | O enquadramento de «Solidariedade e tolerância» e «Interação e cooperação» é idêntico (p. 46). | Idem. |
| Q3 | Quem regista na aplicação a decisão sobre o pedido do próprio guia? | Regra local L1: um dirigente regista-a, em nome da reunião de Equipa. Alternativa possível: um subguia — não implementado. |
| Q4 | Um dirigente pode devolver um pedido de progresso anterior para correção (além de aprovar/recusar)? | Implementado (L4), porque o pedido prevê «correção de um pedido histórico devolvido». |

Ver também as regras locais L1–L5 em `catalog/RELATORIO_IMPORTACAO.md`.

## Membros sem email próprio (por decidir antes de criar alternativa)

Cada pessoa precisa de uma conta individual com email para entrar e recuperar o acesso. Alguns
pioneiros podem não ter email próprio. **Não foi criada nenhuma alternativa** (ex.: contas partilhadas,
login por código ou contas geridas pelos pais), porque cada opção tem implicações de privacidade e
consentimento que a associação deve decidir:

- **Email de um encarregado de educação** como conta do pioneiro: simples; o encarregado tem acesso ao progresso.
- **Email criado para o jovem** (ex.: conta de estudante): mantém a conta individual.
- **Contas sem email geridas pela administração** (exigiria criação com chave de servidor e reposição
  de palavra-passe manual): mais trabalho e mais risco; só com decisão expressa.

Enquanto não houver decisão, a recomendação é a segunda opção, com conhecimento dos encarregados de educação.

## Segurança — resumo das decisões

- O cliente (browser) só tem a **chave publicável**. Nenhuma funcionalidade usa a chave secreta;
  o primeiro administrador é criado no SQL Editor (função não exposta pela API).
- O cliente só **lê** (filtrado por RLS). Todas as escritas com efeito pedagógico ou administrativo são
  funções RPC no servidor que verificam a permissão atual (estado, função, equipa) em cada chamada.
- Funções e equipas nunca vêm do registo nem do perfil; só a administração as altera, e cada alteração
  fica em `membership_history` (gatilho no servidor).
- Um antigo guia perde o acesso no momento em que a função ou a equipa muda (as políticas usam o estado atual).
- O administrador técnico não vê progresso pedagógico, a menos que também seja dirigente.
- Concorrência: as decisões bloqueiam a linha do pedido (`for update`) e exigem a versão esperada;
  índices únicos impedem duas decisões de resultado para a mesma versão, pedidos ativos duplicados por
  trilho (normal ou histórico) e o mesmo trilho em duas etapas.
- Convites: guarda-se só o *hash* do código; validade, limite de usos e revogação verificados com bloqueio
  da linha. O código viaja no fragmento do link (`#…`), que não chega aos registos do servidor.
- Ficheiros: buckets privados, limites de tamanho/tipo no servidor, URLs temporários, fotografias
  comprimidas no browser (o que também remove metadados como a localização).

## Fora do âmbito desta versão

Outras secções, catálogo de especialidades, rankings, pagamentos, rede social, integração com o SIIE,
notificações push e emails de aviso (só existem notificações dentro da aplicação), passagem de secção
automática. A arquitetura (agrupamento › secção, `section_kind`, catálogo versionado por tipo de secção)
permite acrescentar outras secções no futuro.
