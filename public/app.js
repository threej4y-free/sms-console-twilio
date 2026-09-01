const STORAGE_LISTS = "sms.console.lists";
const STORAGE_MESSAGES = "sms.console.messages";

const form = document.querySelector("#sms-form");
const listSelect = document.querySelector("#recipient-list");
const listTrigger = document.querySelector("#recipient-list-trigger");
const listMenu = document.querySelector("#recipient-list-menu");
const selectedListCount = document.querySelector("#selected-list-count");
const messageInput = document.querySelector("#message");
const count = document.querySelector("#character-count");
const submitButton = document.querySelector("#submit-button");
const result = document.querySelector("#result");
const resultTitle = document.querySelector("#result-title");
const resultMessage = document.querySelector("#result-message");
const listForm = document.querySelector("#recipient-form");
const listTable = document.querySelector("#recipient-table");
const listEmpty = document.querySelector("#recipient-empty");
const messageTable = document.querySelector("#message-table");
const messageEmpty = document.querySelector("#message-empty");
const providerInput = document.querySelector("#sms-provider");
const providerOptions = document.querySelector("#provider-options");
const providerSummary = document.querySelector("#provider-summary");
const planVolume = document.querySelector("#plan-volume");

const providerNames = { twilio: "Twilio", smsfire: "SMSFire" };
let providers = [
  { id: "twilio", name: "Twilio", configured: true },
  { id: "smsfire", name: "SMSFire", configured: false },
];

let lists = readStorage(STORAGE_LISTS);
let messages = readStorage(STORAGE_MESSAGES);

function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePhone(value) {
  return value.replace(/[\s()-]/g, "");
}

function parsePhones(value) {
  return [...new Set(
    value
      .split(/[\n,;]+/)
      .map(normalizePhone)
      .filter(Boolean),
  )];
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function navigate(view) {
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.nav === view);
  });
  document.body.classList.remove("menu-open");
  document.querySelector("#mobile-menu").setAttribute("aria-expanded", "false");
  const hashes = { compose: "envio", recipients: "destinatarios", messages: "relatorio", plans: "planos" };
  window.location.hash = hashes[view] || "envio";
  if (view === "messages") loadReport();
}

document.querySelectorAll("[data-nav]").forEach((control) => {
  control.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(control.dataset.nav);
  });
});

document.querySelector("#mobile-menu").addEventListener("click", (event) => {
  const open = document.body.classList.toggle("menu-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

messageInput.addEventListener("input", () => {
  count.textContent = `${messageInput.value.length} / ${messageInput.maxLength}`;
});

function selectProvider(providerId) {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider?.configured) return;

  providerInput.value = providerId;
  providerOptions.querySelectorAll("[data-provider]").forEach((option) => {
    const selected = option.dataset.provider === providerId;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", String(selected));
  });

  const isSmsFire = providerId === "smsfire";
  messageInput.maxLength = isSmsFire ? 765 : 1600;
  document.querySelector("#selected-provider-name").textContent = provider.name;
  document.querySelector("#selected-provider-status").textContent = "Configurado no servidor";
  document.querySelector("#selected-provider-plan").textContent = isSmsFire ? "A partir de R$ 0,10/SMS" : "Conta Twilio";
  messageInput.dispatchEvent(new Event("input"));
}

providerOptions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-provider]");
  if (option) selectProvider(option.dataset.provider);
});

async function loadProviders() {
  try {
    const response = await fetch("/ui/providers");
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.providers)) throw new Error();
    providers = payload.providers;

    providerOptions.querySelectorAll("[data-provider]").forEach((option) => {
      const provider = providers.find((item) => item.id === option.dataset.provider);
      const configured = Boolean(provider?.configured);
      option.disabled = !configured;
      option.querySelector(".provider-state").textContent = configured ? "Disponível" : "Configurar";
    });

    const configuredCount = providers.filter((provider) => provider.configured).length;
    providerSummary.textContent = `${configuredCount} ${configuredCount === 1 ? "provedor configurado" : "provedores configurados"}`;

    const current = providers.find((provider) => provider.id === providerInput.value && provider.configured);
    selectProvider(current?.id || providers.find((provider) => provider.configured)?.id || "twilio");
  } catch {
    providerSummary.textContent = "Status indisponível";
  }
}

