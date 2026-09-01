import twilio, { type Twilio } from "twilio";

export const smsProviderIds = ["twilio", "smsfire"] as const;
export type SmsProviderId = (typeof smsProviderIds)[number];

export interface SendSmsInput {
  to: string;
  body: string;
  statusCallback?: string;
}

export interface SentSms {
  sid: string;
  to: string;
  from: string | null;
  status: string;
  dateCreated: string | null;
  provider: SmsProviderId;
}

export interface MessageReportDay {
  date: string;
  sent: number;
  delivered: number;
}

export interface MessageReport {
  sent: number;
  delivered: number;
  undelivered: number;
  failed: number;
  pending: number;
  deliveryRate: number;
  daily: MessageReportDay[];
}

export interface SmsService {
  send(input: SendSmsInput): Promise<SentSms>;
  sendBulk?(inputs: SendSmsInput[]): Promise<SentSms[]>;
  getReport?(): Promise<MessageReport>;
}

export class SmsProviderError extends Error {
  constructor(
    public readonly provider: SmsProviderId,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

export class TwilioSmsService implements SmsService {
  private readonly client: Twilio;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly from: string,
  ) {
    this.client = twilio(accountSid, authToken);
  }

  async send(input: SendSmsInput): Promise<SentSms> {
    const message = await this.client.messages.create({
      body: input.body,
      to: input.to,
      from: this.from,
      ...(input.statusCallback ? { statusCallback: input.statusCallback } : {}),
    });

    return {
      sid: message.sid,
      to: message.to,
      from: message.from,
      status: message.status,
      dateCreated: message.dateCreated?.toISOString() ?? null,
      provider: "twilio",
    };
  }

  async getReport(): Promise<MessageReport> {
    const messages = await this.client.messages.list({ limit: 1000 });
    const outbound = messages.filter((message) => message.direction.startsWith("outbound"));
    const today = new Date();
    const daily = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - (6 - index),
      ));
      return { date: date.toISOString().slice(0, 10), sent: 0, delivered: 0 };
    });
    const byDate = new Map(daily.map((day) => [day.date, day]));
    const firstDay = daily[0]?.date;
    const periodMessages = outbound.filter((message) => {
      const timestamp = message.dateSent ?? message.dateCreated;
      return timestamp && firstDay && timestamp.toISOString().slice(0, 10) >= firstDay;
    });
    const delivered = periodMessages.filter((message) => message.status === "delivered").length;
    const undelivered = periodMessages.filter((message) => message.status === "undelivered").length;
    const failed = periodMessages.filter((message) => message.status === "failed").length;
    const pending = periodMessages.length - delivered - undelivered - failed;

    for (const message of outbound) {
      const timestamp = message.dateSent ?? message.dateCreated;
      if (!timestamp) continue;
      const day = byDate.get(timestamp.toISOString().slice(0, 10));
      if (!day) continue;
      day.sent += 1;
      if (message.status === "delivered") day.delivered += 1;
    }

    return {
      sent: periodMessages.length,
      delivered,
      undelivered,
      failed,
      pending,
      deliveryRate: periodMessages.length > 0 ? Math.round((delivered / periodMessages.length) * 1000) / 10 : 0,
      daily,
    };
  }
}

interface SmsFireMessageResponse {
  id?: string;
  statusCode?: number;
  statusName?: string;
}

interface SmsFireBulkResponse {
  batchId?: string;
  messages?: SmsFireMessageResponse[];
}

function normalizeSmsFireStatus(statusName: string | undefined): string {
  const status = statusName?.toUpperCase();
  const statusMap: Record<string, string> = {
    ACCEPTD: "accepted",
    ENROUTE: "queued",
    SENT: "sent",
    DELIVRD: "delivered",
    UNDELIV: "undelivered",
    EXPIRED: "undelivered",
    REJECTD: "failed",
    DELETED: "failed",
    UNKNOWN: "failed",
  };

  return status ? (statusMap[status] ?? status.toLowerCase()) : "queued";
}

export class SmsFireSmsService implements SmsService {
  constructor(
    private readonly username: string,
    private readonly apiToken: string,
    private readonly baseUrl = "https://api-v3.smsfire.com.br",
  ) {}

  async send(input: SendSmsInput): Promise<SentSms> {
    const [message] = await this.sendBulk([input]);
    if (!message) {
      throw new SmsProviderError("smsfire", 502, "A SMSFire nao retornou os dados da mensagem");
    }
    return message;
  }

  async sendBulk(inputs: SendSmsInput[]): Promise<SentSms[]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/sms/send/bulk`, {
      method: "POST",
      headers: {
        "Api_Token": this.apiToken,
        "Content-Type": "application/json",
        "Username": this.username,
      },
      body: JSON.stringify({
        messages: inputs.map((input) => ({
          to: input.to.replace(/^\+/, ""),
          text: input.body,
        })),
      }),
    });

    const payload = await response.json().catch(() => null) as SmsFireBulkResponse | { message?: string } | null;

    if (!response.ok) {
      const providerMessage = payload && "message" in payload ? payload.message : undefined;
      throw new SmsProviderError(
        "smsfire",
        response.status,
        providerMessage || "A SMSFire recusou a solicitacao",
        payload,
      );
    }

    const responseMessages = payload && "messages" in payload ? payload.messages : undefined;
    if (!responseMessages || responseMessages.length !== inputs.length) {
      throw new SmsProviderError("smsfire", 502, "Resposta inesperada da SMSFire", payload);
    }

    const dateCreated = new Date().toISOString();
    const batchId = payload && "batchId" in payload ? payload.batchId : undefined;
    return responseMessages.map((message, index) => ({
      sid: message.id || `${batchId ?? "smsfire"}-${index + 1}`,
      to: inputs[index]!.to,
      from: null,
      status: normalizeSmsFireStatus(message.statusName),
      dateCreated,
      provider: "smsfire",
    }));
  }
}
