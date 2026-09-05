import request from "supertest";
import twilio from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { SmsFireSmsService, type SmsService } from "../src/sms-service.js";

const apiKey = "test_api_key_with_at_least_24_chars";

interface BuildAppOptions {
  enableLocalUi?: boolean;
  publicBaseUrl?: string;
  validateTwilioWebhooks?: boolean;
}

function buildApp(
  send = vi.fn<SmsService["send"]>(),
  getReport = vi.fn<NonNullable<SmsService["getReport"]>>(),
  smsFireService?: SmsService,
  options: BuildAppOptions = {},
) {
  const getMessageStatuses = vi.fn<NonNullable<SmsService["getMessageStatuses"]>>();
  send.mockResolvedValue({
    sid: "SM00000000000000000000000000000000",
    to: "+5511999999999",
    from: "+15005550006",
    status: "queued",
    dateCreated: "2026-09-01T12:00:00.000Z",
    provider: "twilio",
  });
  getReport.mockResolvedValue({
    sent: 10,
    delivered: 8,
    undelivered: 1,
    failed: 0,
    pending: 1,
    deliveryRate: 80,
    daily: [{ date: "2026-09-01", sent: 10, delivered: 8 }],
  });
  getMessageStatuses.mockResolvedValue([
    { sid: "SM00000000000000000000000000000000", status: "delivered" },
  ]);

  return {
    send,
    getReport,
    getMessageStatuses,
    app: createApp({
      smsProviders: {
        twilio: { send, getReport, getMessageStatuses },
        ...(smsFireService ? { smsfire: smsFireService } : {}),
      },
      apiKey,
      twilioAuthToken: "test-token",
      publicBaseUrl: options.publicBaseUrl ?? "",
      validateTwilioWebhooks: options.validateTwilioWebhooks ?? false,
      enableLocalUi: options.enableLocalUi ?? true,
    }),
  };
}

