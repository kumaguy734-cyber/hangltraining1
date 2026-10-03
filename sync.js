/* Googleスプレッドシート記録（GAS連携）。script.js の後に読み込みます。 */
(function () {
  "use strict";
  const DEFAULT_GAS_URL = ""; // ← デプロイしたウェブアプリURLを入れておくと全端末で共通設定になります
  const CFG_KEY = "koreanFriendApp_sync_v1";
  const QUEUE_KEY = "koreanFriendApp_queue_v1";

  const loadJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const cfg = Object.assign({ url: DEFAULT_GAS_URL, user: "", token: "", on: true }, loadJson(CFG_KEY, {}));
  let queue = loadJson(QUEUE_KEY, []);
  let flushTimer = null, stateTimer = null, flushing = false, statusText = "";

  const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  const saveQueue = () => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-2000))); } catch (e) {} };
  const enabled = () => cfg.on && /^https:\/\/script\.google\.com\//.test(cfg.url);
  const pad = n => String(n).padStart(2, "0");
  function nowStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function activeView() { const v = document.querySelector(".view.active"); return v ? v.id.replace("view-", "") : ""; }

  function setStatus(t) { statusText = t; const el = document.getElementById("syncStatus"); if (el) el.textContent = t; const b = document.getElementById("syncBtn"); if (b) b.title = t; }

  function post(payload, beacon) {
    const body = JSON.stringify(Object.assign({ user: cfg.user, token: cfg.token }, payload));
    if (beacon && navigator.sendBeacon) { return Promise.resolve(navigator.sendBeacon(cfg.url, new Blob([body], { type: "text/plain;charset=utf-8" }))); }
    // text/plain にすることでCORSのプリフライトを避ける（GAS側で JSON.parse する）
    return fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body }).then(r => r.json());
  }

  function enqueue(ev) {
    ev.id = uid(); ev.t = nowStr(); ev.view = ev.view || activeView();
    ev.correct = state.correct || 0; ev.streak = state.streak || 0;
    queue.push(ev); saveQueue();
    if (enabled()) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 3000); }
  }

  async function flush() {
    if (!enabled() || flushing || !queue.length) return;
    flushing = true;
    const batch = queue.slice(0, 100);
    try {
      const res = await post({ action: "log", events: batch });
      if (!res || !res.ok) throw new Error((res && res.error) || "送信失敗");
      queue = queue.slice(batch.length); saveQueue();
      setStatus("記録済み " + nowStr().slice(11) + (queue.length ? "（残り" + queue.length + "件）" : ""));
      flushing = false;
      if (queue.length) return flush();
    } catch (e) {
      setStatus("送信待ち " + queue.length + "件（" + (e.message || e) + "）");
      flushing = false;
    }
  }

  function pushState() {
    if (!enabled()) return;
    post({ action: "saveState", state }).catch(() => {});
  }

  // --- script.js の関数をラップして記録を差し込む ---
  const origRecord = window.recordResult;
  window.recordResult = function (key, ok) {
    origRecord.apply(this, arguments);
    enqueue({ type: "answer", key: key, ok: !!ok });
  };
  const origReply = window.sendReply;
  window.sendReply = function (i) {
    const r = chatScenario && chatScenario.replies && chatScenario.replies[i];
    origReply.apply(this, arguments);
    enqueue({ type: "chat_choice", key: "chat||" + (r ? r[0] : ""), text: r ? r[0] : "" });
  };
  const origSave = window.saveState;
  window.saveState = function () {
    origSave.apply(this, arguments);
    clearTimeout(stateTimer); stateTimer = setTimeout(pushState, 8000);
  };
  // 自由入力チャット（captureで入力欄が空になる前に取得）
  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("#sendChat")) {
      const v = (document.getElementById("chatInput") || {}).value || "";
      if (v.trim()) enqueue({ type: "chat_free", key: "chat||" + v.trim(), text: v.trim() });
    }
  }, true);
  // ページを閉じる時に送信
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && enabled() && queue.length) {
      post({ action: "log", events: queue.slice(0, 100) }, true);
      // ビーコン送信分は次回の重複防止(IDチェック)に任せ、キューは残す
    }
  });

  // --- 設定画面 ---
  const css = document.createElement("style");
  css.textContent = ".sync-modal{position:fixed;inset:0;background:rgba(15,23,42,.6);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}.sync-modal.open{display:flex}.sync-box{background:#fff;color:#0f172a;border-radius:16px;padding:20px;max-width:480px;width:100%;max-height:90vh;overflow:auto}.sync-box h3{margin:0 0 12px}.sync-box label{display:block;font-size:13px;font-weight:700;margin:10px 0 4px}.sync-box input[type=text],.sync-box input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}.sync-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.sync-note{font-size:12px;color:#64748b;margin-top:6px}#syncStatus{font-size:12px;color:#475569;margin-top:10px;word-break:break-all}";
  document.head.appendChild(css);

  const modal = document.createElement("div");
  modal.className = "sync-modal";
  modal.innerHTML = '<div class="sync-box"><h3>☁ スプレッドシート記録の設定</h3>' +
    '<label><input type="checkbox" id="syncOn"> 学習記録をGoogleスプレッドシートに送る</label>' +
    '<label>GASウェブアプリのURL</label><input type="text" id="syncUrl" placeholder="https://script.google.com/macros/s/…/exec">' +
    '<label>ユーザー名（記録の区別用）</label><input type="text" id="syncUser" placeholder="例：taro">' +
    '<label>合言葉（Code.gsのTOKENを設定した場合のみ）</label><input type="password" id="syncToken">' +
    '<div class="sync-row"><button class="primary" id="syncSave">保存してテスト</button><button class="ghost-btn" id="syncFlush">今すぐ送信</button><button class="ghost-btn" id="syncRestore">進捗を復元</button><button class="ghost-btn" id="syncClose">閉じる</button></div>' +
    '<div class="sync-note">「進捗を復元」は、スプレッドシートに保存済みの進捗でこの端末のデータを置き換えます。</div><div id="syncStatus"></div></div>';
  document.body.appendChild(modal);

  const $id = id => document.getElementById(id);
  function openModal() { $id("syncOn").checked = cfg.on; $id("syncUrl").value = cfg.url; $id("syncUser").value = cfg.user; $id("syncToken").value = cfg.token; setStatus(statusText || (enabled() ? "未送信 " + queue.length + "件" : "未設定")); modal.classList.add("open"); }
  const closeModal = () => modal.classList.remove("open");
  function readForm() { cfg.on = $id("syncOn").checked; cfg.url = $id("syncUrl").value.trim(); cfg.user = $id("syncUser").value.trim(); cfg.token = $id("syncToken").value; saveCfg(); }

  $id("syncClose").onclick = closeModal;
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  $id("syncSave").onclick = async () => {
    readForm();
    if (!enabled()) { setStatus("URLは https://script.google.com/ から始まるウェブアプリURLを入力してください"); return; }
    setStatus("接続テスト中…");
    try {
      const res = await post({ action: "ping" });
      if (!res || !res.ok) throw new Error((res && res.error) || "応答エラー");
      setStatus("接続OK。以降の学習が記録されます。"); flush(); pushState();
    } catch (e) { setStatus("接続できません：" + (e.message || e) + "（デプロイ設定を確認）"); }
  };
  $id("syncFlush").onclick = () => { readForm(); flush(); };
  $id("syncRestore").onclick = async () => {
    readForm();
    if (!enabled()) { setStatus("先にURLを設定してください"); return; }
    if (!confirm("この端末の進捗を、スプレッドシートの進捗で置き換えます。よろしいですか？")) return;
    try {
      const u = cfg.url + (cfg.url.includes("?") ? "&" : "?") + "action=getState&user=" + encodeURIComponent(cfg.user) + "&token=" + encodeURIComponent(cfg.token);
      const res = await fetch(u).then(r => r.json());
      if (!res.ok) throw new Error(res.error || "失敗");
      if (!res.state) { setStatus("このユーザー名の進捗はまだ保存されていません"); return; }
      localStorage.setItem(STORAGE, JSON.stringify(res.state));
      location.reload();
    } catch (e) { setStatus("復元できません：" + (e.message || e)); }
  };

  const btn = document.createElement("button");
  btn.id = "syncBtn"; btn.className = "icon-btn"; btn.textContent = "☁"; btn.title = "スプレッドシート記録の設定";
  btn.onclick = openModal;
  const actions = document.querySelector(".top-actions");
  if (actions) actions.insertBefore(btn, actions.firstChild);

  // 起動時に未送信分を送る
  if (enabled() && queue.length) setTimeout(flush, 1500);
})();
