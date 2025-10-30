import dotenv from 'dotenv';
dotenv.config();


export const CONFIG = {
MAX_CONCURRENCY: Number(process.env.MAX_CONCURRENCY || 1),
MAX_DURATION_SEC: Number(process.env.MAX_DURATION_SEC || 900),
MAX_FILE_MB: Number(process.env.MAX_FILE_MB || 50),
YTDL_USER_AGENT: process.env.YTDL_USER_AGENT || undefined,
OWNER_JID: process.env.OWNER_JID || null,
};