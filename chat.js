// chat.js — 將「客服座席(Agent)」整合到 index.html 右側，連線 server.js 收/發真實訊息
(function () {
  function init() {
    const rightFrame = document.getElementById("rightFrame");
    const chatBtn = document.getElementById("chatBtn");
    if (chatBtn) chatBtn.addEventListener("click", () => renderChatPage());

    // 供其他腳本也能開啟聊天頁
    window.renderChatPage = renderChatPage;

    // 取座席名稱/ID（可從 <body data-agent-name="..."> 帶入）
    const agentName = window.AGENT_NAME || document.body.dataset.agentName || "客服";
    let capacity = Number(window.AGENT_CAPACITY || 3) || 3;

    // === WebSocket URL（支援 file:// 頁面開啟） ===
    const isSecure = location.protocol === 'https:';
    const host = location.hostname || 'localhost';
    const WS_URL = (isSecure ? 'wss://' : 'ws://') + host + ':8080';

    function renderChatPage() {
      rightFrame.innerHTML = `
        <div class="chat-page" id="chatPage">
          <!-- (1) 客戶在線列表 + 佇列資訊 -->
          <section class="chat-online">
            <div class="chat-online__header">客戶在線列表</div>
            <div class="chat-online__search" style="display:flex;gap:8px;align-items:center;">
              <input id="onlineSearch" type="text" placeholder="搜尋客戶ID / 會話ID">
            </div>
            <div style="padding:8px 12px;font-size:12px;color:#8a99a6;display:flex;gap:10px;align-items:center; border-bottom:1px solid #eef2f5;">
              佇列：<b id="statWaiting">0</b> ｜ 已接：<b id="statActive">0</b> / <b id="statCap">0</b>
              <span style="margin-left:auto;">
                <button class="btn" id="btnCapDec">-容量</button>
                <button class="btn" id="btnCapInc">+容量</button>
              </span>
            </div>
            <div class="chat-online__list" id="onlineList"></div>
          </section>

          <!-- (2) 對話內容 -->
          <section class="chat-conv">
            <div class="chat-conv__header">
              <span>對話內容</span>
              <span id="convTitle" style="color:#8a99a6;font-weight:400;">（尚未選擇會話）</span>
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

          <!-- (4) 常用短語（樣式沿用，先保留空殼；之後再接你的 phrases.json） -->
          <aside class="chat-phrases">
            <div class="chat-phrases__header">常用短語</div>
            <div class="chat-phrases__body" id="phrasesBody">
              <div style="color:#8a99a6;font-size:13px;">（之後可接入公用/個人短語）</div>
            </div>
          </aside>
        </div>
      `;

      // DOM refs
      const chatPage = document.getElementById("chatPage");
      const onlineList = document.getElementById("onlineList");
      const convBody = document.getElementById("convBody");
      const convTitle = document.getElementById("convTitle");
      const ta = document.getElementById("chatTextarea");
      const btnSend = document.getElementById("btnSend");
      const btnCapInc = document.getElementById("btnCapInc");
      const btnCapDec = document.getElementById("btnCapDec");
      const statWaiting = document.getElementById("statWaiting");
      const statActive = document.getElementById("statActive");
      const statCap = document.getElementById("statCap");

      // 狀態（rooms = 多會話）
      let ws, agentId = null;
      const rooms = new Map(); // roomId -> { customerId, log:[] }
      let currentRoomId = null;
      let lastSendAt = 0;

      // === 連上 WS 當座席 ===
      function connectAgent() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type:'hello', role:'agent', name: agentName, capacity }));
        };

        ws.onerror = (e) => {
          console.error('[WS] error', e);
          appendBubble('sys', '無法連線到伺服器：' + WS_URL);
        };

        ws.onclose = () => {
          appendBubble('sys', '連線關閉，請重新整理');
        };

        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          // console.log('[WS] recv:', msg);

          if (msg.type === 'hello_ack' && msg.role === 'agent') {
            agentId = msg.agentId;
            capacity = msg.capacity || capacity;
            statCap.textContent = capacity;
            statActive.textContent = '0';
          }

          if (msg.type === 'stats') {
            statWaiting.textContent = msg.waiting ?? 0;
            statActive.textContent  = msg.activeCount ?? 0;
            statCap.textContent     = msg.capacity ?? capacity;
          }

          if (msg.type === 'chat_started') {
            const { roomId, customerId } = msg;
            if (!rooms.has(roomId)) {
              rooms.set(roomId, { customerId, log: [] });
              addOrUpdateOnlineItem(roomId, customerId);
            }
            selectRoom(roomId);
            appendMsg(roomId, 'sys', '客戶已接入');
          }

          if (msg.type === 'chat_message') {
            // 來自客戶
            appendMsg(msg.roomId, 'other', msg.text);
          }

          if (msg.type === 'chat_ended') {
            const rid = msg.roomId;
            appendMsg(rid, 'sys', '對話已結束');
            rooms.delete(rid);
            removeOnlineItem(rid);
            if (currentRoomId === rid) {
              currentRoomId = null;
              convTitle.textContent = '（尚未選擇會話）';
              convBody.innerHTML = '';
              checkSendEnabled();
            }
          }
        };
      }

      // === 左側：客戶在線列表 ===
      function addOrUpdateOnlineItem(roomId, customerId) {
        let item = onlineList.querySelector(`[data-room="${roomId}"]`);
        if (!item) {
          const div = document.createElement('div');
          div.className = 'online-item';
          div.dataset.room = roomId;
          div.dataset.customerId = customerId;
          div.innerHTML = `
            <div class="online-item__avatar">${String(customerId || 'U?').slice(-2).toUpperCase()}</div>
            <div class="online-item__name">#${roomId.slice(0,6)} <span style="color:#8a99a6;font-size:12px;">客戶 ${customerId || ''}</span></div>
            <span class="online-item__badge">LIVE</span>
          `;
          div.addEventListener('click', () => selectRoom(roomId));
          onlineList.prepend(div);
        }
      }
      function removeOnlineItem(roomId) {
        const el = onlineList.querySelector(`[data-room="${roomId}"]`);
        if (el) el.remove();
      }
      function selectRoom(roomId) {
        currentRoomId = roomId;
        const info = rooms.get(roomId);
        const title = info ? `（會話 ${roomId.slice(0,6)} · 客戶 ${info.customerId}）` : '（尚未選擇會話）';
        convTitle.textContent = title;
        renderLog(roomId);
        checkSendEnabled();
      }

      // === 對話內容 ===
      function renderLog(roomId) {
        convBody.innerHTML = '';
        const info = rooms.get(roomId);
        if (!info) return;
        for (const m of info.log) appendBubble(m.from, m.text, m.ts);
        convBody.scrollTop = convBody.scrollHeight;
      }
      function appendMsg(roomId, from, text) {
        const info = rooms.get(roomId);
        if (!info) return;
        info.log.push({ from, text, ts: Date.now() });
        if (currentRoomId === roomId) appendBubble(from, text);
      }
      function appendBubble(from, text, ts) {
        const row = document.createElement("div");
        const side = (from === 'me') ? 'me' : '';
        row.className = `msg-row ${side}`;
        const who = from === 'me' ? '我' : (from === 'sys' ? '系統' : '客戶');
        const content = (from === 'sys')
          ? `<em style="color:#8a99a6">${escapeHTML(text)}</em>`
          : escapeHTML(text).replace(/\n/g, "<br>");
        row.innerHTML = `
          <div>
            <div class="msg-bubble">${content}</div>
            <div class="msg-meta">${who} · ${new Date(ts || Date.now()).toLocaleTimeString()}</div>
          </div>
        `;
        convBody.appendChild(row);
        convBody.scrollTop = convBody.scrollHeight;
      }
      function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, c => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
      }

      // === 發送訊息（傳到當前會話） ===
      const btnInsertTime = document.getElementById("btnInsertTime");
      const btnClear = document.getElementById("btnClear");
      btnInsertTime.addEventListener("click", () => {
        insertAtCursor(ta, new Date().toLocaleString());
        checkSendEnabled();
      });
      btnClear.addEventListener("click", () => {
        ta.value = "";
        checkSendEnabled();
        ta.focus();
      });

      function checkSendEnabled() {
        btnSend.disabled = !(currentRoomId && ta.value.trim().length > 0);
      }
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          trySend();
        }
      });
      ta.addEventListener("input", checkSendEnabled);
      btnSend.addEventListener("click", trySend);

      function trySend() {
        if (btnSend.disabled) return;
        const now = Date.now();
        if (now - lastSendAt < 200) return; // 小防抖
        lastSendAt = now;

        const text = ta.value.trim();
        if (!text || !currentRoomId) return;

        ws?.send(JSON.stringify({ type: 'chat_message', roomId: currentRoomId, text }));
        appendMsg(currentRoomId, 'me', text);

        ta.value = "";
        checkSendEnabled();
      }
      function insertAtCursor(el, text) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.dispatchEvent(new Event("input"));
        el.focus();
      }

      // === 容量調整（控制 N 的一部分） ===
      btnCapInc.addEventListener('click', () => {
        capacity = Number(statCap.textContent || capacity) + 1;
        statCap.textContent = capacity;
        ws?.send(JSON.stringify({ type: 'set_capacity', capacity }));
      });
      btnCapDec.addEventListener('click', () => {
        capacity = Math.max(1, Number(statCap.textContent || capacity) - 1);
        statCap.textContent = capacity;
        ws?.send(JSON.stringify({ type: 'set_capacity', capacity }));
      });

      // === 分隔線拖曳（保留你的 UI 手感） ===
      (function setupSplitter() {
        const MIN_CONV_PX = 120;
        const MIN_EDIT_PX = 100;
        let dragging = false, startY = 0, startConvPct = 60, pageRect = null;

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

      // 開始連線
      connectAgent();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
