import { createApp } from "./app.js";
import { config } from "./config.js";
import { SmsFireSmsService, TwilioSmsService, type SmsProviderId, type SmsService } from "./sms-service.js";

const smsProviders: Partial<Record<SmsProviderId, SmsService>> = {
  twilio: new TwilioSmsService(
    config.twilioAccountSid,
    config.twilioAuthToken,
    config.twilioPhoneNumber,
  ),
};

if (config.smsFireUsername && config.smsFireApiToken) {
  smsProviders.smsfire = new SmsFireSmsService(
    config.smsFireUsername,
    config.smsFireApiToken,
    config.smsFireBaseUrl,
    config.smsFireTimeoutMs,
  );
}

const app = createApp({
  smsProviders,
  apiKey: config.apiKey,
  twilioAuthToken: config.twilioAuthToken,
  publicBaseUrl: config.publicBaseUrl,
  validateTwilioWebhooks: config.validateTwilioWebhooks,
  enableLocalUi: config.nodeEnv !== "production",
});

const server = app.listen(config.port, () => {
  console.log(`API de SMS executando na porta ${config.port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} recebido; encerrando servidor`);
  server.close((error) => {
    if (error) {
      console.error("Falha ao encerrar servidor", error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
