import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const chatId = process.env.TELEGRAM_CHAT_ID!;

bot.command('start', (ctx) => {
  ctx.reply('Привет! Я бот мониторинга WhatsApp.');
});

export async function createTelegramGroup(userId: string): Promise<string> {
  // TODO: Реализовать создание группы
  return `https://t.me/group_${userId}`;
}

export async function sendTelegramAlert(message: string): Promise<void> {
  // TODO: Реализовать отправку уведомлений
  console.log('Telegram alert:', message);
}

bot.launch();