describe("API de SMS", () => {
  it("serve a interface web", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("SMS Console");
    expect(response.text).toContain("SMSFire");
    expect(response.text).toContain("Planos");
    expect(response.text).toContain("Scale");
    expect(response.text).toContain("US$ 0,0599");
    expect(response.text).toContain("Disparos por provedor");
    expect(response.text).toContain('name="theme-color"');
    expect(response.text).toContain('id="mobile-navigation"');
    expect(response.text).toContain('id="sidebar-backdrop"');
    expect(response.text).toContain('aria-controls="mobile-navigation"');
    expect(response.text).toContain('value="200000"');
    expect(response.text.indexOf('class="plan-row twilio-plan-row"'))
      .toBeGreaterThan(response.text.indexOf('data-plan="scale"'));
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("responde ao health check", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("informa quais provedores estao configurados", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/ui/providers");

    expect(response.status).toBe(200);
    expect(response.body.providers).toEqual([
      { id: "twilio", name: "Twilio", configured: true },
      { id: "smsfire", name: "SMSFire", configured: false },
    ]);
  });

  it("recusa disparos sem API key", async () => {
    const { app, send } = buildApp();
    const response = await request(app)
      .post("/v1/messages")
      .send({ to: "+5511999999999", body: "Ola" });

    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("valida numero e mensagem", async () => {
    const { app, send } = buildApp();
    const response = await request(app)
      .post("/v1/messages")
      .set("authorization", `Bearer ${apiKey}`)
      .send({ to: "11999999999", body: "" });

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("envia uma mensagem valida", async () => {
    const { app, send } = buildApp();
    const response = await request(app)
      .post("/v1/messages")
      .set("authorization", `Bearer ${apiKey}`)
      .send({ to: "+5511999999999", body: "Ola pela Twilio" });

    expect(response.status).toBe(201);
    expect(response.body.message.status).toBe("queued");
    expect(send).toHaveBeenCalledWith({
      to: "+5511999999999",
      body: "Ola pela Twilio",
    });
  });

  it("envia pela interface local sem expor a API key", async () => {
    const { app, send } = buildApp();
    const response = await request(app)
      .post("/ui/messages")
      .send({ to: "+5511999999999", body: "Envio pela interface" });

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith({
      to: "+5511999999999",
      body: "Envio pela interface",
    });
  });

  it("bloqueia as rotas locais quando a interface esta desativada", async () => {
    const { app, send } = buildApp(undefined, undefined, undefined, { enableLocalUi: false });
    const response = await request(app)
      .post("/ui/messages")
      .send({ to: "+5511999999999", body: "Envio bloqueado" });

    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("envia uma mensagem para todos os destinatarios da lista", async () => {
    const { app, send } = buildApp();
    const response = await request(app)
      .post("/ui/broadcasts")
      .send({
        recipients: ["+5511999999999", "+5511888888888"],
        body: "Mensagem para a lista",
      });

    expect(response.status).toBe(201);
    expect(response.body.summary).toEqual({ total: 2, sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("usa o endpoint em massa ao selecionar a SMSFire", async () => {
    const sendBulk = vi.fn<NonNullable<SmsService["sendBulk"]>>().mockResolvedValue([
      {
        sid: "smsfire-1",
        to: "+5511999999999",
        from: null,
        status: "queued",
        dateCreated: "2026-09-01T12:00:00.000Z",
        provider: "smsfire",
      },
      {
        sid: "smsfire-2",
        to: "+5511888888888",
        from: null,
        status: "queued",
        dateCreated: "2026-09-01T12:00:00.000Z",
        provider: "smsfire",
      },
    ]);
    const smsFireService: SmsService = {
      send: vi.fn<SmsService["send"]>(),
      sendBulk,
    };
    const { app, send } = buildApp(undefined, undefined, smsFireService);
    const response = await request(app)
      .post("/ui/broadcasts")
      .send({
        provider: "smsfire",
        recipients: ["+5511999999999", "+5511888888888"],
        body: "Mensagem pela SMSFire",
      });

    expect(response.status).toBe(201);
    expect(response.body.provider).toBe("smsfire");
    expect(response.body.summary).toEqual({ total: 2, sent: 2, failed: 0 });
    expect(sendBulk).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it("recusa a SMSFire quando as credenciais nao estao configuradas", async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post("/ui/broadcasts")
      .send({
        provider: "smsfire",
        recipients: ["+5511999999999"],
        body: "Mensagem pela SMSFire",
      });

    expect(response.status).toBe(503);
    expect(response.body.provider).toBe("smsfire");
  });

  it("retorna resultado parcial quando uma mensagem do lote falha", async () => {
    const sendBulk = vi.fn<NonNullable<SmsService["sendBulk"]>>().mockResolvedValue([
      {
        sid: "smsfire-ok",
        to: "+5511999999999",
        from: null,
        status: "queued",
        dateCreated: "2026-09-01T12:00:00.000Z",
        provider: "smsfire",
      },
      {
        sid: "smsfire-failed",
        to: "+5511888888888",
        from: null,
        status: "failed",
        dateCreated: "2026-09-01T12:00:00.000Z",
        provider: "smsfire",
      },
    ]);
    const { app } = buildApp(undefined, undefined, {
      send: vi.fn<SmsService["send"]>(),
      sendBulk,
    });
    const response = await request(app)
      .post("/ui/broadcasts")
      .send({
        provider: "smsfire",
        recipients: ["+5511999999999", "+5511888888888"],
        body: "Lote parcial",
      });

    expect(response.status).toBe(207);
    expect(response.body.summary).toEqual({ total: 2, sent: 1, failed: 1 });
    expect(response.body.results.map((item: { ok: boolean }) => item.ok)).toEqual([true, false]);
  });

  it("limita a quantidade de requisicoes de envio por minuto", async () => {
    const { app } = buildApp();
    const statuses = [];

    for (let index = 0; index < 11; index += 1) {
      const response = await request(app)
        .post("/ui/messages")
        .send({ to: "+5511999999999", body: `Mensagem ${index}` });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("retorna o relatorio de entrega da Twilio", async () => {
    const { app, getReport } = buildApp();
    const response = await request(app).get("/ui/report");

    expect(response.status).toBe(200);
    expect(response.body.report.deliveryRate).toBe(80);
    expect(getReport).toHaveBeenCalledOnce();
  });

  it("consulta os status atuais das mensagens da Twilio", async () => {
    const { app, getMessageStatuses } = buildApp();
    const sids = ["SM00000000000000000000000000000000"];
    const response = await request(app)
      .post("/ui/message-statuses")
      .send({ sids });

    expect(response.status).toBe(200);
    expect(response.body.messages).toEqual([{ sid: sids[0], status: "delivered" }]);
    expect(getMessageStatuses).toHaveBeenCalledWith(sids);
  });

  it("rejeita SIDs invalidos na consulta de status", async () => {
    const { app, getMessageStatuses } = buildApp();
    const response = await request(app)
      .post("/ui/message-statuses")
      .send({ sids: ["message-invalida"] });

    expect(response.status).toBe(400);
    expect(getMessageStatuses).not.toHaveBeenCalled();
  });

  it("consulta uma mensagem pendente da SMSFire", async () => {
    const getMessageStatuses = vi.fn<NonNullable<SmsService["getMessageStatuses"]>>()
      .mockResolvedValue([{ sid: "smsfire-message-1", status: "delivered" }]);
    const { app } = buildApp(undefined, undefined, {
      send: vi.fn<SmsService["send"]>(),
      getMessageStatuses,
    });
    const response = await request(app)
      .post("/ui/message-statuses")
      .send({ provider: "smsfire", sids: ["smsfire-message-1"] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      provider: "smsfire",
      messages: [{ sid: "smsfire-message-1", status: "delivered" }],
    });
    expect(getMessageStatuses).toHaveBeenCalledWith(["smsfire-message-1"]);
  });

  it("limita a consulta da SMSFire a uma mensagem por ciclo", async () => {
    const getMessageStatuses = vi.fn<NonNullable<SmsService["getMessageStatuses"]>>();
    const { app } = buildApp(undefined, undefined, {
      send: vi.fn<SmsService["send"]>(),
      getMessageStatuses,
    });
    const response = await request(app)
      .post("/ui/message-statuses")
      .send({ provider: "smsfire", sids: ["message-1", "message-2"] });

    expect(response.status).toBe(400);
    expect(getMessageStatuses).not.toHaveBeenCalled();
  });

  it("aceita callback de status quando a validacao esta desativada em teste", async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post("/webhooks/twilio/message-status")
      .type("form")
      .send({ MessageSid: "SM123", MessageStatus: "delivered" });

    expect(response.status).toBe(204);
  });

  it("valida uma assinatura Twilio real no webhook", async () => {
    const publicBaseUrl = "https://sms.example.com";
    const webhookUrl = `${publicBaseUrl}/webhooks/twilio/message-status`;
    const payload = { MessageSid: "SM123", MessageStatus: "delivered" };
    const signature = twilio.getExpectedTwilioSignature("test-token", webhookUrl, payload);
    const { app } = buildApp(undefined, undefined, undefined, {
      publicBaseUrl,
      validateTwilioWebhooks: true,
    });

    const validResponse = await request(app)
      .post("/webhooks/twilio/message-status")
      .set("x-twilio-signature", signature)
      .type("form")
      .send(payload);
    const invalidResponse = await request(app)
      .post("/webhooks/twilio/message-status")
      .set("x-twilio-signature", "assinatura-invalida")
      .type("form")
      .send(payload);

    expect(validResponse.status).toBe(204);
    expect(invalidResponse.status).toBe(403);
  });
});

describe("Cliente SMSFire", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("autentica e envia o lote no formato da API v3", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      batchId: "batch-1",
      messages: [{ id: "message-1", statusCode: 0, statusName: "ENROUTE" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new SmsFireSmsService("usuario", "token", "https://api-v3.smsfire.com.br");

    const messages = await service.sendBulk([{ to: "+5511999999999", body: "Mensagem de teste" }]);

    expect(messages[0]).toMatchObject({
      sid: "message-1",
      to: "+5511999999999",
      status: "queued",
      provider: "smsfire",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-v3.smsfire.com.br/sms/send/bulk",
      expect.objectContaining({
        method: "POST",
        headers: {
          Api_Token: "token",
          "Content-Type": "application/json",
          Username: "usuario",
        },
        body: JSON.stringify({ messages: [{ to: "5511999999999", text: "Mensagem de teste" }] }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("interrompe a chamada quando a SMSFire excede o timeout", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("Tempo esgotado", "TimeoutError"),
    ));
    const service = new SmsFireSmsService(
      "usuario",
      "token",
      "https://api-v3.smsfire.com.br",
      1_000,
    );

    await expect(service.sendBulk([{ to: "+5511999999999", body: "Mensagem de teste" }]))
      .rejects.toMatchObject({ provider: "smsfire", status: 504 });
  });

  it("consulta e normaliza o status de entrega da SMSFire", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "019adf54-2b62-747d-a9e4-ae3a8239fb27",
      statusCode: 2,
      statusName: "DELIVRD",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new SmsFireSmsService("usuario", "token", "https://api-v3.smsfire.com.br");

    const statuses = await service.getMessageStatuses?.([
      "019adf54-2b62-747d-a9e4-ae3a8239fb27",
    ]);

    expect(statuses).toEqual([{
      sid: "019adf54-2b62-747d-a9e4-ae3a8239fb27",
      status: "delivered",
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-v3.smsfire.com.br/sms/status/message/019adf54-2b62-747d-a9e4-ae3a8239fb27",
      {
        headers: { Api_Token: "token", Username: "usuario" },
        signal: expect.any(AbortSignal),
      },
    );
  });
});
