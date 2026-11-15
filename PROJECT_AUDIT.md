# Auditoria do projeto — ANEN

**Data:** 15/11/2026 · **Âmbito:** pasta `ANEN` antes do início do desenvolvimento.

## 1. Estado encontrado

| Item | Resultado |
|---|---|
| Estrutura | A pasta continha apenas um `CLAUDE.md`, sem código, dependências, base de dados nem git. |
| Tecnologias existentes | Nenhuma instalada. O `CLAUDE.md` sugeria Next.js + TypeScript + Tailwind + Prisma/Supabase. |
| Páginas / componentes | Nenhum. |
| Base de dados | Nenhuma. |
| Autenticação | Nenhuma. |
| Integrações | Nenhuma. |
| Erros, duplicações, segurança, responsividade | Não aplicável, porque não havia código. |

### Classificação das funcionalidades (antes desta fase)

Todas as funcionalidades do prompt mestre estavam **Não implementadas**. Não havia nada a preservar, migrar ou corrigir.

### Conflitos encontrados e decisões

| Conflito | Decisão (confirmada pelo proprietário) |
|---|---|
| O `CLAUDE.md` descrevia um app de financiamento a empresas. O prompt mestre descreve uma plataforma de finanças, orçamentos e marketplace. | A plataforma do prompt mestre **substitui** o app de financiamento. O nome ANEN mantém-se. O `CLAUDE.md` foi reescrito. |
| Paleta clara (`#F5F4F2`, laranja `#F26B1D`) contra paleta escura do prompt. | Usa-se a **paleta do prompt** (`#090909`, `#FF851B`, `#202020`, `#353535`). O logótipo foi recolorido e o subtítulo "Business Financing" removido. |
| Prisma ou Supabase. | **Supabase** (Auth, Postgres com RLS, Storage, Edge Functions), conforme o prompt mestre. |

### Ambiente de desenvolvimento verificado

- Node 26, npm 11, git 2.56 disponíveis.
- Sem Docker nem Supabase CLI, por isso não é possível correr o Supabase local. As migrations são testadas com **PGlite** (Postgres 17 em WebAssembly), que emula papéis, `auth.uid()` e privilégios do Supabase.
- Conta Supabase: o projeto não foi criado porque a conta atingiu o limite de 2 projetos gratuitos ativos (ver §6).

## 2. Arquitetura recomendada

Monorepo npm workspaces. Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md).

```
apps/web                  Next.js 16 (App Router, Server Actions, proxy de sessão)
apps/mobile               Expo + React Native (Fase 9)
packages/financial-engine Decimal exato em bigint, Money, fórmulas
packages/validation       Zod + validadores fiscais (NIF, CPF, CNPJ alfanumérico)
packages/i18n             pt-PT, pt-BR (en/es preparados), formatação de moeda e datas
packages/types            Tipos de domínio e da base de dados
packages/ui               Tokens de design partilhados web/mobile
packages/database         Harness de testes das migrations (PGlite)
packages/config           tsconfig base
packages/tax-engine       Fase 5
packages/pricing-engine   Fases 3–4
supabase/                 migrations, templates de email, config
```

Princípios:
- A base de dados é a fronteira de segurança: RLS em todas as tabelas, e as escritas sensíveis passam por funções `SECURITY DEFINER` que validam permissão e hierarquia.
- Os cálculos financeiros e fiscais ficam em pacotes determinísticos e testados. A IA chama-os como ferramentas e nunca calcula por texto.
- Regras fiscais, taxas e limites ficam em dados versionados, nunca em código.

## 3. Problemas críticos (para as próximas fases)

1. **Sem projeto Supabase de produção.** Bloqueia o deploy funcional (§6).
2. **Envio de emails transacionais.** O SMTP por omissão do Supabase tem limites baixos e não serve produção. É preciso um fornecedor (Resend, Postmark ou SES).
3. **Fiscalidade.** Nenhum valor fiscal pode entrar sem fonte legal e data de validação. É preciso definir quem valida juridicamente as regras de PT e BR.
4. **Faturação oficial.** Fica fora do âmbito até haver integração com software certificado pela AT (PT) e com o emissor de NFS-e (BR).

