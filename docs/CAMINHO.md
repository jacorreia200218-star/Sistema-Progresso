# O Caminho — regras pedagógicas e modelo

A tab **Caminho** representa o Sistema de Progresso como o manual o apresenta: um jogo de pistas
(esquema da p. 3) com o ciclo de cada etapa e os marcos acumulados (esquema da p. 14). Não é uma
classificação: não há pontuações, pódios nem ordenação de pioneiros; as pessoas aparecem agrupadas no
marco em que estão, nunca numa distância contínua.

Fonte: `docs/fonte/Manual_do_Dirigente_Sistema_de_Progresso.pdf` (numeração impressa = numeração do PDF).

## 1. Marcos do caminho

| # | Marco | Páginas | Registado na aplicação? | Como se entra / sai |
|---|---|---|---|---|
| 1 | Sinais de Pista | 3, 4, 14 | Não (acontece na secção anterior) | Aproximação informal; termina com a passagem de secção |
| 2 | Início de Pista (adesão, Desprendimento) | 4–7, 62 | Sim | Entrada confirmada na secção → **perfil traçado** (data) → **decisão sobre a adesão** em Conselho de Guias com toda a Equipa de Animação |
| 3 | Promessa / Investidura | 8 | Sim | Data da Promessa/Investidura; ao registá-la, a 1.ª etapa abre sozinha (p. 10) |
| 4 | Conhecimento (Saber) | 9–13, 62 | Sim | Ciclo da etapa (ver 2) |
| 5 | Vontade (Querer) | 9–13, 62–63 | Sim | Ciclo da etapa |
| 6 | Construção (Agir) | 9–13, 63 | Sim | Ciclo da etapa |
| 7 | Acampamento / Anilha de Mérito | 13 | Sim | Construção concluída → elegível; a anilha é um registo próprio |
| 8 | Passagem de secção / Voltar ao Início de Pista | 13–14 | Não | Idade (Regulamento Geral; o esquema da p. 14 indica 17 anos na III Secção) **e** maturidade; pode acontecer em qualquer ponto |

O quadro dos conhecimentos de adesão da III Secção (p. 6, apenas a coluna «III Secção») é mostrado no
marco Início de Pista como orientação.

## 2. Ciclo de cada etapa (p. 14) e regras

**Escolha e negociação → Oportunidades educativas → Validação → Reconhecimento**

- Seis áreas FACEIS, três trilhos por área (p. 9). Cada etapa é construída com **um trilho de cada área**
  (p. 10); a composição é variável e negociada, não está fixada à partida.
- Marcos acumulados: 1, 2 e 3 trilhos validados por área ao fim de Conhecimento, Vontade e Construção
  (p. 14), respeitando a validação de cada etapa. Na aplicação, cada etapa tem os seus 6 trilhos confirmados
  e um trilho nunca pode estar em duas etapas.
- **Seis trilhos quaisquer não equivalem a uma etapa**: só contam os trilhos confirmados para essa etapa,
  um por área, e validados.
- Realizar uma oportunidade educativa não valida o trilho (p. 11); a sugestão de pelo menos duas
  oportunidades por trilho é orientação, não mínimo.
- Progresso já demonstrado pode ser **reconhecido na negociação**, quando fundamentado (p. 10).
- Validação do trilho: reunião de Equipa, comunicada ao Conselho de Guias (pp. 11–12).
- Validação da etapa: Conselho de Guias, terminando com a **opinião final da Equipa de Animação**,
  fundamentada quando contrária (p. 12).
- **Reconhecimento** público na celebração, depois de concluída (pp. 12–13).
- A **insígnia de progresso é entregue no início** de cada etapa (p. 9).
- **Automático (só o que é administrativo)**: a 1.ª etapa abre quando se regista a Promessa; cada etapa
  seguinte abre quando a anterior fica concluída (a data da insígnia fica por registar); com um trilho
  confirmado e validado em cada área, a etapa segue sozinha para o Conselho de Guias. A decisão do
  Conselho e a opinião final da Equipa de Animação continuam a ser registadas por pessoas, num só
  passo («Etapa validada» / «Ainda não», com fundamentação quando não é validada). Se os
  dirigentes devolverem um trilho antes de o Conselho decidir, o pedido da etapa é cancelado e volta a
  ser criado quando o trilho for validado de novo.
- Concluir requisitos nunca provoca automaticamente cerimónias, a anilha de mérito ou a passagem.

## 3. Estados (no modelo e na interface)

Calculados no servidor (`private.member_position`) e, com a mesma regra, no cliente (`src/lib/caminho.ts`).

