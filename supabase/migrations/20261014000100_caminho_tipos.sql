-- Pioneiros — novos valores de enumeração para o reconhecimento na negociação
-- (Manual do Dirigente, p. 10: «Aquando da primeira Escolha/Negociação, após a
-- Promessa/Investidura, a Equipa de Animação deverá validar os trilhos que o
-- elemento demonstre já ter atingido, desde que devidamente fundamentados.»)
-- Ficheiro separado: um valor novo de enum só pode ser usado depois de confirmado.
alter type public.request_kind add value if not exists 'negociacao';
alter type public.decision_kind add value if not exists 'reconhecido_negociacao';
