# smsconsole.

Painel local para organizar destinatários, disparar SMS pela Twilio e acompanhar entregas.

O projeto combina uma API Node.js/TypeScript com uma interface web responsiva. As credenciais permanecem no servidor, as listas são armazenadas no navegador e o relatório consulta os status reais das mensagens na Twilio.

## Recursos

- Envio individual pela API autenticada.
- Disparo da mesma mensagem para listas com até 100 números.
- Cadastro de listas no navegador, sem banco de dados.
- Histórico local dos envios realizados pela interface.
- Relatório dos últimos sete dias com enviados, entregues, falhas e taxa de entrega.
- Callback para atualizações de status da Twilio.
- Validação de números no padrão E.164.
- Rate limiting, headers de segurança e tratamento de erros da Twilio.
- Validação criptográfica dos webhooks recebidos.

## Tecnologias

- Node.js 20+
- TypeScript
- Express
- Twilio Node Helper Library
- Zod
- Vitest e Supertest
- HTML, CSS e JavaScript sem framework no frontend

## Como funciona

```text
Navegador local
    │
    ├── listas e histórico no localStorage
    │
    └── API local ──► Twilio ──► operadora ──► destinatário
                         │
                         └── webhook de status ──► API
```

A interface usa rotas restritas a conexões locais. O endpoint público de envio continua protegido por `API_KEY`.

## Pré-requisitos

- Node.js 20 ou superior.
- Conta Twilio.
- Número Twilio habilitado para SMS.
- Destinos liberados pelas permissões geográficas da conta.

Em contas trial, a Twilio permite o envio somente para destinatários verificados. Essa limitação pertence à conta e não pode ser removida pelo código.

## Instalação

Clone o projeto e instale as dependências:

```powershell
git clone https://github.com/threej4y-free/sms-console-twilio.git
Set-Location sms-console-twilio
npm install
```

Crie o arquivo local de configuração:

```powershell
Copy-Item .env.example .env
```

Preencha o `.env` com os dados da sua conta:

```env
NODE_ENV=development
PORT=3001

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=seu_auth_token
TWILIO_PHONE_NUMBER=+15005550006

API_KEY=gere-uma-chave-longa-e-aleatoria
PUBLIC_BASE_URL=
TWILIO_VALIDATE_WEBHOOKS=true
```

Nunca envie o `.env` ao Git. O arquivo já está incluído no `.gitignore` e no `.npmignore`.

## Executar localmente

```powershell
npm run dev
```

Abra o painel:

<http://localhost:3001>

Verifique a API:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

## Usar o painel

### 1. Criar uma lista

Abra **Destinatários**, informe um nome e cole um número por linha:

```text
+5511999999999
+5511888888888
```

Os números devem estar no formato E.164: sinal de `+`, código do país, DDD e telefone, sem zero de operadora.

### 2. Enviar uma mensagem

Abra **Envio**, selecione uma lista, escreva a mensagem e confirme o disparo. O servidor processa cada número e retorna quantos envios foram aceitos ou recusados.

### 3. Consultar o relatório

Abra **Relatório** para visualizar:

- histórico salvo neste navegador;
- mensagens enviadas nos últimos sete dias;
- entregas confirmadas;
- taxa de entrega;
- falhas e mensagens ainda em processamento.

O gráfico consulta a API da Twilio e considera até os 1.000 registros de saída mais recentes.

## API

### Autenticação

O endpoint `/v1/messages` aceita a chave em um destes headers:

```http
Authorization: Bearer <API_KEY>
```

```http
X-API-Key: <API_KEY>
```

### Enviar um SMS

```http
POST /v1/messages
Content-Type: application/json
Authorization: Bearer <API_KEY>
```

```json
{
  "to": "+5511999999999",
  "body": "Olá pela Twilio"
}
```

Resposta:

```json
{
  "message": {
    "sid": "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "to": "+5511999999999",
    "from": "+15005550006",
    "status": "queued",
    "dateCreated": "2026-09-01T12:00:00.000Z"
  }
}
```

### Rotas disponíveis

| Método | Rota | Finalidade | Proteção |
|---|---|---|---|
| `GET` | `/health` | Verificação de saúde | Pública |
| `POST` | `/v1/messages` | Envio individual | API key |
| `POST` | `/ui/messages` | Envio individual pela interface | Apenas local |
| `POST` | `/ui/broadcasts` | Envio para até 100 destinatários | Apenas local |
| `GET` | `/ui/report` | Relatório dos últimos sete dias | Apenas local |
| `POST` | `/webhooks/twilio/message-status` | Atualização de status | Assinatura Twilio |

## Webhook de status

Para receber atualizações da Twilio, publique a API em uma URL HTTPS e configure:

```env
PUBLIC_BASE_URL=https://sms.seudominio.com
```

Os envios passarão automaticamente este callback:

```text
https://sms.seudominio.com/webhooks/twilio/message-status
```

O endpoint valida o header `X-Twilio-Signature` com o Auth Token. Mantenha `TWILIO_VALIDATE_WEBHOOKS=true` em produção.

## Segurança

- Credenciais carregadas exclusivamente por variáveis de ambiente.
- `.env`, artefatos de build e dependências fora do Git.
- API key comparada com `timingSafeEqual`.
- Limite de requisições nos endpoints de envio.
- Payload JSON limitado a 20–30 KB.
- Webhook validado criptograficamente.
- Rotas da interface bloqueadas fora do computador local.
- Rotas locais desativadas automaticamente quando `NODE_ENV=production`.

Para disponibilizar o painel publicamente, implemente autenticação de usuário e autorização antes de habilitar disparos remotos.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor com recarregamento automático |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos |
| `npm test` | Executa os testes automatizados |
| `npm run build` | Compila o TypeScript em `dist/` |
| `npm start` | Executa a versão compilada |

## Estrutura

```text
public/
  index.html          interface
  styles.css          tema e responsividade
  app.js              listas, envios e relatório
src/
  app.ts              rotas, validações e segurança
  config.ts           leitura das variáveis de ambiente
  server.ts           inicialização e encerramento do servidor
  sms-service.ts      integração e relatório da Twilio
tests/
  app.test.ts         testes da API e da interface
```

## Limitações atuais

- Listas e histórico são locais ao navegador e não são sincronizados entre dispositivos.
- O histórico visual registra o status retornado no momento do envio; o gráfico usa os status atuais consultados na Twilio.
- O envio em lote é sequencial e limitado a 100 destinatários por solicitação.
- Contas trial continuam sujeitas às restrições de destinatários e conteúdo da Twilio.
