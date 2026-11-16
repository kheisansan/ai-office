const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PANEL_TITLES = {
  ingest: "取り込みデスク",
  ask: "検索",
  review: "承認ディスプレイ",
  status: "Status モニター",
};

const BUSY_STAGES = new Set([
  "received", "fetched", "prepared", "summarized", "integrated",
]);

let askInFlight = false;
let ingestRunInFlight = false;

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
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;");
}

function stripFrontmatter(src) {
  const text = String(src ?? "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) return text;
  return text.slice(end + 5);
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s ?? "").trim());
}

function safeHref(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function extLinkHtml(url, label = url) {
  const href = safeHref(url);
  if (!href) return esc(label);
  return `<a class="ext-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

function wikiLinkHtml(name) {
  const n = String(name).trim();
  if (isHttpUrl(n)) return extLinkHtml(n, n);
  return `<button type="button" class="wiki-link" data-wiki="${esc(n)}" title="Vault内ページを開く">[[${esc(n)}]]</button>`;
}

function inlineMarkdown(text) {
  const placeholders = [];
  const protect = (html) => {
    const key = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return key;
  };

  let s = String(text ?? "");
  s = s.replace(/`([^`]+)`/g, (_, code) => protect(`<code>${esc(code)}</code>`));
  s = s.replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, (_, name) =>
    protect(wikiLinkHtml(name)));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
    protect(extLinkHtml(url, label)));
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => protect(extLinkHtml(url)));
  s = s.replace(/(https?:\/\/[^\s<>\[\]()"'`]+)/g, (url) => protect(extLinkHtml(url)));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => protect(`<strong>${esc(t)}</strong>`));
  s = esc(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
}

function isTableSeparator(line) {
  return /^\|?[\s:|-]+\|[\s:|-]+/.test(line.trim()) && /\|/.test(line) && /-/.test(line);
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function renderTable(headerLine, bodyLines) {
  const headers = splitTableRow(headerLine);
  const rows = bodyLines.map(splitTableRow);
  const thead = `<thead><tr>${headers.map((h) => `<th>${inlineMarkdown(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map((cells) =>
    `<tr>${headers.map((_, i) => `<td>${inlineMarkdown(cells[i] ?? "")}</td>`).join("")}</tr>`,
  ).join("")}</tbody>`;
  return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`;
}

/** Lightweight MD → HTML (headers, lists, tables, wiki/external links). */
function renderMarkdown(src) {
  const lines = stripFrontmatter(src).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false;
  let i = 0;

  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      flushList();
      i += 1;
      continue;
    }

    // GFM table: header + separator + rows
    if (
      line.includes("|")
      && i + 1 < lines.length
      && isTableSeparator(lines[i + 1])
    ) {
      flushList();
      const header = line;
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        body.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(header, body));
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line.trim());
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      i += 1;
      continue;
    }
    flushList();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
    i += 1;
  }
  flushList();
  return out.join("\n") || "<p>(empty)</p>";
}

function showAnswer(box, text, { plain = false } = {}) {
  box.hidden = false;
  if (plain) {
    box.classList.add("is-plain");
    box.classList.remove("md-view");
    box.textContent = text;
    return;
  }
  box.classList.remove("is-plain");
  box.classList.add("md-view");
  box.innerHTML = renderMarkdown(text);
}

function openWikiPage(name) {
  if (isHttpUrl(name)) {
    window.open(String(name).trim(), "_blank", "noopener,noreferrer");
    return;
  }
  const drawer = $("#wiki-drawer");
  const scrim = $("#wiki-scrim");
  const body = $("#wiki-content");
  resetDrawerPosition(drawer);
  $("#wiki-title").textContent = name;
  $("#wiki-path").textContent = "読み込み中…";
  body.innerHTML = "<p class='is-plain'>読み込み中…</p>";
  drawer.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  drawer.setAttribute("aria-hidden", "false");

  const banner = $("#wiki-source-banner");
  const sourceLink = $("#wiki-source-link");
  banner.hidden = true;

  api(`/wiki/${encodeURIComponent(name)}`)
    .then((data) => {
      $("#wiki-title").textContent = data.name;
      $("#wiki-path").textContent = `${data.kind || "wiki"} · ${data.relPath}`;
      if (data.sourceUrl) {
        const href = safeHref(data.sourceUrl);
        if (href) {
          banner.hidden = false;
          sourceLink.href = href;
          sourceLink.textContent = data.sourceUrl;
        }
      }
      showAnswer(body, data.content || "(empty)");
    })
    .catch((err) => {
      $("#wiki-path").textContent = "";
      banner.hidden = true;
      showAnswer(body, err.message || "ページを開けなかった", { plain: true });
    });
}

function closeWikiPage() {
  const drawer = $("#wiki-drawer");
  const scrim = $("#wiki-scrim");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  setTimeout(() => {
    if (!drawer.classList.contains("is-open")) drawer.hidden = true;
  }, 220);
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest?.(".wiki-link[data-wiki]");
  if (!btn) return;
  e.preventDefault();
  const target = btn.dataset.wiki || "";
  if (isHttpUrl(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  openWikiPage(target);
});

function readDragOffset(drawer) {
  const x = parseFloat(getComputedStyle(drawer).getPropertyValue("--drag-x")) || 0;
  const y = parseFloat(getComputedStyle(drawer).getPropertyValue("--drag-y")) || 0;
  return { x, y };
}

function resetDrawerPosition(drawer) {
  drawer.style.setProperty("--drag-x", "0px");
  drawer.style.setProperty("--drag-y", "0px");
  drawer.style.left = "";
  drawer.style.top = "";
  drawer.style.transform = "";
  drawer.classList.remove("is-dragged");
}

function enableDrawerDrag(drawer, handle) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button, a, input, textarea")) return;
    const offset = readDragOffset(drawer);
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    originX = offset.x;
    originY = offset.y;
    drawer.classList.add("is-dragged");
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    let nextX = originX + (e.clientX - startX);
    let nextY = originY + (e.clientY - startY);
    drawer.style.setProperty("--drag-x", `${nextX}px`);
    drawer.style.setProperty("--drag-y", `${nextY}px`);
    const rect = drawer.getBoundingClientRect();
    if (rect.left < 8) nextX += 8 - rect.left;
    if (rect.top < 8) nextY += 8 - rect.top;
    if (rect.right > window.innerWidth - 8) nextX -= rect.right - (window.innerWidth - 8);
    if (rect.bottom > window.innerHeight - 8) nextY -= rect.bottom - (window.innerHeight - 8);
    drawer.style.setProperty("--drag-x", `${nextX}px`);
    drawer.style.setProperty("--drag-y", `${nextY}px`);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    drawer.classList.remove("is-dragged");
    try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

function setDot(id, state) {
  const el = $(id);
  if (el) el.dataset.state = state;
}

function setEmpBusy(panel, busy) {
  const btn = $(`.hotspot-emp[data-panel="${panel}"]`);
  if (!btn) return;
  btn.classList.toggle("is-busy", busy);
  btn.classList.toggle("is-idle", !busy);
}

function clearPanelHash() {
  if (!location.hash) return;
  history.replaceState(null, "", location.pathname + location.search);
}

function openPanel(name) {
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  resetDrawerPosition(drawer);
  drawer.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  drawer.setAttribute("aria-hidden", "false");
  $("#drawer-title").textContent = PANEL_TITLES[name] || name;
  $$(".panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  loadPanel(name).catch((e) => toast(e.message));
}

function closePanel() {
  if (!$("#wiki-drawer").hidden) closeWikiPage();
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  clearPanelHash();
  setTimeout(() => {
    if (!drawer.classList.contains("is-open")) drawer.hidden = true;
  }, 220);
}

async function refreshRoleState() {
  const data = await api("/office");

  const ingestBusy = ingestRunInFlight
    || (data.queued || 0) > 0
    || (data.recentJobs || []).some((j) => BUSY_STAGES.has(j.stage));
  const needsYou = (data.awaitingApproval || 0) > 0 || (data.needsHuman || 0) > 0;

  setDot("#dot-ingest", ingestBusy ? "busy" : "idle");
  setEmpBusy("ingest", ingestBusy);
  setDot("#dot-board", needsYou ? "needs_you" : "idle");
  setDot("#dot-ask", askInFlight ? "busy" : "idle");
  setEmpBusy("ask", askInFlight);

  $("#ingest-stats").innerHTML = [
    ["承認待ち", data.awaitingApproval],
    ["要確認", data.needsHuman],
    ["キュー", data.queued],
    ["回答履歴", data.recentAnswers],
  ].map(([l, n]) => `<div class="stat"><span class="n">${n}</span><span class="l">${l}</span></div>`).join("");

  $("#office-log").textContent = (data.logTail || []).join("\n") || "(log.md 空)";
  $("#office-recent").innerHTML = (data.recentJobs || [])
    .map((j) => `<li><code>${esc(j.id)}</code> · ${esc(j.stage)} · ${esc(j.url || j.question || "")}</li>`)
    .join("") || "<li>まだジョブなし</li>";

  return data;
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
      openPanel("review");
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
      showAnswer($("#ask-result"), detail.answer || "(empty)");
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
  const rejected = (data.jobs || []).filter((j) => j.stage === "rejected");
  $("#review-list").innerHTML = waiting
    .map((j) => `<li><button type="button" class="linkish" data-job="${esc(j.id)}">${esc(j.id)}</button><br/><small>${esc(j.url || "")}</small></li>`)
    .join("") || "<li>承認待ちなし</li>";
  $$("#review-list [data-job]").forEach((btn) => {
    btn.addEventListener("click", () => selectReviewJob(btn.dataset.job));
  });
  $("#rejected-list").innerHTML = rejected
    .map(
      (j) =>
        `<li><button type="button" class="linkish" data-job="${esc(j.id)}">${esc(j.id)}</button>` +
        ` <button type="button" class="danger-link" data-delete-rejected="${esc(j.id)}">削除</button>` +
        `<br/><small>${esc(j.url || "")}</small></li>`,
    )
    .join("") || "<li>差し戻し済みなし</li>";
  $$("#rejected-list [data-job]").forEach((btn) => {
    btn.addEventListener("click", () => selectReviewJob(btn.dataset.job));
  });
  $$("#rejected-list [data-delete-rejected]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteRejected;
      if (!id || !confirm(`差し戻し済みジョブ ${id} を削除する？（同じ URL を再投入できるようになる）`)) {
        return;
      }
      try {
        await api(`/jobs/${encodeURIComponent(id)}/delete`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        toast(`deleted: ${id}`);
        $("#review-form").hidden = true;
        $("#review-diff").textContent = "ジョブを選んでください";
        await loadReview();
        await loadQueue();
        await refreshRoleState();
      } catch (err) {
        toast(err.message);
      }
    });
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
}

async function loadVaultSettings() {
  const data = await api("/config");
  const input = $("#vault-path-input");
  if (input) input.value = data.vaultPath || "";
  const hint = $("#vault-hint");
  if (hint) {
    hint.textContent = data.aiMode
      ? `現在: ${data.vaultPath}（AI: ${data.aiMode}）。保存するとすぐに反映される。`
      : "Obsidian の LLM Wiki フォルダを指定。保存するとすぐに反映される。";
  }
}

async function loadPanel(name) {
  if (name === "ingest") return refreshRoleState();
  if (name === "ask") return loadAsk();
  if (name === "review") return loadReview();
  if (name === "status") {
    await Promise.all([
      loadQueue(),
      loadUsage(),
      loadKnowledge(),
      loadVaultSettings(),
      refreshRoleState(),
    ]);
  }
}

$$(".hotspot").forEach((btn) => {
  btn.addEventListener("click", () => openPanel(btn.dataset.panel));
  if (btn.classList.contains("hotspot-emp")) btn.classList.add("is-idle");
});

$("#drawer-close").addEventListener("click", closePanel);
$("#scrim").addEventListener("click", closePanel);
$("#wiki-close").addEventListener("click", closeWikiPage);
$("#wiki-scrim").addEventListener("click", closeWikiPage);
enableDrawerDrag($("#drawer"), $("#drawer .drawer-head"));
enableDrawerDrag($("#wiki-drawer"), $("#wiki-drawer .drawer-head"));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#wiki-drawer").hidden) {
    closeWikiPage();
    return;
  }
  if (!$("#drawer").hidden) closePanel();
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
    setDot("#dot-ingest", "busy");
    setEmpBusy("ingest", true);
    await refreshRoleState();
  } catch (err) {
    toast(err.message);
  }
});

