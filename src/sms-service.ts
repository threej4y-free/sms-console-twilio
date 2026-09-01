import twilio, { type Twilio } from "twilio";

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
  getReport(): Promise<MessageReport>;
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
