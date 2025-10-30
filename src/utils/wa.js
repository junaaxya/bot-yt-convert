export function getTextFromMessage(msg) {
const m = msg.message || {};
if (m.conversation) return m.conversation.trim();
if (m.extendedTextMessage?.text) return m.extendedTextMessage.text.trim();
if (m.imageMessage?.caption) return m.imageMessage.caption.trim();
if (m.videoMessage?.caption) return m.videoMessage.caption.trim();
return '';
}


export function parseCommand(text) {
// Commands: .help, .ytmp3 <url>, .ytmp4 <url>, .to_mp3, .to_mp4
const [cmd, ...rest] = text.trim().split(/\s+/);
const lower = (cmd || '').toLowerCase();
const arg = rest.join(' ');
return { cmd: lower, arg };
}