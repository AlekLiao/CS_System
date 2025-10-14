document.addEventListener("DOMContentLoaded", () => {
    const rightFrame = document.getElementById("rightFrame");
    const chatBtn = document.getElementById("chatBtn");

    if (chatBtn) {
        chatBtn.addEventListener("click", () => {
            renderChatPage();
        });
    }

    // ===== 可依你的後端調整這裡的路徑規則 =====
    // 方案A（合併一個Endpoint/檔案）：回傳 { public: {...}, personal: {..., agentId} }
    const PHRASE_COMBINED_URL = "phrases.json";

    // 方案B（分開兩個Endpoint/檔案）：公用 + 個人
    const PHRASE_PUBLIC_URL = "data//phrases.pub.json";
    const PHRASE_PERSONAL_URL = (agentId) => `phrases.personal.${encodeURIComponent(agentId)}.json`;
    //PHRASE_PERSONAL_URL = (agentId) => \data/personal/${agentId}.json``

    // 取得目前登入的客服帳號（你可以在 index.html 的 <body data-agent-id="AGENT001"> 或在 index.js 設定 window.AGENT_ID）
    const resolveAgentId = () =>
        window.AGENT_ID || document.body.dataset.agentId || "demoAgent";

    // 預設資料（後台抓不到時的 fallback）
    const DEFAULT_PUBLIC = {
        "開場": ["您好～請問需要什麼協助？", "您好，我是客服，很高興為您服務。"],
        "查詢/等待": ["收到，我幫您查詢一下，請稍等。"]
    };
    const DEFAULT_PERSONAL = {
        "我的常用": ["（範例）您好，我是小幫手；有任何問題都可以問我！"]
    };

    /** 將後台返回的「群組」資料（可能是 map 或 array 形式）正規化為 map：{ groupName: string[] } */
    function normalizeGroups(raw) {
        if (!raw) return {};
        // 形態1：{ groups: [{ name, items: [] }, ...] }
        if (Array.isArray(raw.groups)) {
            const out = {};
            for (const g of raw.groups) {
                if (g && g.name && Array.isArray(g.items)) out[g.name] = g.items.filter(Boolean);
            }
            return out;
        }
        // 形態2：直接 map 物件：{ "開場": ["...","..."], "結尾": [...] }
        if (typeof raw === "object") {
            const out = {};
            for (const [k, v] of Object.entries(raw)) {
                if (Array.isArray(v)) out[k] = v.filter(Boolean);
            }
            return out;
        }
        return {};
    }

    /** 從後台載入：先試合併（phrases.json），失敗則改抓公用/個人分開；仍失敗用 fallback */
    async function loadPhraseData(agentId) {
        // 試合併
        try {
            const res = await fetch(PHRASE_COMBINED_URL + "?_t=" + Date.now(), { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                const pub = normalizeGroups(data.public);
                const per = normalizeGroups(data.personal?.groups || data.personal);
                return {
                    agentId: data.personal?.agentId || agentId,
                    publicGroups: Object.keys(pub).length ? pub : DEFAULT_PUBLIC,
                    personalGroups: Object.keys(per).length ? per : DEFAULT_PERSONAL
                };
            }
        } catch (_) { /* ignore, fallback next */ }

        // 分開抓
        let publicGroups = {};
        let personalGroups = {};
        try {
            const resPub = await fetch(PHRASE_PUBLIC_URL + "?_t=" + Date.now(), { cache: "no-store" });
            if (resPub.ok) {
                publicGroups = normalizeGroups(await resPub.json());
            }
        } catch (_) { }
        try {
            const resPer = await fetch(PHRASE_PERSONAL_URL(agentId) + "?_t=" + Date.now(), { cache: "no-store" });
            if (resPer.ok) {
                personalGroups = normalizeGroups(await resPer.json());
            }
        } catch (_) { }

        // fallback
        if (!Object.keys(publicGroups).length) publicGroups = DEFAULT_PUBLIC;
        if (!Object.keys(personalGroups).length) personalGroups = DEFAULT_PERSONAL;

        return { agentId, publicGroups, personalGroups };
    }

    /** 渲染：即時對話頁（含 Splitter + 短語：公用/個人 + 搜尋 + 分組） */
    async function renderChatPage() {
        rightFrame.innerHTML = `
        <div class="chat-page" id="chatPage">
          <!-- (1) 客戶在線列表 -->
          <section class="chat-online">
            <div class="chat-online__header">客戶在線列表</div>
            <div class="chat-online__search">
              <input id="onlineSearch" type="text" placeholder="搜尋暱稱 / ID">
            </div>
            <div class="chat-online__list" id="onlineList"></div>
          </section>
  
          <!-- (2) 對話內容 -->
          <section class="chat-conv">
            <div class="chat-conv__header">
              <span>對話內容</span>
              <span id="convTitle" style="color:#8a99a6;font-weight:400;">（尚未選擇客戶）</span>
            </div>
            <div class="chat-conv__body" id="convBody"></div>
          </section>
  
          <!-- (2.5) 分隔線 -->
          <div class="chat-splitter" id="chatSplitter" title="拖曳調整高度 / 雙擊重置"></div>
  
          <!-- (3) 客服訊息編輯區 -->
          <section class="chat-editor">
            <div class="chat-editor__toolbar">
              <button class="btn btn-search" id="btnInsertTime">插入時間</button>
              <button class="btn btn-role" id="btnClear">清空</button>
            </div>
            <div class="chat-editor__body">
              <textarea id="chatTextarea" placeholder="輸入要發送的訊息（Enter 發送、Shift+Enter 換行）"></textarea>
              <div class="chat-editor__actions">
                <button class="btn btn-send" id="btnSend" disabled>發送</button>
              </div>
            </div>
          </section>
  
          <!-- (4) 常用短語選擇區 -->
          <aside class="chat-phrases">
            <div class="chat-phrases__header">常用短語</div>
            <div class="phrase-cats" id="phraseCats">
              <button class="phrase-cat is-active" data-cat="public">公用</button>
              <button class="phrase-cat" data-cat="personal">個人</button>
            </div>
            <div class="chat-phrases__tools">
              <div class="phrase-search">
                <input id="phraseSearch" type="text" placeholder="搜尋關鍵字（即時過濾）">
              </div>
              <div class="phrase-tabs" id="phraseTabs"></div>
            </div>
            <div class="chat-phrases__body" id="phrasesBody">
              <div style="color:#8a99a6;font-size:13px;">（短語載入中…）</div>
            </div>
          </aside>
        </div>
      `;

        // ====== 線上客戶（demo） ======
        const mockUsers = [
            { id: "U1001", name: "Tony", vip: true },
            { id: "U1002", name: "Mandy", vip: false },
            { id: "U1003", name: "Kyle", vip: false },
            { id: "U1004", name: "小李", vip: true }
        ];

        // ====== DOM 參照 ======
        const chatPage = document.getElementById("chatPage");
        const onlineList = document.getElementById("onlineList");
        const convBody = document.getElementById("convBody");
        const convTitle = document.getElementById("convTitle");
        const phraseCats = document.getElementById("phraseCats");
        const phraseTabs = document.getElementById("phraseTabs");
        const phrasesBody = document.getElementById("phrasesBody");
        const phraseSearch = document.getElementById("phraseSearch");
        const ta = document.getElementById("chatTextarea");
        const btnSend = document.getElementById("btnSend");
        const splitter = document.getElementById("chatSplitter");

        // ====== 狀態 ======
        let currentUser = null;
        let lastSendAt = 0;

        // 線上清單
        onlineList.innerHTML = mockUsers.map(u => `
        <div class="online-item" data-id="${u.id}" data-name="${u.name}">
          <div class="online-item__avatar">${u.name.slice(0, 1).toUpperCase()}</div>
          <div class="online-item__name">${u.name} <span style="color:#8a99a6;font-size:12px;">#${u.id}</span></div>
          ${u.vip ? '<span class="online-item__badge">VIP</span>' : ''}
        </div>
      `).join("");

        onlineList.addEventListener("click", e => {
            const item = e.target.closest(".online-item");
            if (!item) return;
            currentUser = { id: item.dataset.id, name: item.dataset.name };
            convTitle.textContent = `（與 ${currentUser.name} #${currentUser.id} 對話）`;
            convBody.innerHTML = `
          <div class="msg-row">
            <div>
              <div class="msg-bubble">您好～我是客服，有什麼可以協助您？</div>
              <div class="msg-meta">客服 · ${new Date().toLocaleTimeString()}</div>
            </div>
          </div>
        `;
            ta.focus();
            checkSendEnabled();
        });

        // ====== 後台載入：公用/個人短語 ======
        const agentId = resolveAgentId();
        const { publicGroups, personalGroups } = await loadPhraseData(agentId);

        const CATS = {
            public: { label: "公用", groups: publicGroups },
            personal: { label: "個人", groups: personalGroups }
        };

        let activeCat = "public";  // 'public' | 'personal'
        let activeGroup = "全部";
        let keyword = "";

        // 類別切換（公用 / 個人）
        phraseCats.addEventListener("click", (e) => {
            const btn = e.target.closest(".phrase-cat");
            if (!btn) return;
            activeCat = btn.dataset.cat;
            [...phraseCats.children].forEach(el => el.classList.toggle("is-active", el === btn));
            activeGroup = "全部"; // 切換類別時重置到「全部」
            renderGroupTabs();
            renderPhrases();
        });

        // 分組 tabs + 搜尋
        phraseSearch.addEventListener("input", () => {
            keyword = phraseSearch.value.trim();
            renderPhrases();
        });

        function renderGroupTabs() {
            const groupsMap = CATS[activeCat].groups || {};
            const names = ["全部", ...Object.keys(groupsMap)];
            phraseTabs.innerHTML = names.map((g, i) =>
                `<button class="phrase-tab${g === activeGroup ? ' is-active' : ''}" data-group="${g}">${g}</button>`
            ).join("");
        }

        phraseTabs.addEventListener("click", (e) => {
            const btn = e.target.closest(".phrase-tab");
            if (!btn) return;
            activeGroup = btn.dataset.group;
            [...phraseTabs.children].forEach(el => el.classList.toggle("is-active", el === btn));
            renderPhrases();
        });

        function renderPhrases() {
            const groupsMap = CATS[activeCat].groups || {};
            let list = [];
            if (activeGroup === "全部") {
                list = Object.values(groupsMap).flat();
            } else {
                list = groupsMap[activeGroup] || [];
            }
            if (keyword) list = list.filter(t => t.includes(keyword));
            if (!list.length) {
                const emptyMsg = activeCat === "personal"
                    ? "（尚未建立個人短語）"
                    : "（無符合的短語）";
                phrasesBody.innerHTML = `<div style="color:#8a99a6;font-size:13px;">${emptyMsg}</div>`;
                return;
            }
            phrasesBody.innerHTML = list.map(p =>
                `<button class="phrase-btn" data-text="${p.replace(/"/g, '&quot;')}">${p}</button>`
            ).join("");
        }

        // 初次渲染
        renderGroupTabs();
        renderPhrases();

        // 插入短語
        phrasesBody.addEventListener("click", e => {
            const btn = e.target.closest(".phrase-btn");
            if (!btn) return;
            insertAtCursor(ta, btn.dataset.text);
            checkSendEnabled();
        });

        // 工具列
        document.getElementById("btnInsertTime").addEventListener("click", () => {
            insertAtCursor(ta, new Date().toLocaleString());
            checkSendEnabled();
        });
        document.getElementById("btnClear").addEventListener("click", () => {
            ta.value = "";
            checkSendEnabled();
            ta.focus();
        });

        // 編輯框行為
        ta.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                trySend();
            }
        });
        ta.addEventListener("input", checkSendEnabled);
        btnSend.addEventListener("click", trySend);

        function checkSendEnabled() {
            btnSend.disabled = !(currentUser && ta.value.trim().length > 0);
        }

        function trySend() {
            if (btnSend.disabled) return;
            const now = Date.now();
            if (now - lastSendAt < 600) return; // 防抖
            lastSendAt = now;

            const text = ta.value.trim();
            if (!text) return;

            appendMsg("me", text);
            ta.value = "";
            checkSendEnabled();

            setTimeout(() => {
                appendMsg("other", "收到您的訊息，我再確認一下～");
            }, 800);
        }

        function appendMsg(side, text) {
            const row = document.createElement("div");
            row.className = `msg-row ${side === "me" ? "me" : ""}`;
            row.innerHTML = `
          <div>
            <div class="msg-bubble">${escapeHTML(text).replace(/\n/g, "<br>")}</div>
            <div class="msg-meta">${side === "me" ? "我" : "客服/客戶"} · ${new Date().toLocaleTimeString()}</div>
          </div>
        `;
            convBody.appendChild(row);
            convBody.scrollTop = convBody.scrollHeight;
        }

        function insertAtCursor(el, text) {
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            el.value = el.value.slice(0, start) + text + el.value.slice(end);
            el.selectionStart = el.selectionEnd = start + text.length;
            el.dispatchEvent(new Event("input"));
            el.focus();
        }

        function escapeHTML(s) {
            return s.replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

        // Splitter（拖曳/觸控 + 雙擊重置）
        (function setupSplitter() {
            const MIN_CONV_PX = 120;
            const MIN_EDIT_PX = 100;
            let dragging = false;
            let startY = 0;
            let startConvPct = 60;
            let pageRect = null;

            function getConvPct() {
                const v = getComputedStyle(chatPage).getPropertyValue("--conv-h").trim() || "60%";
                return parseFloat(v);
            }
            function setConvPct(pct) { chatPage.style.setProperty("--conv-h", pct + "%"); }
            function pxToPct(px, total) { return (px / total) * 100; }

            function onDown(y) {
                dragging = true;
                pageRect = chatPage.getBoundingClientRect();
                startY = y;
                startConvPct = getConvPct();
                document.body.style.cursor = "row-resize";
                window.addEventListener("mousemove", onMoveMouse);
                window.addEventListener("mouseup", onUp);
                window.addEventListener("touchmove", onMoveTouch, { passive: false });
                window.addEventListener("touchend", onUp);
            }
            function onMove(y) {
                if (!dragging || !pageRect) return;
                const totalH = pageRect.height;
                const startConvPx = (startConvPct / 100) * totalH;
                let convPx = startConvPx + (y - startY);
                convPx = Math.max(MIN_CONV_PX, Math.min(totalH - 8 - MIN_EDIT_PX, convPx));
                const pct = Math.max(10, Math.min(90, pxToPct(convPx, totalH)));
                setConvPct(pct);
            }
            function onUp() {
                dragging = false;
                document.body.style.cursor = "";
                window.removeEventListener("mousemove", onMoveMouse);
                window.removeEventListener("mouseup", onUp);
                window.removeEventListener("touchmove", onMoveTouch);
                window.removeEventListener("touchend", onUp);
            }
            function onMoveMouse(e) { onMove(e.clientY); }
            function onMoveTouch(e) { e.preventDefault(); onMove(e.touches[0].clientY); }

            const splitter = document.getElementById("chatSplitter");
            splitter.addEventListener("mousedown", e => onDown(e.clientY));
            splitter.addEventListener("touchstart", e => onDown(e.touches[0].clientY), { passive: true });
            splitter.addEventListener("dblclick", () => setConvPct(60));
        })();
    }
});
