# Relatório de importação do catálogo — Pioneiros (III Secção)

**Versão do catálogo:** `pioneiros-manual-v1`
**Fonte:** `docs/fonte/Manual_do_Dirigente_Sistema_de_Progresso.pdf`
(SHA-256 `79114757a5e129de7f8405a7db396b344118dccad075ef54b42c789585a836d6`)

> O manual fornecido é a referência desta implementação. Esta importação **não** confirma
> que se trata da edição atualmente em vigor no CNE. A aplicação é uma ferramenta de
> acompanhamento local e não substitui registos oficiais.

## 1. Páginas usadas

A numeração impressa do manual coincide com a numeração das páginas do ficheiro PDF.

| Conteúdo | Páginas | Uso na aplicação |
|---|---|---|
| Mecânica do Sistema de Progresso (Início de Pista, adesão, Caminhos a Seguir, validação, reconhecimento, anilha de mérito, passagem) | 4–15 | Regras do fluxo (ver secção 4) |
| Nome da etapa de adesão dos Pioneiros: Desprendimento | 6 e 62 | Etapa de adesão |
| Etapas de progresso da III Secção: Conhecimento, Vontade, Construção | 9 e 62–63 | Etapas de progresso |
| Catálogo da III Secção: áreas, trilhos, enquadramento, palavras-chave, objetivos, oportunidades educativas | 41–46 (Anexo A) | Catálogo |

Não foram importados objetivos de outras secções. O catálogo de especialidades não foi importado.

## 2. Conteúdo importado

| Área (código) | Página | Trilhos | Objetivos |
|---|---|---|---|
| Físico (F) — o corpo | 41 | Desempenho; Autoconhecimento; Bem-estar físico | F1; F2, F3; F4 |
| Afetivo (A) — os sentimentos e as emoções | 42 | Relacionamento e sensibilidade; Equilíbrio emocional; Autoestima | A1–A3; A4; A5, A6 |
| Caráter (C) — a atitude | 43 | Autonomia; Responsabilidade; Coerência | C1, C2; C3–C5; C6, C7 |
| Espiritual (E) — o sentido de Deus | 44 | Descoberta; Aprofundamento; Serviço | E1–E3; E4–E6; E7, E8 |
| Intelectual (I) — a inteligência | 45 | Procura do conhecimento; Resolução de problemas; Criatividade e expressão | I1, I2; I3, I4; I5, I6 |
| Social (S) — a integração social | 46 | Exercer ativamente cidadania; Solidariedade e tolerância; Interação e cooperação | S1–S3; S4, S5; S6, S7 |

Total: **6 áreas, 18 trilhos, 38 objetivos educativos**, com os códigos impressos no manual.

Para cada trilho guardou-se: enquadramento, palavras-chave, objetivos (código + texto) e as
oportunidades educativas listadas. As oportunidades são **exemplos** (o manual termina cada
lista com «…» e descreve o baú de oportunidades como «sem fundo», p. 10–11); a aplicação
mostra-as como sugestões e não as usa para validar nada.

## 3. Método e verificação

1. Extração do texto das páginas com `pdftotext` e leitura visual das páginas renderizadas.
2. Transcrição para `catalog/pioneiros-v1.json`, preservando o texto impresso (incluindo
   gralhas aparentes — ver secção 5). Apenas se juntaram palavras partidas por hifenização
   de fim de linha (ex.: «tam-/bém» → «também»; «esforço-/-me» → «esforço-me»).
3. Verificação automática com `node scripts/verify-catalog.mjs` (requer `pdftotext`, do
   pacote poppler-utils). O script usa as **coordenadas** de cada palavra no PDF:
   - confirma o SHA-256 do PDF;
   - para cada trilho, localiza o título «Trilho: …» e delimita o seu bloco na página;
   - confirma que os códigos de objetivos nesse bloco são exatamente os do catálogo (evita
     associar um objetivo ao trilho errado por causa das colunas);
   - compara o texto de cada objetivo com o texto da **sua coluna** (delimitada pela posição do
     código seguinte);
   - compara enquadramento, palavras-chave e oportunidades educativas;
   - confirma 6 áreas × 3 trilhos e a ausência de códigos duplicados.
   O resultado detalhado fica em `catalog/verificacao.json`.

Resultado da última execução: **110 verificações, 0 problemas**.

A verificação detetou durante a importação uma transcrição incorreta (Resolução de problemas:
«capacidade de crítica» em vez de «capacidade crítica», por causa da hifenização
«capacida-/de»), que foi corrigida.

## 4. Regras extraídas das páginas 4–15 e como foram aplicadas