$("#queue-run").addEventListener("click", async () => {
  $("#queue-run").disabled = true;
  ingestRunInFlight = true;
  setDot("#dot-ingest", "busy");
  setEmpBusy("ingest", true);
  toast("キュー実行中…（claude だと数分かかることがある）");
  const poll = setInterval(() => {
    refreshRoleState().catch(() => {});
  }, 2500);
  try {
    const data = await api("/queue/run", {
      method: "POST",
      body: JSON.stringify({ stub: $("#queue-stub").checked, fixture: $("#queue-stub").checked }),
    });
    toast(`処理 ${data.processed?.length ?? 0} 件`);
  } catch (err) {
    toast(err.message);
  } finally {
    clearInterval(poll);
    ingestRunInFlight = false;
    $("#queue-run").disabled = false;
    await refreshRoleState().catch(() => {});
  }
});

$("#ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const box = $("#ask-result");
  showAnswer(box, "回答中…", { plain: true });
  askInFlight = true;
  setDot("#dot-ask", "busy");
  setEmpBusy("ask", true);
  try {
    const data = await api("/ask", {
      method: "POST",
      body: JSON.stringify({
        question: fd.get("question"),
        stub: $("#ask-stub").checked,
      }),
    });
    showAnswer(box, data.answer || "(empty)");
    toast(`ask ${data.id} · ${data.stage}`);
    await loadAsk();
  } catch (err) {
    showAnswer(box, err.message, { plain: true });
    toast(err.message);
  } finally {
    askInFlight = false;
    setDot("#dot-ask", "idle");
    setEmpBusy("ask", false);
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
    await refreshRoleState();
  } catch (err) {
    toast(err.message);
  }
});

async function saveVaultPath(vaultPath) {
  const data = await api("/config/vault", {
    method: "POST",
    body: JSON.stringify({ vaultPath }),
  });
  toast(data.warning ? `Vault 更新（注意: ${data.warning}）` : `Vault 更新: ${data.vaultPath}`);
  await loadVaultSettings();
  await Promise.all([loadKnowledge(), refreshRoleState()]);
}

$("#vault-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const vaultPath = String(fd.get("vaultPath") || "").trim();
  try {
    await saveVaultPath(vaultPath);
  } catch (err) {
    toast(err.message);
  }
});

$("#vault-browse").addEventListener("click", async () => {
  const btn = $("#vault-browse");
  btn.disabled = true;
  toast("フォルダ選択ダイアログを開いてる…");
  try {
    const data = await api("/config/vault/browse", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (data.cancelled) {
      toast("フォルダ選択をキャンセルした");
      return;
    }
    $("#vault-path-input").value = data.vaultPath;
    await saveVaultPath(data.vaultPath);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

refreshRoleState().catch((e) => toast(e.message));
clearPanelHash();

setInterval(() => {
  refreshRoleState().catch(() => {});
}, 8000);
