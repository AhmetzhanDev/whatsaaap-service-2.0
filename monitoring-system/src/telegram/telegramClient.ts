import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { BigInteger } from 'big-integer';
import { CompanySettings } from '../models/CompanySettings';
import dotenv from 'dotenv';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';

dotenv.config();

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(query, (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
};

const apiId = parseInt(process.env.TELEGRAM_API_ID || '');
const apiHash = process.env.TELEGRAM_API_HASH || '';
const phoneNumber = process.env.TELEGRAM_PHONE || '';

export class TelegramService {
  private static instance: TelegramService;
  private client: TelegramClient | null = null;
  private stringSession = new StringSession('');
  private phoneCode: string | null = null;
  private phone: string;
  private sessionFile = path.join(__dirname, 'telegram_session.txt');

  private constructor() {
    this.phone = process.env.TELEGRAM_PHONE || '';
    this.loadSession();
  }

  private loadSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const sessionString = fs.readFileSync(this.sessionFile, 'utf8');
        this.stringSession = new StringSession(sessionString);
      }
    } catch (error) {
      console.error('Ошибка при загрузке сессии:', error);
    }
  }

  private saveSession() {
    try {
      fs.writeFileSync(this.sessionFile, this.stringSession.save());
    } catch (error) {
      console.error('Ошибка при сохранении сессии:', error);
    }
  }

  public static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
    }
    return TelegramService.instance;
  }

  public async initialize(): Promise<void> {
    if (!this.client) {
      this.client = new TelegramClient(
        this.stringSession,
        Number(process.env.TELEGRAM_API_ID),
        process.env.TELEGRAM_API_HASH!,
        { connectionRetries: 5 }
      );

      await this.client.start({
        phoneNumber: process.env.TELEGRAM_PHONE!,
        phoneCode: async () => {
          if (!this.phoneCode) {
            this.phoneCode = await question('Введите код подтверждения: ');
          }
          return this.phoneCode;
        },
        onError: (err) => console.log(err),
      });

      // Сохраняем сессию после успешной авторизации
      this.saveSession();
    }
  }

  public setPhoneCode(code: string): void {
    this.phoneCode = code;
  }

  public async createGroupsForCompanies(companies: any[]): Promise<void> {
    if (!this.client) {
      throw new Error('Telegram клиент не инициализирован');
    }

    for (const comp of companies) {
      try {
        if (!comp.telegramGroupId) {
          console.log(`Создание группы для компании ${comp.nameCompany}...`);
          
          const result = await this.client.invoke(new Api.messages.CreateChat({
            users: [this.phone],
            title: comp.nameCompany
          }));

          console.log('Полный ответ от API Telegram:', JSON.stringify(result, null, 2));

          if (!result) {
            throw new Error('Пустой ответ от API Telegram');
          }

          if (!('updates' in result)) {
            console.log('Структура ответа:', Object.keys(result));
            throw new Error('Ответ не содержит поле updates');
          }

          const updates = (result.updates as any).updates;
          if (!updates || updates.length === 0) {
            throw new Error('Не удалось создать группу: пустой ответ от API');
          }

          // Ищем обновление с информацией о чате
          const chatUpdate = updates.find((update: any) => 
            update.className === 'UpdateChatParticipants' && 
            update.participants && 
            'chatId' in update.participants
          );

          if (!chatUpdate) {
            console.log('Полученные обновления:', JSON.stringify(updates, null, 2));
            throw new Error('Не найдено обновление с информацией о чате');
          }

          comp.telegramGroupId = Number(chatUpdate.participants.chatId);
          const inviteLink = await this.client.invoke(new Api.messages.ExportChatInvite({
            peer: new Api.InputPeerChat({ chatId: chatUpdate.participants.chatId })
          }));

          if (!inviteLink || !('link' in inviteLink)) {
            throw new Error('Не удалось получить ссылку-приглашение');
          }

          comp.telegramInviteLink = inviteLink.link;
          
          // Обновляем данные компании в базе данных
          await CompanySettings.updateOne(
            { 'companies.id': comp.id },
            { 
              $set: { 
                'companies.$.telegramGroupId': comp.telegramGroupId,
                'companies.$.telegramInviteLink': comp.telegramInviteLink
              } 
            }
          );
          
          console.log(`Создана группа и получена ссылка-приглашение для компании ${comp.nameCompany}`);
        }
      } catch (error) {
        console.error(`Ошибка при создании группы для компании ${comp.nameCompany}:`, error);
      }
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
} 