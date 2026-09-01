import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { SmsService } from "../src/sms-service.js";

const apiKey = "test_api_key_with_at_least_24_chars";

function buildApp(
  send = vi.fn<SmsService["send"]>(),
  getReport = vi.fn<SmsService["getReport"]>(),
) {
  send.mockResolvedValue({
    sid: "SM00000000000000000000000000000000",
    to: "+5511999999999",
    from: "+15005550006",
    status: "queued",
    dateCreated: "2026-09-01T12:00:00.000Z",
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
      smsService: { send, getReport },
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
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("responde ao health check", async () => {
    const { app } = buildApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
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