| Marco | Estado | Significado |
|---|---|---|
| Início de Pista | `em_adesao` | Entrada confirmada; a viver a adesão |
| | `perfil_tracado` | A Equipa de Animação registou o traçado do perfil |
| Promessa | `aguarda_promessa` | Adesão decidida; Promessa/Investidura por registar |
| | `aguarda_etapa` | Promessa feita; 1.ª etapa por abrir (só em casos raros: a etapa abre sozinha) |
| Etapa (**estar em**) | `em_curso` | Etapa aberta (insígnia), trilhos em escolha/desenvolvimento |
| | `requisitos_cumpridos` | Um trilho confirmado e validado em cada área sem pedido em curso (ex.: depois de «não confirmada»); falta pedir a validação |
| | `em_validacao` | Pedido no Conselho de Guias / a aguardar opinião final |
| Etapa (**ter concluído**) | `concluida` | Validada (Conselho de Guias + opinião final); reconhecimento por registar. Como a etapa seguinte abre sozinha, a posição passa logo a ser essa etapa |
| | `reconhecida` | Concluída e com reconhecimento público registado |
| Acampamento | `etapas_concluidas` | Construção concluída; anilha por registar |
| | `anilha_atribuida` | Atribuição da anilha registada pela Equipa de Animação |

Em cada etapa a interface separa sempre três coisas: **requisitos educativos** (trilhos validados),
**decisão pedagógica** (Conselho de Guias e Equipa de Animação) e **reconhecimento**.

## 4. Quem vê o quê

| Quem | O meu caminho | Caminho da secção |
|---|---|---|
| Pioneiro | O seu percurso completo | Quantos estão em cada marco; só o próprio nome |
| Guia | O seu percurso | Nomes e resumo da **sua equipa atual**; contagens da secção |
| Dirigente | — | Todos os nomes, filtro por equipa, resumo de cada percurso |
| Administração técnica (sem função pedagógica) | — | Só contagens |

A vista usa a função `public.section_path`, que verifica permissões no servidor e devolve apenas nome,
totem, fotografia, equipa e marco/estado — nunca reflexões, anexos, comentários ou observações. O resumo
de um pioneiro lê os dados com as políticas RLS já existentes.

## 5. Diferenças corrigidas em relação à versão anterior

1. **Promessa antes da 1.ª etapa** — a etapa Conhecimento abria só com a decisão de adesão; o manual diz que
   a primeira escolha/negociação é «após a Promessa/Investidura» (p. 10). Agora `open_stage` exige a data da
   Promessa. Etapas já abertas não são alteradas e continuam a contar como etapa em curso.
2. **Traçado do perfil** — passou a poder registar-se (só a data) no Início de Pista (pp. 4 e 7).
3. **Reconhecimento na negociação** — novo registo do dirigente, com fundamentação obrigatória e aviso à
   Equipa (p. 10). Antes só existia o pedido de «progresso anterior» feito pelo pioneiro, que continua igual
   (incluindo a opção para o desativar, que não afeta este reconhecimento).

Nenhum registo, validação ou aprovação existente foi apagado ou alterado.

## 6. Validação por trilho (19/10/2026)

O **trilho é a unidade de validação**. Os objetivos educativos descrevem o que é preciso demonstrar
nesse trilho (ex.: Desempenho = F1; Autoconhecimento = F2 e F3; Bem-estar físico = F4).

- **Pedido do pioneiro**: Área FACEIS → Trilho → Objetivos e justificação → «Pedir validação do trilho».
  O ecrã mostra a área, o trilho e **todos** os objetivos (código e texto oficial), sempre visíveis.
  Não se escolhem objetivos. Uma justificação comum, obrigatória («Como demonstrei que alcancei este
  trilho?»), anexos opcionais. O texto fica guardado no dispositivo se houver erro ou se voltar atrás.
- **Estados**: Por fechar → Em validação → Validado, e «A rever» quando a reunião devolve. Enviar
  **nunca** fecha o trilho.
- **Decisão da reunião de Equipa** (`record_team_decision`): sobre o trilho completo — validar ou devolver
  com fundamentação obrigatória. Ao devolver pode indicar os objetivos ainda por demonstrar; isso é
  só um comentário, não uma decisão por objetivo. Um guia nunca decide o seu próprio pedido; quando um
  dirigente regista em nome da reunião, o guia da equipa é avisado.
- Validação do trilho, associação a uma etapa e validação da etapa (Conselho de Guias → opinião final da
  Equipa de Animação → reconhecimento público) continuam a ser passos separados.
- **Registos anteriores**: os pedidos e decisões por objetivo ficam como «Histórico por objetivos»,
  visíveis no trilho e no pedido. Não são convertidos em trilhos concluídos.

## 7. Acompanhamento e notificações (19/10/2026)

- Acompanhamento em três separadores: **Secção** (pessoas por equipa, pesquisa, filtros por equipa e etapa,
  mérito e exportação como secundários), **Pedidos** (caixa única com filtros Todos / Negociação / Trilhos /
  Progresso anterior, estado e equipa; cada pedido aparece uma vez) e **Etapas** (Conselho de Guias,
  comunicação das decisões de trilhos em secção própria). Os endereços antigos (`/dirigentes/*`,
  `/acompanhamento/negociacao`, etc.) redirecionam para o novo sítio e filtro.
- Notificações: eliminar uma, várias, as lidas ou todas, com «Desfazer». A remoção é apenas uma marca
  (`deleted_at`) nas notificações do próprio utilizador; pedidos, decisões e justificações não são tocados.
  O mesmo evento não é repetido para a mesma pessoa enquanto houver uma notificação igual por ler.
