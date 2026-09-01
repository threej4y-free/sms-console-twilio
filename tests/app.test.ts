import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { SmsFireSmsService, type SmsService } from "../src/sms-service.js";

const apiKey = "test_api_key_with_at_least_24_chars";

function buildApp(
  send = vi.fn<SmsService["send"]>(),
  getReport = vi.fn<NonNullable<SmsService["getReport"]>>(),
  smsFireService?: SmsService,
) {
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

  return {
    send,
    getReport,
    app: createApp({
      smsProviders: {
        twilio: { send, getReport },
        ...(smsFireService ? { smsfire: smsFireService } : {}),
      },
      apiKey,
      twilioAuthToken: "test-token",
      publicBaseUrl: "",
      validateTwilioWebhooks: false,
      enableLocalUi: true,
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

  it("retorna o relatorio de entrega da Twilio", async () => {
    const { app, getReport } = buildApp();
    const response = await request(app).get("/ui/report");

    expect(response.status).toBe(200);
    expect(response.body.report.deliveryRate).toBe(80);
    expect(getReport).toHaveBeenCalledOnce();
  });

  it("aceita callback de status quando a validacao esta desativada em teste", async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post("/webhooks/twilio/message-status")
      .type("form")
      .send({ MessageSid: "SM123", MessageStatus: "delivered" });

    expect(response.status).toBe(204);
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
      }),
    );
  });
});
