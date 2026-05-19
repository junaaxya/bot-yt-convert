function unwrapMessageContent(message = {}) {
let m = message;
if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
if (m.documentWithCaptionMessage?.message)
    m = m.documentWithCaptionMessage.message;
return m || {};
}

export function getTextFromMessage(msg) {
const m = unwrapMessageContent(msg.message || {});

if (typeof m.conversation === 'string') return m.conversation.trim();
if (typeof m.extendedTextMessage?.text === 'string')
    return m.extendedTextMessage.text.trim();
if (typeof m.imageMessage?.caption === 'string')
    return m.imageMessage.caption.trim();
if (typeof m.videoMessage?.caption === 'string')
    return m.videoMessage.caption.trim();
if (typeof m.documentMessage?.caption === 'string')
    return m.documentMessage.caption.trim();
if (typeof m.buttonsResponseMessage?.selectedButtonId === 'string')
    return m.buttonsResponseMessage.selectedButtonId.trim();
if (typeof m.listResponseMessage?.singleSelectReply?.selectedRowId === 'string')
    return m.listResponseMessage.singleSelectReply.selectedRowId.trim();
if (typeof m.templateButtonReplyMessage?.selectedId === 'string')
    return m.templateButtonReplyMessage.selectedId.trim();
return '';
}

export function parseCommand(text) {
// Commands: .help, .ytmp3 <url>, .ytmp4 <url>, .to_mp3, .to_mp4
const [cmd, ...rest] = text.trim().split(/\s+/);
const lower = (cmd || '').toLowerCase();
const arg = rest.join(' ');
return { cmd: lower, arg };
}