listSelect.addEventListener("change", () => {
  const list = lists.find((item) => item.id === listSelect.value);
  listTrigger.querySelector("span").textContent = list ? list.name : "Selecione uma lista";
  selectedListCount.textContent = list
    ? `${list.numbers.length} ${list.numbers.length === 1 ? "destinatário" : "destinatários"}`
    : "Nenhuma lista selecionada";
});

listTrigger.addEventListener("click", () => {
  const open = listMenu.hidden;
  listMenu.hidden = !open;
  listTrigger.setAttribute("aria-expanded", String(open));
});

listMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-list-option]");
  if (!option) return;
  listSelect.value = option.dataset.listOption;
  listSelect.dispatchEvent(new Event("change"));
  listMenu.hidden = true;
  listTrigger.setAttribute("aria-expanded", "false");
  renderLists();
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".list-picker")) return;
  listMenu.hidden = true;
  listTrigger.setAttribute("aria-expanded", "false");
});

function showResult(type, title, message) {
  result.hidden = false;
  result.classList.toggle("error", type === "error");
  resultTitle.textContent = title;
  resultMessage.textContent = message;
}

function errorMessage(payload, fallback) {
  if (payload?.twilio?.message) {
    const code = payload.twilio.code ? `código ${payload.twilio.code}: ` : "";
    return `${code}${payload.twilio.message}`;
  }
  if (payload?.providerError?.message) return payload.providerError.message;
  if (payload?.details) return Object.values(payload.details).flat().join(" ");
  return payload?.error || fallback;
}

function renderLists() {
  listTable.innerHTML = lists.map((list) => `
    <tr>
      <td>${escapeHtml(list.name)}</td>
      <td class="muted">${list.numbers.length} ${list.numbers.length === 1 ? "número" : "números"}</td>
      <td class="muted">${formatDate(list.createdAt)}</td>
      <td><span class="row-actions"><button class="row-button" type="button" data-use-list="${list.id}">Usar</button><button class="row-button delete" type="button" data-delete-list="${list.id}">Excluir</button></span></td>
    </tr>
  `).join("");

  const selected = listSelect.value;
  listMenu.innerHTML = lists.length > 0
    ? lists.map((list) => `<button class="list-picker-option ${selected === list.id ? "active" : ""}" type="button" role="menuitem" data-list-option="${list.id}"><span>${escapeHtml(list.name)}</span><small>${list.numbers.length} ${list.numbers.length === 1 ? "número" : "números"}</small></button>`).join("")
    : `<div class="list-picker-empty">Nenhuma lista cadastrada</div>`;
  if (!lists.some((list) => list.id === selected)) listSelect.value = "";

  listEmpty.hidden = lists.length > 0;
  document.querySelector("#recipient-nav-count").textContent = String(lists.length).padStart(2, "0");
  listSelect.dispatchEvent(new Event("change"));
}

function renderMessages() {
  messageTable.innerHTML = messages.map((message) => `
    <tr>
      <td class="muted">${escapeHtml(message.to)}</td>
      <td class="message-preview" title="${escapeHtml(message.body)}">${escapeHtml(message.body)}</td>
      <td><span class="provider-label ${message.provider === "smsfire" ? "smsfire" : "twilio"}">${escapeHtml(providerNames[message.provider] || message.provider || "Twilio")}</span></td>
      <td><span class="status-label ${message.status === "falhou" || message.status === "failed" ? "failed" : ""}">${escapeHtml(formatStatus(message.status))}</span></td>
      <td class="muted">${formatDate(message.createdAt)}</td>
    </tr>
  `).join("");
  messageEmpty.hidden = messages.length > 0;
  document.querySelector("#message-nav-count").textContent = String(messages.length).padStart(2, "0");
  renderProviderReport();
}

function formatStatus(status) {
  const labels = {
    queued: "Na fila",
    accepted: "Aceita",
    sending: "Enviando",
    sent: "Enviada",
    delivered: "Entregue",
    undelivered: "Não entregue",
    failed: "Falhou",
    falhou: "Falhou",
  };
  return labels[status] || status;
}

listForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nameInput = document.querySelector("#list-name");
  const numbersInput = document.querySelector("#list-numbers");
  const name = nameInput.value.trim();
  const numbers = parsePhones(numbersInput.value);
  const invalid = numbers.find((phone) => !/^\+[1-9]\d{7,14}$/.test(phone));

  if (!name || numbers.length === 0 || invalid) {
    numbersInput.setCustomValidity(
      invalid
        ? `${invalid} não está no formato internacional.`
        : "Adicione pelo menos um número no formato internacional.",
    );
    listForm.reportValidity();
    numbersInput.setCustomValidity("");
    return;
  }

  const existing = lists.find((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
  if (existing) {
    existing.numbers = numbers;
    existing.updatedAt = new Date().toISOString();
  } else {
    lists.unshift({ id: crypto.randomUUID(), name, numbers, createdAt: new Date().toISOString() });
  }

  writeStorage(STORAGE_LISTS, lists);
  renderLists();
  nameInput.value = "";
  numbersInput.value = "";
  nameInput.focus();
});

listTable.addEventListener("click", (event) => {
  const useButton = event.target.closest("[data-use-list]");
  const deleteButton = event.target.closest("[data-delete-list]");

  if (useButton) {
    listSelect.value = useButton.dataset.useList;
    listSelect.dispatchEvent(new Event("change"));
    navigate("compose");
    messageInput.focus();
  }

  if (deleteButton) {
    lists = lists.filter((item) => item.id !== deleteButton.dataset.deleteList);
    writeStorage(STORAGE_LISTS, lists);
    renderLists();
  }
});

function chartLabel(date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit" })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "");
}

function providerReportDays() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - (6 - index),
    ));
    return { date: date.toISOString().slice(0, 10), twilio: 0, smsfire: 0 };
  });
}

function renderProviderReport() {
  const daily = providerReportDays();
  const byDate = new Map(daily.map((day) => [day.date, day]));

  for (const message of messages) {
    const date = new Date(message.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const day = byDate.get(date.toISOString().slice(0, 10));
    if (!day) continue;
    const provider = message.provider === "smsfire" ? "smsfire" : "twilio";
    day[provider] += 1;
  }

  const twilioTotal = daily.reduce((total, day) => total + day.twilio, 0);
  const smsFireTotal = daily.reduce((total, day) => total + day.smsfire, 0);
  const maximum = Math.max(1, ...daily.flatMap((day) => [day.twilio, day.smsfire]));
  document.querySelector("#twilio-sent-count").textContent = twilioTotal;
  document.querySelector("#smsfire-sent-count").textContent = smsFireTotal;
  document.querySelector("#provider-total-count").textContent = twilioTotal + smsFireTotal;
  document.querySelector("#provider-chart").innerHTML = daily.map((day) => `
    <div class="chart-day">
      <div class="chart-bars" aria-label="${escapeHtml(chartLabel(day.date))}: ${day.twilio} pela Twilio, ${day.smsfire} pela SMSFire">
        <span class="chart-value">${day.twilio + day.smsfire || ""}</span>
        <i class="bar twilio" style="height:${(day.twilio / maximum) * 100}%"></i>
        <i class="bar smsfire" style="height:${(day.smsfire / maximum) * 100}%"></i>
      </div>
      <span class="chart-label">${escapeHtml(chartLabel(day.date))}</span>
    </div>
  `).join("");
}

function renderReport(report) {
  document.querySelector("#sent-count").textContent = report.sent;
  document.querySelector("#delivered-count").textContent = report.delivered;
  document.querySelector("#delivery-rate").textContent = `${report.deliveryRate}%`;

  const maximum = Math.max(1, ...report.daily.flatMap((day) => [day.sent, day.delivered]));
  document.querySelector("#delivery-chart").innerHTML = report.daily.map((day) => `
    <div class="chart-day">
      <div class="chart-bars" aria-label="${escapeHtml(chartLabel(day.date))}: ${day.sent} enviadas, ${day.delivered} entregues">
        <span class="chart-value">${day.sent || ""}</span>
        <i class="bar sent" style="height:${(day.sent / maximum) * 100}%"></i>
        <i class="bar delivered" style="height:${(day.delivered / maximum) * 100}%"></i>
      </div>
      <span class="chart-label">${escapeHtml(chartLabel(day.date))}</span>
    </div>
  `).join("");

  document.querySelector("#report-note").textContent =
    `${report.undelivered} não entregues · ${report.failed} falharam · ${report.pending} em processamento`;
}

async function loadReport() {
  try {
    const response = await fetch("/ui/report");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    renderReport(payload.report);
  } catch {
    document.querySelector("#report-note").textContent = "Não foi possível consultar o relatório agora.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.hidden = true;
  const list = lists.find((item) => item.id === listSelect.value);
  const body = messageInput.value.trim();
  const provider = providerInput.value;

  if (!list || !body) {
    showResult("error", "Revise os campos", "Selecione uma lista e escreva a mensagem.");
    return;
  }

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = `Disparando 0/${list.numbers.length}`;

  try {
    const response = await fetch("/ui/broadcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: list.numbers, body, provider }),
    });
    const payload = await response.json();

    if (!response.ok) {
      showResult("error", "Envio recusado", errorMessage(payload, "A Twilio recusou a solicitação."));
      return;
    }

    for (const item of payload.results) {
      messages.unshift({
        id: item.ok ? item.message.sid : crypto.randomUUID(),
        to: item.to,
        body,
        provider: payload.provider || provider,
        status: item.ok ? item.message.status : "falhou",
        createdAt: item.ok && item.message.dateCreated ? item.message.dateCreated : new Date().toISOString(),
      });
    }
    messages = messages.slice(0, 100);
    writeStorage(STORAGE_MESSAGES, messages);
    renderMessages();

    if (payload.summary.failed > 0) {
      showResult(
        "error",
        "Envio concluído com falhas",
        `${payload.summary.sent} enviados · ${payload.summary.failed} recusados`,
      );
    } else {
      showResult("success", "Disparo concluído", `${payload.summary.sent} mensagens aceitas pela ${providerNames[provider]}.`);
      messageInput.value = "";
      messageInput.dispatchEvent(new Event("input"));
    }
    loadReport();
  } catch {
    showResult("error", "Servidor indisponível", "Confirme se a aplicação está em execução e tente novamente.");
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Disparar mensagens";
  }
});

