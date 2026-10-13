-- Pioneiros — pedidos por objetivos (1/2): novos valores de enumeração.
-- Ficam num ficheiro próprio porque um valor novo só pode ser usado depois de
-- a transação que o cria terminar.
--   objetivos_validados: todos os objetivos do pedido foram aceites, mas o trilho
--     ainda tem objetivos por validar (o trilho NÃO fica concluído).
--   objetivos_equipa: decisão da reunião de Equipa com esse resultado.
alter type public.request_status add value if not exists 'objetivos_validados';
alter type public.decision_kind add value if not exists 'objetivos_equipa';