| Regra do manual | Página | Aplicação |
|---|---|---|
| Adesão (Início de Pista); decisão em Conselho de Guias com toda a Equipa de Animação | 5–7 | Registo de adesão separado, feito por dirigente |
| Insígnia de progresso entregue **no início** de cada etapa | 9 | Data de entrega da insígnia registada ao abrir a etapa; nunca automática no fim |
| 6 áreas, 3 trilhos por área; nos Pioneiros a base do progresso são os trilhos | 9 | Unidade de validação = trilho |
| Cada etapa: escolha de 1 trilho de cada área; composição variável | 10, 14 | Escolha negociada por área, sem trilhos pré-fixados por etapa |
| III Secção: o elemento escolhe trilhos e identifica oportunidades educativas | 10 | Escolha inclui oportunidades previstas (texto livre) |
| Trilhos já atingidos validam-se na negociação; só escolhe os que faltam | 10 | Trilhos já validados podem ser atribuídos à etapa sem nova validação; nenhum trilho conta duas vezes |
| Pelo menos 2 oportunidades por trilho «parece razoável» | 11 | Apenas orientação no ecrã; **não** é imposto |
| Não há relação direta entre realizar oportunidades e alcançar o trilho | 11 | Vivências e anexos nunca validam automaticamente |
| Troca de trilho durante a etapa é possível | 11 | Proposta de troca com confirmação do dirigente, preservando histórico |
| Validação: 1) trilho na reunião de Equipa; 2) etapa no Conselho de Guias | 11 | Pedido de trilho decidido pelo guia (registo da reunião); pedido de etapa separado |
| Validação na Equipa é comunicada ao Conselho de Guias; se manifestamente incoerente, devolve-se | 12 | Painel do Conselho de Guias e devolução fundamentada pelo dirigente |
| Termina com a declaração de opinião da Equipa de Animação, fundamentada se contrária; palavra final da Equipa de Animação | 12 | Opinião final do dirigente obrigatória para fechar a etapa; fundamentação obrigatória se divergir |
| Reconhecimento público das etapas concluídas | 12–13 | Registo de reconhecimento separado da conclusão |
| Anilha de mérito: terminar a última etapa / completar todos os trilhos da secção | 13 | Elegibilidade calculada (18 trilhos + Construção concluída) separada da atribuição registada com data |
| Passagem de secção não apenas pela idade | 13 | Nenhuma passagem automática por idade |

## 5. Ambiguidades e itens pendentes

Itens assinalados como **pendentes** no catálogo (`pending_items`) e mostrados na aplicação
com um aviso. Foram importados exatamente como impressos; não se inventou texto alternativo.

| ID | Onde | Questão | Tratamento |
|---|---|---|---|
| P1 | Caráter › Responsabilidade (C4) e Caráter › Coerência (C7), p. 43 | O texto de C4 e de C7 é **idêntico** («Ajo cada dia de acordo com as minhas convicções de referências, tendo consciência que sou exemplo para os outros.»). Provável gralha do manual. | Importado como impresso, marcado pendente. Confirmar com fonte oficial. |
| P2 | Social › Solidariedade e tolerância e Social › Interação e cooperação, p. 46 | O **enquadramento** dos dois trilhos é idêntico. | Importado como impresso, marcado pendente. Confirmar com fonte oficial. |

Outras observações (não bloqueiam o uso):

- **Gralhas aparentes preservadas**: C1 «de acordo com as minha referência»; I3 «utiliza-as»;
  S2 «em que me inseres»; F4 «Rejo-me»; oportunidades com mistura de 1.ª e 3.ª pessoa
  (ex.: «crio um plano», «da minha zona de conforto»). Mantidas para não alterar a fonte.
- **Palavras-chave em duas colunas** (ex.: Autoconhecimento, Autonomia): a ordem guardada é
  coluna esquerda seguida da coluna direita; o manual não indica se a disposição tem
  significado. Tratadas como lista simples.
- **Oportunidades que atravessam colunas** (Descoberta, p. 44: «Ajudar a dinamizar a vivência
  de Advento ou Quaresma da | sua Comunidade ou Agrupamento;»): reconstituída como uma só
  oportunidade, por continuidade da frase.
- **Diagrama da p. 14** («1 trilho por área / 2 trilhos por área / 3 trilhos por área»): lido como
  contagem acumulada (1.ª etapa: 1 por área; até à 3.ª: 3 por área = 18 trilhos), coerente com a
  p. 10 («selecionando 1 trilho … de cada uma das diferentes áreas»).
- **Quem regista as decisões na aplicação**: o manual descreve decisões coletivas (reunião de
  Equipa, Conselho de Guias, Equipa de Animação). A aplicação regista quem as introduziu e a
  data da reunião; não as substitui.

## 6. Regras locais (não constam do manual)

Estas regras são decisões de implementação e estão identificadas como tal na aplicação:

1. **L1** — Os pedidos do próprio guia são registados por um dirigente (em nome da reunião de
   Equipa), porque o guia não pode registar a decisão sobre a sua própria submissão.
2. **L2** — Abrir uma etapa de progresso requer adesão registada e a etapa anterior concluída.
3. **L3** — O Conselho de Guias só pode devolver um trilho validado na Equipa enquanto este não
   fizer parte de uma etapa já concluída.
4. **L4** — Progresso anterior (configuração `historical_progress_enabled`) segue diretamente
   para os dirigentes; um dirigente pode aprovar, recusar (comentário obrigatório) ou devolver
   para correção.
5. **L5** — Atribuir anilha de mérito sem elegibilidade calculada só é possível como
   declaração de mérito anterior, com fundamentação obrigatória.

## 7. Versões

Os registos (escolhas, pedidos, validações) referem o trilho de uma versão concreta do
catálogo. Uma versão futura cria novas linhas sem alterar as anteriores; a identidade de um
trilho entre versões é a chave estável (`key`, ex.: `fisico-desempenho`), usada para impedir
que o mesmo trilho conte duas vezes.