## 4. Dependências entre fases

- A Fase 2 (Finanças) depende do contexto de organização e das permissões (concluídos) e do motor financeiro (concluído).
- A Fase 3 (Orçamentos) depende da 2 e do `pricing-engine`. O PDF exige decidir o motor de renderização.
- A Fase 5 (Fiscal) depende de validação jurídica das regras.
- A Fase 6 (IA) depende das 2–5 (ferramentas determinísticas) e de uma chave de API de modelos.
- A Fase 8 (Monetização) depende de Stripe (ou alternativa) validado para PT e BR.
- A Fase 9 (Mobile) depende das APIs estáveis das fases 1–3.

## 5. Plano de implementação

Ver [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). A Fase 1 foi executada nesta entrega.

## 6. Serviços externos e credenciais

| Serviço | Para quê | Credenciais | Estado |
|---|---|---|---|
| Supabase | Auth, Postgres, Storage, Edge Functions | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só servidor) | **Bloqueado:** limite de 2 projetos gratuitos atingido na conta |
| Hosting web (Vercel recomendado) | Next.js em produção | Conta/token Vercel | Não configurado |
| Email transacional (Resend/Postmark/SES) | Confirmação, recuperação, convites | API key + domínio verificado (SPF/DKIM) | Não configurado |
| Google OAuth | Login Google | Client ID/secret no Supabase | Opcional, desativado |
| Stripe Billing | Assinaturas Free/Pro/Max | Secret key, webhook secret | Fase 8 |
| API de modelos de linguagem | IA central | API key (só servidor) | Fase 6 |
| Mapas e rotas (Google Maps, Mapbox ou OSRM) | Distâncias reais e áreas de serviço | API key | Fase 7 |
| Fontes de dados (INE, Eurostat, IBGE, World Bank, OECD) | Referências de preços | APIs públicas (algumas exigem registo) | Fase 4 |
| Expo / EAS | Builds mobile e push | Conta Expo, certificados Apple/Google | Fase 9 |
| Monitorização (Sentry ou equivalente) | Erros e performance | DSN | Fase 10 |

## 7. Riscos

**Técnicos**
- Os tipos da base de dados são mantidos à mão até o projeto Supabase estar ligado (`supabase gen types`).
- O PGlite não reproduz 100 % do Supabase (por exemplo, extensões e Realtime). É preciso correr também os testes contra um projeto real de staging.
- Next.js 16 e TypeScript 6 são recentes. As versões estão fixadas para reprodutibilidade.

**Fiscais e legais**
- Cálculos de IVA, ISS, ICMS, CBS e IBS mal parametrizados podem expor os utilizadores a coimas. Cada regra precisa de fonte legal e validação antes de ser ativada.
- A reforma tributária brasileira (CBS/IBS, Imposto Seletivo) está em transição de 2026 a 2033. As regras têm de ser versionadas por data.
- O CNPJ alfanumérico está em vigor desde julho de 2026 e já é suportado na validação.
- RGPD e LGPD exigem bases legais, registo de tratamentos, DPA com fornecedores e transferência internacional (região do Supabase).
- Emitir faturas fiscais sem software certificado é ilegal em Portugal.

**Comerciais**
- O âmbito é muito amplo (finanças, orçamentos, preços, fiscal, IA, marketplace, mobile). O risco de dispersão é alto, por isso as fases devem ser entregues em ordem.
- Os preços de mercado sem fonte verificável comprometem a credibilidade. A regra é mostrar intervalos e fontes, nunca valores inventados.
- O marketplace com pagamentos a terceiros implica regulação (instituição de pagamento ou PSP). Não está incluído sem desenho legal prévio.
