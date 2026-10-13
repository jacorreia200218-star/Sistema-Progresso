# Cópias de segurança, exportação e restauro

Os dados da aplicação estão em dois sítios do projeto Supabase:

1. **Base de dados PostgreSQL** — membros, equipas, catálogo, escolhas, pedidos, decisões, etapas, mérito, histórico.
2. **Storage** — buckets privados `fotografias` e `anexos`.

As cópias contêm **dados pessoais de menores**. Guarda-as cifradas, num local com acesso restrito
(ex.: disco cifrado ou cofre da associação), nunca em pastas partilhadas públicas, e apaga as antigas.

## 1. Exportação pedagógica (sem instalar nada)

Na aplicação, um dirigente abre **Revisões › Secção › Exportar**. Descarrega um ficheiro JSON com os
dados pedagógicos da secção (membros, adesões, etapas, escolhas, pedidos e versões, decisões, mérito).
Não inclui os ficheiros dos anexos. Serve para consulta e arquivo; não é uma cópia de restauro completa.

## 2. Cópia completa da base de dados

Pré-requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli) e a *connection string* do projeto
(Painel › **Connect** › *Session pooler*; usa a palavra-passe da base de dados, que só o proprietário tem).

```bash
export DB_URL='postgresql://postgres.<ref>:<palavra-passe>@<host>:5432/postgres'
mkdir -p backup/$(date +%F)
supabase db dump --db-url "$DB_URL" -f backup/$(date +%F)/roles.sql --role-only
supabase db dump --db-url "$DB_URL" -f backup/$(date +%F)/schema.sql
supabase db dump --db-url "$DB_URL" -f backup/$(date +%F)/data.sql --use-copy --data-only
```

Os projetos pagos do Supabase também fazem cópias diárias automáticas (Painel › Database › Backups);
no plano gratuito, faz esta cópia manual com regularidade (ex.: no fim de cada período).

## 3. Cópia dos ficheiros (Storage)

```bash
supabase login
supabase link --project-ref <ref>
supabase storage cp -r ss:///fotografias backup/$(date +%F)/fotografias --experimental
supabase storage cp -r ss:///anexos backup/$(date +%F)/anexos --experimental
```

## 4. Restauro (num projeto novo ou limpo)

1. Cria um projeto Supabase novo (ou usa um projeto vazio).
2. Restaura a estrutura e os dados:
   ```bash
   cd backup/AAAA-MM-DD
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$NOVO_DB_URL"
   ```
   O `schema.sql` já contém as migrações; **não** voltes a correr `supabase db push` sobre uma restauração.
3. Restaura os ficheiros:
   ```bash
   supabase link --project-ref <novo-ref>
   supabase storage cp -r backup/AAAA-MM-DD/fotografias ss:///fotografias --experimental
   supabase storage cp -r backup/AAAA-MM-DD/anexos ss:///anexos --experimental
   ```
4. Atualiza as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` na Vercel e reconfigura os
   emails de autenticação e os *Redirect URLs* (ver README).
5. Testa: entra com uma conta de dirigente, abre um pedido com anexo e confirma que o ficheiro abre.

Faz um ensaio de restauro num projeto de teste pelo menos uma vez, antes de precisares dele.
