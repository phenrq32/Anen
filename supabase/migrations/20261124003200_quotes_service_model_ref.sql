-- Orçamento criado a partir de um modelo com preço (migration 3100): guarda de que modelo veio, para o
-- editor mostrar ao profissional o preço recomendado e a faixa de mercado como referência (nunca no documento
-- do cliente). Opcional; fixado na criação (as colunas não estão nos grants de UPDATE de quotes).
-- Reversão: alter table public.quotes drop column service_model_set_id, drop column service_model_key;

alter table public.quotes
  add column service_model_set_id text,
  add column service_model_key text,
  add constraint quotes_service_model_pair check ((service_model_set_id is null) = (service_model_key is null)),
  add constraint quotes_service_model_fk foreign key (service_model_set_id, service_model_key)
    references public.quote_service_models (set_id, service_key) on delete set null;
