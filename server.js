// server.js
// 核心功能：
// - 客戶點「對話」→ join_queue → 進等待佇列
// - 客服登入並宣告 capacity → 伺服器撮合配對，建立 roomId
// - 雙方用 roomId 傳送 chat_message
// - 客服/客戶斷線 → 對方收到通知；若客服斷線則客戶自動回到佇列
// 無外部套件以外：需要 ws (WebSocket)

import http from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 8080;

/** 調整這些參數即可控制整體負荷 **/
const MAX_GLOBAL_SESSIONS = 1000;           // 全系統同時活躍會話上限
const MAX_CHATS_PER_AGENT_DEFAULT = 3;      // 客服預設同時接線數
const MATCH_RETRY_MS = 200;                 // 撮合重試間隔（毫秒）

const server = http.createServer();
const wss = new WebSocketServer({ server });

/** 狀態儲存 **/
const agents = new Map();     // agentId -> { ws, name, capacity, activeCount, rooms:Set }
const customers = new Map();  // customerId -> { ws, roomId|null }
const waitingQueue = [];      // 陣列存 customerId
const conversations = new Map(); // roomId -> { agentId, customerId }

/** 工具 **/
function safeSend(ws, obj) {
  if (ws?.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}
function broadcastAgentStats() {
  // 給所有客服：目前等待人數與自己活躍數
  const waiting = waitingQueue.length;
  for (const { ws, activeCount, capacity } of agents.values()) {
    safeSend(ws, { type: 'stats', waiting, activeCount, capacity });
  }
}
function systemLoadOk() {
  return conversations.size < MAX_GLOBAL_SESSIONS;
}

/** 撮合：將等待中的客戶配給有空檔的客服 **/
function tryMatch() {
  if (!systemLoadOk()) return;
  if (waitingQueue.length === 0) return;

  // 找出有空檔的客服（activeCount < capacity）
  const idleAgents = [...agents.entries()]
    .filter(([_, a]) => a.activeCount < a.capacity);

  if (idleAgents.length === 0) return;

  while (waitingQueue.length && idleAgents.length && systemLoadOk()) {
    const customerId = waitingQueue.shift();
    const customer = customers.get(customerId);
    if (!customer || customer.ws.readyState !== customer.ws.OPEN) continue;

    // 找一個最空的客服
    idleAgents.sort((a, b) => (a[1].activeCount - b[1].activeCount));
    const [agentId, agent] = idleAgents[0];
    if (!agent) break;

    if (agent.activeCount >= agent.capacity) {
      // 這個客服滿了，換下一個
      idleAgents.shift();
      continue;
    }

    // 建立會話
    const roomId = randomUUID();
    conversations.set(roomId, { agentId, customerId });
    agent.activeCount++;
    agent.rooms.add(roomId);
    customer.roomId = roomId;

    // 通知雙方
    safeSend(customer.ws, { type: 'chat_started', roomId, agentId, agentName: agent.name ?? '客服' });
    safeSend(agent.ws,     { type: 'chat_started', roomId, customerId });

    // 若這位客服已滿，從候選移除
    if (agent.activeCount >= agent.capacity) idleAgents.shift();
  }

  broadcastAgentStats();
}

function endConversation(roomId, reason = 'ended') {
  const conv = conversations.get(roomId);
  if (!conv) return;

  const { agentId, customerId } = conv;

  const agent = agents.get(agentId);
  const customer = customers.get(customerId);

  // 通知雙方
  if (agent) {
    safeSend(agent.ws, { type: 'chat_ended', roomId, customerId, reason });
    agent.rooms.delete(roomId);
    agent.activeCount = Math.max(0, agent.activeCount - 1);
  }
  if (customer) {
    safeSend(customer.ws, { type: 'chat_ended', roomId, agentId, reason });
    customer.roomId = null;
  }

  conversations.delete(roomId);
  broadcastAgentStats();

  // 客服斷線時，讓客戶自動回隊列（若仍在線）
  if (reason === 'agent_disconnected' && customer?.ws?.readyState === customer.ws.OPEN) {
    waitingQueue.push(customerId);
    safeSend(customer.ws, { type: 'requeued' });
    setTimeout(tryMatch, MATCH_RETRY_MS);
  }
}

/** WebSocket 連線 **/
wss.on('connection', (ws) => {
  let role = null;       // 'agent' | 'customer'
  let selfId = null;

  // 心跳（避免閒置連線被中斷）
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // 初次宣告角色
    if (msg.type === 'hello') {
      role = msg.role;
      if (role === 'agent') {
        selfId = msg.agentId || randomUUID();
        const name = msg.name || `Agent-${selfId.slice(0, 4)}`;
        const capacity = Math.max(1, Number(msg.capacity ?? MAX_CHATS_PER_AGENT_DEFAULT));
        agents.set(selfId, { ws, name, capacity, activeCount: 0, rooms: new Set() });
        safeSend(ws, { type: 'hello_ack', role: 'agent', agentId: selfId, name, capacity });
        broadcastAgentStats();
        setTimeout(tryMatch, MATCH_RETRY_MS);
      } else {
        role = 'customer';
        selfId = msg.customerId || randomUUID();
        customers.set(selfId, { ws, roomId: null });
        safeSend(ws, { type: 'hello_ack', role: 'customer', customerId: selfId });
      }
      return;
    }

    // 客戶：點「對話」→ 加入佇列
    if (role === 'customer' && msg.type === 'join_queue') {
      // 已經在會話中就不重複入隊
      const c = customers.get(selfId);
      if (c?.roomId) return;
      waitingQueue.push(selfId);
      safeSend(ws, { type: 'queued', position: waitingQueue.length });
      broadcastAgentStats();
      setTimeout(tryMatch, MATCH_RETRY_MS);
      return;
    }

    // 客服：調整可同時接線數
    if (role === 'agent' && msg.type === 'set_capacity') {
      const a = agents.get(selfId);
      if (!a) return;
      a.capacity = Math.max(1, Number(msg.capacity));
      broadcastAgentStats();
      setTimeout(tryMatch, MATCH_RETRY_MS);
      return;
    }

    // 聊天訊息 relay
    if (msg.type === 'chat_message' && msg.roomId && typeof msg.text === 'string') {
      const conv = conversations.get(msg.roomId);
      if (!conv) return;

      if (role === 'agent' && conv.agentId === selfId) {
        const customer = customers.get(conv.customerId);
        safeSend(customer?.ws, { type: 'chat_message', roomId: msg.roomId, from: 'agent', text: msg.text, ts: Date.now() });
      } else if (role === 'customer' && conv.customerId === selfId) {
        const agent = agents.get(conv.agentId);
        safeSend(agent?.ws, { type: 'chat_message', roomId: msg.roomId, from: 'customer', text: msg.text, ts: Date.now(), customerId: conv.customerId });
      }
      return;
    }

    // 任一方結束對話
    if (msg.type === 'end_chat' && msg.roomId) {
      endConversation(msg.roomId, 'ended_by_user');
      return;
    }
  });

  ws.on('close', () => {
    if (role === 'agent' && selfId && agents.has(selfId)) {
      const a = agents.get(selfId);
      // 結束他所有會話，讓客戶回佇列
      for (const roomId of [...a.rooms]) {
        endConversation(roomId, 'agent_disconnected');
      }
      agents.delete(selfId);
      broadcastAgentStats();
    } else if (role === 'customer' && selfId && customers.has(selfId)) {
      const c = customers.get(selfId);
      // 若在佇列內 → 清掉；若在會話中 → 通知客服
      const idx = waitingQueue.indexOf(selfId);
      if (idx >= 0) waitingQueue.splice(idx, 1);
      if (c?.roomId) endConversation(c.roomId, 'customer_disconnected');
      customers.delete(selfId);
      broadcastAgentStats();
    }
  });
});

/** 心跳清理 **/
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.on('close', () => clearInterval(interval));
server.listen(PORT, () => {
  console.log(`WS server listening on :${PORT}`);
});
