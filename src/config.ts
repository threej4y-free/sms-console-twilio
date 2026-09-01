import "dotenv/config";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[a-fA-F0-9]{32}$/, "TWILIO_ACCOUNT_SID invalido"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN e obrigatorio"),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+[1-9]\d{7,14}$/, "TWILIO_PHONE_NUMBER deve estar no formato E.164"),
  API_KEY: z.string().min(24, "API_KEY deve ter pelo menos 24 caracteres"),
  PUBLIC_BASE_URL: z.union([z.url(), z.literal("")]).default(""),
  TWILIO_VALIDATE_WEBHOOKS: booleanFromString,
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Configuracao invalida: ${details}`);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  twilioAccountSid: parsed.data.TWILIO_ACCOUNT_SID,
  twilioAuthToken: parsed.data.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: parsed.data.TWILIO_PHONE_NUMBER,
  apiKey: parsed.data.API_KEY,
  publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/$/, ""),
  validateTwilioWebhooks: parsed.data.TWILIO_VALIDATE_WEBHOOKS,
};
