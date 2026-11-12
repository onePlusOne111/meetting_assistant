const BASE_PROMPT = `你是我的远程会议实时助理。会议中只能听到"对方"的发言，我需要在对方说完后马上开口回复。
请根据历史对话和对方刚刚说的话，直接给出我可以照着说出口的回复：
- 先给出一段可以直接说的回复（口语化、简洁、自然，一般 1~4 句）；
- 如对方的话里有需要注意的点（问题、要求、风险、可追问的地方），再用 1~3 条简短要点提示；
- 不要复述对方的话，不要客套开场，不要解释你在做什么；
- 转写可能有错别字或断句错误，请按最合理的意思理解。`;

class Conversation {
  constructor({ maxHistoryTurns = 20, extraPrompt = '' } = {}) {
    this.maxHistoryTurns = maxHistoryTurns;
    this.extraPrompt = extraPrompt;
    this.turns = []; // {other, reply}
  }

  get systemPrompt() {
    return this.extraPrompt ? `${BASE_PROMPT}\n\n补充背景：${this.extraPrompt}` : BASE_PROMPT;
  }

  /** 拼接历史对话 + 对方当前发言，得到 messages（user/assistant 严格交替） */
  buildMessages(currentText) {
    const messages = [];
    for (const t of this.turns.slice(-this.maxHistoryTurns)) {
      messages.push({ role: 'user', content: `对方说：${t.other}` });
      messages.push({ role: 'assistant', content: t.reply || '（未回复）' });
    }
    messages.push({ role: 'user', content: `对方说：${currentText}` });
    return messages;
  }

  addTurn(other, reply) {
    this.turns.push({ other, reply });
  }

  clear() {
    this.turns = [];
  }
}

module.exports = { Conversation };
