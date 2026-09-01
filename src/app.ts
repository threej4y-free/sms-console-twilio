import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import twilio from "twilio";
import { z } from "zod";
import type { SmsService } from "./sms-service.js";

interface AppDependencies {
  smsService: SmsService;
  apiKey: string;
  twilioAuthToken: string;
  publicBaseUrl: string;
  validateTwilioWebhooks: boolean;
  enableLocalUi: boolean;
}

const sendSmsSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use o formato E.164, por exemplo +5511999999999"),
  body: z.string().trim().min(1, "A mensagem nao pode estar vazia").max(1600, "A mensagem deve ter no maximo 1600 caracteres"),
}).strict();

const sendBroadcastSchema = z.object({
  recipients: z
    .array(z.string().regex(/^\+[1-9]\d{7,14}$/, "Todos os numeros devem usar o formato E.164"))
    .min(1, "A lista precisa ter pelo menos um destinatario")
    .max(100, "Cada envio aceita no maximo 100 destinatarios"),
  body: z.string().trim().min(1, "A mensagem nao pode estar vazia").max(1600, "A mensagem deve ter no maximo 1600 caracteres"),
}).strict();

function hasValidApiKey(received: string | undefined, expected: string): boolean {
  if (!received) return false;

  const providedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

function apiKeyMiddleware(apiKey: string): RequestHandler {
  return (request, response, next) => {
    const authorization = request.header("authorization");
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    const received = bearerToken ?? request.header("x-api-key");

    if (!hasValidApiKey(received, apiKey)) {
      response.status(401).json({ error: "Nao autorizado" });
      return;
    }

    next();
  };
}

function localOnlyMiddleware(enabled: boolean): RequestHandler {
  return (request, response, next) => {
    const remoteAddress = request.socket.remoteAddress;
    const isLoopback = remoteAddress === "127.0.0.1"
      || remoteAddress === "::1"
      || remoteAddress === "::ffff:127.0.0.1";

    if (!enabled || !isLoopback) {
      response.status(403).json({ error: "Envio pela interface disponivel apenas localmente" });
      return;
    }

    next();
  };
}

function twilioSignatureMiddleware(
  authToken: string,
  publicBaseUrl: string,
  validate: boolean,
): RequestHandler {
  return (request, response, next) => {
    if (!validate) {
      next();
      return;
    }

    const signature = request.header("x-twilio-signature");
    const requestUrl = publicBaseUrl
      ? `${publicBaseUrl}${request.originalUrl}`
      : `${request.protocol}://${request.get("host")}${request.originalUrl}`;

    if (!signature || !twilio.validateRequest(authToken, signature, requestUrl, request.body)) {
      response.status(403).json({ error: "Assinatura Twilio invalida" });
      return;
    }

    next();
  };
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.static(path.join(process.cwd(), "public"), { extensions: ["html"] }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const sendMessage: RequestHandler = async (request, response, next) => {
    try {
      const parsed = sendSmsSchema.safeParse(request.body);

      if (!parsed.success) {
        response.status(400).json({
          error: "Dados invalidos",
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const statusCallback = dependencies.publicBaseUrl
        ? `${dependencies.publicBaseUrl}/webhooks/twilio/message-status`
        : undefined;
      const message = await dependencies.smsService.send({
        ...parsed.data,
        ...(statusCallback ? { statusCallback } : {}),
      });

      response.status(201).json({ message });
    } catch (error) {
      next(error);
    }
  };

  const messageRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  app.post(
    "/v1/messages",
    messageRateLimit,
    express.json({ limit: "20kb" }),
    apiKeyMiddleware(dependencies.apiKey),
    sendMessage,
  );

  app.post(
    "/ui/messages",
    messageRateLimit,
    express.json({ limit: "20kb" }),
    localOnlyMiddleware(dependencies.enableLocalUi),
    sendMessage,
  );

  app.post(
    "/ui/broadcasts",
    messageRateLimit,
    express.json({ limit: "30kb" }),
    localOnlyMiddleware(dependencies.enableLocalUi),
    async (request, response, next) => {
      try {
        const parsed = sendBroadcastSchema.safeParse(request.body);

        if (!parsed.success) {
          response.status(400).json({
            error: "Dados invalidos",
            details: parsed.error.flatten().fieldErrors,
          });
          return;
        }

        const recipients = [...new Set(parsed.data.recipients)];
        const statusCallback = dependencies.publicBaseUrl
          ? `${dependencies.publicBaseUrl}/webhooks/twilio/message-status`
          : undefined;
        const results = [];

        for (const to of recipients) {
          try {
            const message = await dependencies.smsService.send({
              to,
              body: parsed.data.body,
              ...(statusCallback ? { statusCallback } : {}),
            });
            results.push({ ok: true as const, to, message });
          } catch (error) {
            if (error instanceof twilio.RestException) {
              results.push({
                ok: false as const,
                to,
                error: { code: error.code, message: error.message },
              });
              continue;
            }
            throw error;
          }
        }

        const sent = results.filter((item) => item.ok).length;
        const failed = results.length - sent;
        response.status(failed === 0 ? 201 : 207).json({
          summary: { total: results.length, sent, failed },
          results,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/ui/report",
    localOnlyMiddleware(dependencies.enableLocalUi),
    async (_request, response, next) => {
      try {
        response.json({ report: await dependencies.smsService.getReport() });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/webhooks/twilio/message-status",
    express.urlencoded({ extended: false }),
    twilioSignatureMiddleware(
      dependencies.twilioAuthToken,
      dependencies.publicBaseUrl,
      dependencies.validateTwilioWebhooks,
    ),
    (request, response) => {
      const event = {
        messageSid: request.body.MessageSid,
        messageStatus: request.body.MessageStatus,
        errorCode: request.body.ErrorCode || null,
        errorMessage: request.body.ErrorMessage || null,
      };

      console.info("Atualizacao de SMS recebida", event);
      response.sendStatus(204);
    },
  );

  app.use((_request, response) => {
    response.status(404).json({ error: "Rota nao encontrada" });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof twilio.RestException) {
      response.status(error.status || 502).json({
        error: "Falha no envio pela Twilio",
        twilio: {
          code: error.code,
          message: error.message,
          moreInfo: error.moreInfo,
        },
      });
      return;
    }

    console.error("Erro inesperado", error);
    response.status(500).json({ error: "Erro interno" });
  };

  app.use(errorHandler);
  return app;
}
