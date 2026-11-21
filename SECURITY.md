# Segurança

## Implementado (Fase 1)

- **Isolamento multi-organização no Postgres:** RLS em todas as tabelas. Quem não é membro não vê organizações, membros, funções personalizadas, convites nem auditoria alheios, o que está testado explicitamente.
- **Privilégios mínimos:** os privilégios por omissão do Supabase são revogados. Há grants por coluna (o utilizador não altera `id`, `created_by`, `country_code` nem a sua própria função), e as escritas em membros, funções e convites passam só por RPC.
- **Hierarquia e anti-escalada:** só se atribui uma função de nível inferior ao próprio, só se concedem permissões que se possuem, ninguém altera a própria função e a organização nunca fica sem proprietário.
- **Convites:** token de 256 bits gerado no servidor. Só o hash SHA-256 é guardado, e não é legível pelos clientes. É de uso único, expira em 7 dias e fica preso ao email convidado, que tem de estar confirmado.
- **Auditoria:** triggers registam alterações sensíveis com o ator (`auth.uid()`). Os registos não são editáveis pelos clientes e sobrevivem à eliminação da organização.
- **Sessão:** cookies httpOnly geridos por `@supabase/ssr`, com renovação no `proxy.ts` e `getClaims()` (JWT verificado). O logout é só por POST, com verificação de origem.
- **Redirecionamentos:** `safeNextPath` impede open redirect (testado).
- **Links de email:** em produção usam só `NEXT_PUBLIC_SITE_URL`, nunca o cabeçalho Host (evita envenenamento do link de recuperação).
- **Enumeração de contas:** o registo e a recuperação respondem da mesma forma, exista ou não a conta.
- **Validação dupla:** Zod no servidor web e constraints, triggers e funções no Postgres (número fiscal, fuso, região/país, referências ativas).
- **Cabeçalhos:** HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` e `COOP`. O `X-Powered-By` está removido.
- **Segredos:** nenhum no repositório. `.env*` está no `.gitignore` e a chave service_role nunca vai para o frontend.
- **Erros:** o utilizador vê mensagens traduzidas, nunca detalhes SQL.

## Pendente

| Item | Fase |
|---|---|
| CSP com nonce | 10 |
| Rate limiting aplicacional (o Supabase Auth já limita login, registo e emails) | 10 |
| Política de passwords comprometidas (HaveIBeenPwned, plano Pro do Supabase) | 10 |
| MFA (TOTP) | 10 |
| Validação de uploads e antivírus para documentos | 3 |
| Consentimentos RGPD/LGPD, exportação e eliminação de dados do titular | 10 |
| Backups com PITR e teste de restauro | 10 |
| Testes de penetração externos | 10 |

## Reportar vulnerabilidades

Enviar para o responsável técnico do projeto. Não abrir issues públicas com detalhes exploráveis.

## Pedidos externos do agente de mercado
- O agente corre no Postgres (`private.run_market_agent`, SECURITY DEFINER, sem acesso para `authenticated`). Os endereços pedidos são montados a partir do catálogo `market_series`, que só o sistema escreve: nenhum valor vindo de utilizadores entra num URL (sem SSRF).
- Pedidos com tempo limite de 20 s e User-Agent próprio; as respostas são validadas pela forma (JSON-stat/SIDRA) antes de gravar, e uma resposta inválida conta como falha da série.
