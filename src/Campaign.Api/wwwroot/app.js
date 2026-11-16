"use strict";
const $ = id => document.getElementById(id);
const state = { selected: null, page: 1, campaignPage: 1, filter: "", refreshing: false, busy: false };
const labels = { Draft: "Bản nháp", Running: "Đang gửi", Completed: "Hoàn tất", CompletedWithErrors: "Hoàn tất có lỗi", Pending: "Đang chờ", Processing: "Đang xử lý", RetryScheduled: "Chờ thử lại", Sent: "Đã gửi", Failed: "Thất bại", Interrupted: "Bị gián đoạn" };
const date = value => value ? new Date(value).toLocaleString("vi-VN") : "—";
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function notice(message, error = false) { $("notice").textContent = message; $("notice").className = error ? "error" : ""; $("notice").hidden = false; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.errors ? Object.values(data.errors).flat().join(" ") : data.error || data.title || `Lỗi HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}
function badge(status) { return node("span", labels[status] || status, "badge " + status); }
async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const campaigns = await api(`/campaigns?page=${state.campaignPage}&pageSize=5`);
    const list = $("campaign-list"); list.replaceChildren();
    if (!campaigns.length) list.append(node("p", "Chưa có chiến dịch ở trang này. Tạo bản nháp để bắt đầu.", "empty"));
    for (const campaign of campaigns) {
      const card = node("button", undefined, "campaign-card" + (state.selected === campaign.id ? " active" : ""));
      const title = node("div", undefined, "card-title"); title.append(node("strong", campaign.name), badge(campaign.status));
      const meta = node("div", undefined, "card-meta"); meta.append(node("span", `${campaign.total} người nhận · ${campaign.sent} đã gửi`), node("span", date(campaign.createdAt)));
      card.append(title, meta); card.onclick = () => { state.selected = campaign.id; state.page = 1; loadDetails().catch(showError); }; list.append(card);
    }
    $("campaign-page").textContent = `Trang ${state.campaignPage}`;
    $("campaign-prev").disabled = state.campaignPage <= 1;
    $("campaign-next").disabled = campaigns.length < 5;
    if (state.selected) await loadDetails();
  } catch (error) { showError(error); } finally { state.refreshing = false; }
}
async function loadDetails() {
  const selected = state.selected, page = state.page, filter = state.filter;
  if (!selected) return;
  const [campaign, deliveries] = await Promise.all([
    api(`/campaigns/${selected}`),
    api(`/campaigns/${selected}/deliveries?page=${page}&pageSize=10&status=${filter}`)
  ]);
  if (selected !== state.selected || page !== state.page || filter !== state.filter) return;
  $("details").hidden = false; $("detail-name").textContent = campaign.name;
  $("detail-id").textContent = `${labels[campaign.status]} · ID: ${campaign.id}`;
  for (const key of ["total", "pending", "sent", "failed"]) $(key).textContent = campaign[key];
  $("progress").value = campaign.total ? (campaign.sent + campaign.failed) / campaign.total * 100 : 0;
  $("start").disabled = state.busy || campaign.status !== "Draft";
  $("retry").disabled = state.busy || campaign.failed === 0;
  const tbody = $("delivery-list"); tbody.replaceChildren();
  for (const delivery of deliveries) {
    const row = node("tr"); row.append(node("td", delivery.address));
    const status = node("td"); status.append(badge(delivery.status)); row.append(status);
    row.append(node("td", String(delivery.totalAttempts)), node("td", delivery.lastError || (delivery.sentAt ? date(delivery.sentAt) : "—")));
    const cell = node("td"), button = node("button", "Xem", "secondary"); button.onclick = () => history(selected, delivery.id).catch(showError); cell.append(button); row.append(cell); tbody.append(row);
  }
  if (!deliveries.length) { const row = node("tr"), cell = node("td", "Không có kết quả phù hợp.", "empty"); cell.colSpan = 5; row.append(cell); tbody.append(row); }
  $("page-label").textContent = `Trang ${page}`; $("prev").disabled = page <= 1; $("next").disabled = deliveries.length < 10;
}
function showError(error) { notice(error.name === "TimeoutError" ? "API phản hồi quá lâu. Vui lòng thử lại." : error.message, true); }
async function history(campaign, delivery) {
  const attempts = await api(`/campaigns/${campaign}/deliveries/${delivery}/attempts`), content = $("history-content"); content.replaceChildren();
  if (!attempts.length) content.append(node("p", "Chưa có lần gửi nào."));
  for (const attempt of attempts) {
    const item = node("div", undefined, "attempt"); item.append(badge(attempt.outcome), node("p", `Phiên ${attempt.generation} · Worker ${attempt.workerId}`), node("p", `${date(attempt.startedAt)} → ${date(attempt.finishedAt)}`));
    if (attempt.error) item.append(node("p", attempt.error)); content.append(item);
  }
  if (!$("history").open) $("history").showModal();
}
$("create-form").onsubmit = async event => {
  event.preventDefault(); $("create-button").disabled = true;
  try {
    const recipients = $("recipients").value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
    const result = await api("/campaigns", { method: "POST", body: JSON.stringify({ name: $("name").value, subject: $("subject").value, body: $("body").value, recipients }) });
    state.selected = result.id; state.page = 1; state.campaignPage = 1;
    notice(`Đã tạo bản nháp với ${result.recipientCount} người nhận. Chọn “Bắt đầu gửi” để chạy.`); await refresh();
  } catch (error) { showError(error); } finally { $("create-button").disabled = false; }
};
for (const [button, action, message] of [["start", "start", "Đã tiếp nhận yêu cầu gửi."], ["retry", "retry-failed", "Đã đưa các job thất bại vào lần gửi mới."]]) {
  $(button).onclick = async () => {
    if (state.busy || !state.selected) return;
    state.busy = true; $("start").disabled = true; $("retry").disabled = true;
    try { await api(`/campaigns/${state.selected}/${action}`, { method: "POST" }); notice(message); }
    catch (error) { showError(error); }
    finally { state.busy = false; await refresh(); }
  };
}
$("sample").onclick = () => { $("recipients").value = "an@example.test\nbinh@example.test\nretry+demo@example.test\nfail+demo@example.test"; };
$("import-file").onchange = async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 1024 * 1024) throw new Error("Tệp vượt quá 1 MB."); $("recipients").value = await file.text(); }
  catch (error) { showError(error); }
};
$("filter").onchange = () => { state.filter = $("filter").value; state.page = 1; loadDetails().catch(showError); };
$("prev").onclick = () => { state.page = Math.max(1, state.page - 1); loadDetails().catch(showError); };
$("next").onclick = () => { state.page++; loadDetails().catch(showError); };
$("campaign-prev").onclick = () => { state.campaignPage = Math.max(1, state.campaignPage - 1); refresh(); };
$("campaign-next").onclick = () => { state.campaignPage++; refresh(); };
$("refresh").onclick = refresh; $("close-history").onclick = () => $("history").close();
api("/api/info").then(info => { $("demo-note").textContent = info.demoFailures ? "Demo lỗi đang bật: retry+… thành công ở lần 3; fail+… luôn thất bại. Các địa chỉ khác gửi đến Mailpit." : "Demo lỗi đang tắt. Thư gửi qua SMTP đã cấu hình; Compose mặc định dùng Mailpit."; }).catch(showError);
refresh(); setInterval(refresh, 3000);
