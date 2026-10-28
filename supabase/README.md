# Base de dados do Nexora CRM

As migrações em `migrations/` definem a estrutura inicial do banco para um projeto Supabase novo. A configuração e a conexão com o Supabase ficam para uma etapa posterior.

## O que esta base inclui

- Empresas, perfis, associação de usuários e papéis (`owner`, `manager` e `operator`).
- CNPJ opcional no cadastro de empresas (quando informado, continua validado e único).
- Isolamento por empresa com políticas de Row Level Security (RLS).
- Categorias, produtos e movimentações de estoque.
- Clientes, anotações, procurados, contatos e preferências do CRM.
- Vendas, itens, pagamentos e operações transacionais de estoque.
- Abertura e fechamento básico de caixa necessários ao PDV.

O caixa avançado (suprimentos, retiradas e conferência por forma de pagamento) não faz parte destas migrações.

## Aplicar depois em um projeto Supabase novo

1. Crie o projeto Supabase.
2. No painel, abra **SQL Editor**.
3. Execute o conteúdo de cada arquivo abaixo, separadamente e nesta ordem:
   1. `migrations/20261027021600_initial_multi_tenant.sql`
   2. `migrations/20261027030000_inventory.sql`
   3. `migrations/20261027040000_customers_crm.sql`
   4. `migrations/20261027050000_sales.sql`
   5. `migrations/20261027060000_operator_stock_movement_date.sql`
   6. `migrations/20261028000000_optional_company_cnpj.sql`
4. Espere cada execução terminar com sucesso antes de iniciar a próxima.

Esses arquivos são migrações incrementais, não um script para executar repetidamente. Aplique-os somente uma vez em um projeto sem as tabelas desta aplicação. Não execute novamente uma migração já aplicada nem aplique a sequência inteira sobre um banco em uso.

Se as cinco migrações anteriores já foram aplicadas, execute somente `migrations/20261028000000_optional_company_cnpj.sql`; os CNPJs existentes serão preservados.

## Conectar a aplicação em outra etapa

Quando o projeto Supabase estiver configurado, copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores públicos do projeto. Nunca coloque uma chave `service_role` no front-end.

As migrações ainda precisam ser executadas e validadas em um projeto Supabase antes de usar a aplicação com dados reais.

## Publicar no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` publica o build a cada atualização da branch `main`. Em **Settings → Pages**, selecione **GitHub Actions** como origem. Para habilitar login e cadastro reais na versão hospedada, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` como secrets do repositório. Sem esses secrets, a demo continua disponível, mas o login real fica desabilitado. Nunca configure uma chave `service_role`.
