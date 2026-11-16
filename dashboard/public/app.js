const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || res.statusText || "request failed");
  }
  return data;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function activateTab(name) {
  $$(".nav-btn").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  location.hash = name;
  loadTab(name).catch((e) => toast(e.message));
}

async function loadOffice() {
  const data = await api("/office");
  $("#tagline").textContent = data.aiMode === "stub" ? "stub モード" : "claude モード";
  $("#office-stats").innerHTML = [
    ["承認待ち", data.awaitingApproval],
    ["要確認", data.needsHuman],
    ["キュー", data.queued],
    ["回答履歴", data.recentAnswers],
  ].map(([l, n]) => `<div class="stat"><span class="n">${n}</span><span class="l">${l}</span></div>`).join("");

  $("#office-roles").innerHTML = `
    <li>取り込み担当（要約・統合）— キュー ${data.queued} / 承認待ち ${data.awaitingApproval}</li>
    <li>回答担当 — 履歴 ${data.recentAnswers}</li>
    <li>点検担当 — 未実装</li>`;
  $("#office-log").textContent = (data.logTail || []).join("\n") || "(log.md 空)";
  $("#office-recent").innerHTML = (data.recentJobs || [])
    .map((j) => `<li><code>${esc(j.id)}</code> · ${esc(j.stage)} · ${esc(j.url || j.question || "")}</li>`)
    .join("") || "<li>まだジョブなし</li>";
  $("#foot").textContent = `${data.vaultPath}  ·  ${data.dataDir}`;
}

const KANBAN_STAGES = [
  "queued", "received", "fetched", "prepared", "summarized",
  "integrated", "awaiting_approval", "applied", "needs_human", "rejected",
];

async function loadQueue() {
  const data = await api("/queue");
  const by = data.stages || {};
  $("#kanban").innerHTML = KANBAN_STAGES.map((stage) => {
    const ids = by[stage] || [];
    return `<div class="col"><h3>${stage} (${ids.length})</h3>${
      ids.map((id) => `<button type="button" class="chip" data-job="${esc(id)}">${esc(id)}</button>`).join("")
      || "<span class='l'>—</span>"
    }</div>`;
  }).join("");
  $$("#kanban [data-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateTab("review");
      selectReviewJob(btn.dataset.job);
    });
  });
}

async function loadAsk() {
  const data = await api("/ask");
  $("#ask-list").innerHTML = (data.answers || [])
    .map((a) => `<li><button type="button" class="linkish" data-ask="${esc(a.id)}">${esc(a.question || a.id)}</button> · ${esc(a.stage)}</li>`)
    .join("") || "<li>まだ質問なし</li>";
  $$("#ask-list [data-ask]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const detail = await api(`/ask/${encodeURIComponent(btn.dataset.ask)}`);
      const box = $("#ask-result");
      box.hidden = false;
      box.textContent = detail.answer || "(empty)";
    });
  });
}

async function selectReviewJob(id) {
  const data = await api(`/jobs/${encodeURIComponent(id)}`);
  $("#review-diff").textContent = data.diff || "(no diff)";
  const form = $("#review-form");
  form.hidden = false;
  form.jobId.value = id;
}

async function loadReview() {
  const data = await api("/queue");
  const waiting = (data.jobs || []).filter((j) => j.stage === "awaiting_approval");
  $("#review-list").innerHTML = waiting
    .map((j) => `<li><button type="button" class="linkish" data-job="${esc(j.id)}">${esc(j.id)}</button><br/><small>${esc(j.url || "")}</small></li>`)
    .join("") || "<li>承認待ちなし</li>";
  $$("#review-list [data-job]").forEach((btn) => {
    btn.addEventListener("click", () => selectReviewJob(btn.dataset.job));
  });
}

async function loadKnowledge() {
  const data = await api("/knowledge");
  const w = data.wiki || {};
  $("#knowledge-stats").innerHTML = [
    ["Wiki ページ", w.pageCount ?? 0],
    ["リンク切れ", (w.brokenLinks || []).length],
    ["孤立候補", (w.orphanCandidates || []).length],
    ["不足トピック", (data.gaps || []).length],
  ].map(([l, n]) => `<div class="stat"><span class="n">${n}</span><span class="l">${l}</span></div>`).join("");
  $("#knowledge-cats").innerHTML = (w.byCategory || [])
    .map((c) => `<li>${esc(c.name)} — ${c.pageCount}</li>`).join("") || "<li>なし</li>";
  $("#knowledge-broken").innerHTML = (w.brokenLinks || [])
    .map((b) => `<li>${esc(b.page)} → [[${esc(b.target)}]]</li>`).join("") || "<li>なし</li>";
  $("#knowledge-gaps").innerHTML = (data.gaps || [])
    .map((g) => `<li><strong>${esc(g.question)}</strong><br/><small>${esc(g.snippet)}</small></li>`)
    .join("") || "<li>なし</li>";
}

