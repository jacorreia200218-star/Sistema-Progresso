-- =====================================================================
-- CRIAÇÃO SEGURA DA SECÇÃO E DO PRIMEIRO ADMINISTRADOR
-- =====================================================================
-- 1. Cria primeiro a tua conta na aplicação (Criar conta) e confirma o email.
-- 2. No painel do Supabase abre «SQL Editor», cola este ficheiro, substitui os
--    três valores entre aspas e carrega em «Run».
-- 3. Entra na aplicação: verás o menu «Gestão» (administração) e «Revisões»
--    (dirigente). A partir daí cria equipas e convites.
--
-- A função usada não está exposta pela API: só corre aqui, com acesso de
-- proprietário do projeto. Pode ser executada de novo sem duplicar nada.
-- Último parâmetro: true = o primeiro admin é também dirigente (Equipa de
-- Animação); false = só administração técnica.
select private.bootstrap_section(
  'Agrupamento 000 — Nome do Agrupamento',   -- nome do agrupamento
  'Pioneiros',                              -- nome da secção
  'o-teu-email@exemplo.pt',                 -- email da conta já criada
  true
) as section_id;