const plans = {
  avulso: { name: "Avulso", monthly: 0, rate: 0.10 },
  starter: { name: "Starter", monthly: 149, rate: 0.088 },
  growth: { name: "Growth", monthly: 599, rate: 0.08 },
  scale: { name: "Scale", monthly: 1499, rate: 0.076 },
};

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatUsd(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(value);
}

function updatePlanEstimate() {
  const volume = Math.max(0, Math.min(10_000_000, Number(planVolume.value) || 0));
  const totals = Object.entries(plans).map(([id, plan]) => ({
    id,
    name: plan.name,
    total: plan.monthly + (volume * plan.rate),
  }));
  const best = totals.reduce((lowest, item) => item.total < lowest.total ? item : lowest);

  for (const item of totals) {
    document.querySelector(`[data-plan-total="${item.id}"]`).textContent = formatCurrency(item.total);
    document.querySelector(`[data-plan="${item.id}"]`).classList.toggle("best-plan", item.id === best.id);
  }

  document.querySelector("#plan-recommendation").innerHTML =
    `<strong>Para ${formatNumber(volume)} SMS:</strong> o plano ${best.name} tem o menor custo estimado na SMSFire.`;
  document.querySelector("#twilio-volume-total").textContent = formatUsd(volume * 0.0599);
}

planVolume.addEventListener("input", updatePlanEstimate);
document.querySelector("#copy-coupon").addEventListener("click", async (event) => {
  const label = event.currentTarget.querySelector("small");
  try {
    await navigator.clipboard.writeText("FIRE5");
    label.textContent = "Copiado";
    window.setTimeout(() => { label.textContent = "5% de desconto"; }, 1600);
  } catch {
    label.textContent = "5% de desconto";
  }
});

const initialHash = window.location.hash.replace("#", "");
navigate(initialHash === "destinatarios" ? "recipients" : initialHash === "relatorio" ? "messages" : initialHash === "planos" ? "plans" : "compose");
renderLists();
renderMessages();
updatePlanEstimate();
loadProviders();