async function loadUsage() {
  const data = await api("/usage");
  const ingestBudget = data.weeklyIngestTokenBudget || 0;
  const askBudget = data.weeklyAskTokenBudget || 0;
  const ingestPct = ingestBudget > 0 ? Math.min(100, Math.round((data.weekIngest / ingestBudget) * 100)) : 0;
  const askPct = askBudget > 0 ? Math.min(100, Math.round((data.weekAsk / askBudget) * 100)) : 0;
  $("#usage-bars").innerHTML = `
    <div class="stat"><span class="n">${data.weekIngest}</span><span class="l">今週 ingest / 上限 ${ingestBudget || "未設定"}</span><div class="bar"><span style="width:${ingestPct}%"></span></div></div>
    <div class="stat"><span class="n">${data.weekAsk}</span><span class="l">今週 ask / 上限 ${askBudget || "未設定"}</span><div class="bar"><span style="width:${askPct}%"></span></div></div>`;
  const days = Object.keys(data.byDay || {}).sort().reverse().slice(0, 14);
  $("#usage-table tbody").innerHTML = days
    .map((d) => `<tr><td>${esc(d)}</td><td>${data.byDay[d].ingest}</td><td>${data.byDay[d].ask}</td></tr>`)
    .join("") || `<tr><td colspan="3">まだ usage なし（claude -p 実行後に溜まる）</td></tr>`;
  $("#usage-events").innerHTML = (data.events || []).slice(-20).reverse()
    .map((e) => `<li>${esc(e.at.slice(0, 19))} · ${esc(e.kind)}/${esc(e.step)} · ${e.totalTokens} tok · ${esc(e.jobId)}</li>`)
    .join("") || "<li>なし</li>";
}

async function loadTab(name) {
  if (name === "office") return loadOffice();
  if (name === "queue") return loadQueue();
  if (name === "ask") return loadAsk();
  if (name === "review") return loadReview();
  if (name === "knowledge") return loadKnowledge();
  if (name === "usage") return loadUsage();
}

$$(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

$("#enqueue-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api("/queue/enqueue", {
      method: "POST",
      body: JSON.stringify({ url: fd.get("url") }),
    });
    toast(`queued: ${data.id}`);
    e.target.reset();
    await loadQueue();
  } catch (err) {
    toast(err.message);
  }
});

$("#queue-run").addEventListener("click", async () => {
  $("#queue-run").disabled = true;
  toast("キュー実行中…（claude だと数分かかることがある）");
  const poll = setInterval(() => {
    loadQueue().catch(() => {});
  }, 2500);
  try {
    const data = await api("/queue/run", {
      method: "POST",
      body: JSON.stringify({ stub: $("#queue-stub").checked, fixture: $("#queue-stub").checked }),
    });
    toast(`処理 ${data.processed?.length ?? 0} 件`);
    await loadQueue();
    await loadOffice();
  } catch (err) {
    toast(err.message);
    await loadQueue().catch(() => {});
  } finally {
    clearInterval(poll);
    $("#queue-run").disabled = false;
  }
});

$("#ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const box = $("#ask-result");
  box.hidden = false;
  box.textContent = "回答中…";
  try {
    const data = await api("/ask", {
      method: "POST",
      body: JSON.stringify({
        question: fd.get("question"),
        stub: $("#ask-stub").checked,
      }),
    });
    box.textContent = data.answer || "(empty)";
    toast(`ask ${data.id} · ${data.stage}`);
    await loadAsk();
  } catch (err) {
    box.textContent = err.message;
    toast(err.message);
  }
});

$("#review-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const jobId = fd.get("jobId");
  const decision = e.submitter?.value || "approve";
  const comment = fd.get("comment") || undefined;
  try {
    await api(`/jobs/${encodeURIComponent(jobId)}/${decision}`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    toast(`${decision}: ${jobId}`);
    $("#review-form").hidden = true;
    $("#review-diff").textContent = "ジョブを選んでください";
    await loadReview();
    await loadOffice();
  } catch (err) {
    toast(err.message);
  }
});

const initial = (location.hash || "#office").replace("#", "") || "office";
activateTab(initial);
