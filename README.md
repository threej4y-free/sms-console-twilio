# API de disparo de SMS com Twilio

API Node.js + TypeScript para enviar SMS, protegida por API key e preparada para receber atualizacoes de status da Twilio.

## Requisitos

- Node.js 20 ou superior
- Conta Twilio e um numero habilitado para SMS
- Em conta trial, o destinatario precisa estar permitido/verificado na conta

## Conta trial

As limitacoes exatas dependem do tipo de trial exibido no Console. Em geral, confirme antes do teste:

- o numero de destino esta na lista de destinatarios verificados;
- o pais de destino esta permitido em **Messaging > Settings > Geo permissions**;
- o conteudo atende as regras ou aos templates mostrados no Console da sua conta trial.

Ao receber um erro da Twilio, esta API devolve `code`, `message` e `moreInfo` para facilitar o diagnostico.

## Executar localmente

O arquivo `.env` local contem a configuracao e nao e versionado. Instale as dependencias e inicie a API:

```powershell
npm install
npm run dev
```

Verifique se ela esta no ar:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

Abra `http://localhost:3001` no navegador para usar a interface de envio. A chave e aplicada no servidor automaticamente e nunca e enviada ao navegador. Por seguranca, essa rota de conveniencia aceita apenas conexoes locais e fica desativada quando `NODE_ENV=production`.

## Enviar um SMS

Use o numero de destino no formato E.164. No PowerShell, carregue a `API_KEY` sem imprimi-la e envie a requisicao:

```powershell
$smsApiKey = (Get-Content .env | Where-Object { $_ -like 'API_KEY=*' }).Substring(8)
$headers = @{ Authorization = "Bearer $smsApiKey" }
$payload = @{ to = "+5511999999999"; body = "Ola pela Twilio" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3001/v1/messages -Headers $headers -ContentType "application/json" -Body $payload
```

Resposta esperada:

```json
{
  "message": {
    "sid": "SM...",
    "to": "+5511999999999",
    "from": "+15005550006",
    "status": "queued",
    "dateCreated": "2026-09-01T12:00:00.000Z"
  }
}
```

## Callback de status

Ao publicar a API, configure `PUBLIC_BASE_URL` com a origem HTTPS publica, sem barra no final. O envio passara automaticamente esta URL para a Twilio:

```text
https://seu-dominio.com/webhooks/twilio/message-status
```

O endpoint valida o cabecalho `X-Twilio-Signature`. Nao desative `TWILIO_VALIDATE_WEBHOOKS` em producao.

## Rotas

- `GET /health`: verificacao de saude
- `POST /v1/messages`: envia uma mensagem; requer `Authorization: Bearer <API_KEY>` ou `X-API-Key`
- `POST /ui/messages`: envio usado pela interface; disponivel apenas localmente e fora de producao
- `POST /ui/broadcasts`: envia a mesma mensagem para ate 100 numeros de uma lista local
- `GET /ui/report`: retorna enviados, entregues e a serie dos ultimos 7 dias diretamente da Twilio
- `POST /webhooks/twilio/message-status`: recebe mudancas de status assinadas pela Twilio

## Verificacoes

```powershell
npm run typecheck
npm test
npm run build
```
