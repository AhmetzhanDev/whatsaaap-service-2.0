import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { io } from '../server';
import { UserModel } from '../models/User';

const ADMIN_ID = 'admin';
const SESSION_DIR = path.join(process.cwd(), '.wwebjs_auth', 'session-admin');
const SESSION_FILE = path.join(SESSION_DIR, 'session-data.json');
let adminClient: Client | null = null;
let verificationCode: string | null = null;
let isClientReady = false;

interface SessionData {
  WABrowserId?: string;
  WASecretBundle?: string;
  WAToken1?: string;
  WAToken2?: string;
}

// Проверка существующей сессии
const checkExistingSession = (): boolean => {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const sessionData = fs.readFileSync(SESSION_FILE, 'utf-8');
      if (sessionData) {
        const parsedData: SessionData = JSON.parse(sessionData);
        return !!(parsedData.WABrowserId && parsedData.WASecretBundle && parsedData.WAToken1 && parsedData.WAToken2);
      }
    }
    return false;
  } catch (error) {
    console.error('Ошибка при проверке сессии:', error);
    return false;
  }
};

// Сохранение сессии
const saveSession = async (sessionData: any): Promise<void> => {
  try {
    // Создаем директорию, если её нет
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    // Сохраняем данные сессии
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
    console.log('Сессия успешно сохранена');
  } catch (error) {
    console.error('Ошибка при сохранении сессии:', error);
  }
};

// Генерация 4-значного кода
const generateVerificationCode = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Отправка кода пользователю через WhatsApp
export const sendVerificationCode = async (phoneNumber: string): Promise<boolean> => {
  try {
    console.log('Начало отправки кода. Статус клиента:', isClientReady);
    console.log('Текущий админский клиент:', adminClient ? 'существует' : 'не существует');

    // Проверяем валидность номера телефона
    const formattedNumber = phoneNumber.replace(/\D/g, '');
    if (formattedNumber.length < 10 || formattedNumber.length > 15) {
      console.log('Неверный формат номера телефона:', phoneNumber);
      return false;
    }

    // Если клиент не готов, пробуем переподключиться
    if (!isClientReady || !adminClient) {
      console.log('Попытка переподключения клиента...');
      await initAdminClient();
      
      // Ждем некоторое время для инициализации
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      if (!isClientReady || !adminClient) {
        console.log('Не удалось переподключить клиент');
        return false;
      }
    }

    // Проверяем состояние сессии
    const sessionState = await adminClient?.getState();
    console.log('Состояние сессии WhatsApp:', sessionState);

    if (sessionState !== 'CONNECTED') {
      console.log('Сессия не активна, пробуем переподключиться...');
      await initAdminClient();
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const newSessionState = await adminClient?.getState();
      if (newSessionState !== 'CONNECTED') {
        console.log('Не удалось восстановить сессию');
        return false;
      }
    }

    // Находим пользователя в базе
    const user = await UserModel.findOne({ phoneNumber });
    if (!user) {
      console.log('Пользователь не найден в базе данных для номера:', phoneNumber);
      return false;
    }

    // Генерируем новый код
    user.generateVerificationCode();
    await user.save();
    console.log('Сгенерирован новый код для пользователя:', user.verificationCode);

    // Форматируем номер телефона для WhatsApp
    const whatsappNumber = formattedNumber.endsWith('@c.us') ? formattedNumber : `${formattedNumber}@c.us`;
    console.log('Форматированный номер для WhatsApp:', whatsappNumber);

    console.log(`Попытка отправить код: ${user.verificationCode} на номер: ${whatsappNumber}`);

    // Функция для отправки сообщения с повторными попытками
    const sendMessageWithRetry = async (retries = 3): Promise<boolean> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          if (!adminClient) {
            console.log('Админский клиент не существует');
            return false;
          }

          await adminClient.sendMessage(whatsappNumber, `Ваш код подтверждения: ${user.verificationCode}`);
          console.log(`Код успешно отправлен: ${user.verificationCode} на номер: ${whatsappNumber}`);
          
          io.emit('admin:verification_code', {
            code: user.verificationCode,
            timestamp: Date.now(),
            recipient: whatsappNumber
          });

          return true;
        } catch (error: any) {
          console.error(`Ошибка при отправке кода (попытка ${attempt}/${retries}):`, error);
          console.error('Детали ошибки:', error.message);
          
          // Если ошибка связана с сессией, пробуем переподключиться
          if (error.message.includes('Session closed') || error.message.includes('Connection closed')) {
            console.log('Обнаружена ошибка сессии, пробуем переподключиться...');
            await initAdminClient();
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Проверяем состояние сессии после переподключения
            const newSessionState = await adminClient?.getState();
            if (newSessionState !== 'CONNECTED') {
              console.log('Не удалось восстановить сессию после переподключения');
              continue;
            }
          }
          
          // Ждем перед следующей попыткой
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        }
      }
      return false;
    };

    return await sendMessageWithRetry();
  } catch (error: any) {
    console.error('Ошибка при отправке кода:', error);
    console.error('Детали ошибки:', error.message);
    return false;
  }
};

// Инициализация админского клиента
export const initAdminClient = async (): Promise<void> => {
  try {
    console.log('Начало инициализации админского клиента');
    
    // Создаем директорию для сессии, если её нет
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
      console.log('Создана директория для админской сессии:', SESSION_DIR);
    }

    // Если клиент уже существует и готов, не инициализируем заново
    if (adminClient && isClientReady) {
      console.log('Админский клиент уже инициализирован и готов к работе');
      return;
    }

    // Если есть существующая сессия, пробуем её использовать
    if (checkExistingSession()) {
      console.log('Найдена существующая сессия админа');
    } else {
      console.log('Существующая сессия админа не найдена');
    }

    adminClient = new Client({
      authStrategy: new LocalAuth({
        clientId: ADMIN_ID,
        dataPath: SESSION_DIR
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920x1080',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
      }
    });

    adminClient.on('qr', async (qr: string) => {
      try {
        console.log('Получен QR-код для админа');
        
        // Выводим QR-код в консоль только если нет существующей сессии
        if (!checkExistingSession()) {
          console.log('\n=== АДМИНСКИЙ QR-КОД ===');
          console.log('Отсканируйте этот QR-код для подключения админского аккаунта');
          qrcodeTerminal.generate(qr, { small: true });
          console.log('========================\n');
        }
      } catch (error: any) {
        console.error('Ошибка при генерации админского QR-кода:', error);
      }
    });

    adminClient.on('ready', () => {
      console.log('Админский клиент готов к использованию');
      isClientReady = true;
      io.emit('admin:ready', { 
        status: 'ready',
        timestamp: Date.now()
      });
    });

    adminClient.on('authenticated', () => {
      console.log('Админский клиент успешно аутентифицирован');
      
      // Проверяем наличие файла сессии
      const sessionPath = path.join(SESSION_DIR, 'session-data.json');
      if (fs.existsSync(sessionPath)) {
        try {
          const sessionData = fs.readFileSync(sessionPath, 'utf-8');
          if (sessionData) {
            const parsedData: SessionData = JSON.parse(sessionData);
            if (parsedData.WABrowserId && parsedData.WASecretBundle && parsedData.WAToken1 && parsedData.WAToken2) {
              console.log('Сессия админа успешно сохранена');
            } else {
              console.error('Сессия админа не содержит всех необходимых данных');
            }
          }
        } catch (error) {
          console.error('Ошибка при чтении файла сессии:', error);
        }
      } else {
        console.error('Файл сессии не найден после аутентификации');
      }
    });

    adminClient.on('auth_failure', (msg) => {
      console.error('Ошибка аутентификации админского клиента:', msg);
      // При ошибке аутентификации удаляем файл сессии
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
        console.log('Файл сессии удален из-за ошибки аутентификации');
      }
    });

    adminClient.on('disconnected', (reason) => {
      console.log('Админский клиент отключен:', reason);
      isClientReady = false;
      
      // Сохраняем сессию только при нормальном отключении
      if (reason === 'LOGOUT') {
        console.log('Нормальное отключение, сессия сохранена');
      } else {
        // При неожиданном отключении удаляем сессию
        if (fs.existsSync(SESSION_FILE)) {
          fs.unlinkSync(SESSION_FILE);
          console.log('Файл сессии удален из-за неожиданного отключения');
        }
      }
    });

    adminClient.on('message', async (message) => {
      try {
        if (!isClientReady) {
          console.log('Клиент не готов к отправке сообщений');
          return;
        }

        const messageText = message.body.toLowerCase().trim();
        console.log('Получено сообщение:', messageText, 'от:', message.from);

        if (messageText === 'код') {
          verificationCode = generateVerificationCode();
          console.log(`Попытка отправить код: ${verificationCode} пользователю: ${message.from}`);
          
          try {
            // Используем sendMessage вместо reply
            await adminClient?.sendMessage(message.from, `Ваш код подтверждения: ${verificationCode}`);
            console.log(`Код успешно отправлен: ${verificationCode} пользователю: ${message.from}`);
            
            io.emit('admin:verification_code', {
              code: verificationCode,
              timestamp: Date.now(),
              recipient: message.from
            });
          } catch (error: any) {
            console.error('Ошибка при отправке кода:', error);
            try {
              await adminClient?.sendMessage(message.from, 'Произошла ошибка при отправке кода. Пожалуйста, попробуйте еще раз.');
            } catch (sendError: any) {
              console.error('Ошибка при отправке сообщения об ошибке:', sendError);
            }
          }
        }
      } catch (error: any) {
        console.error('Ошибка при обработке сообщения:', error);
      }
    });

    // Инициализируем клиент
    console.log('Инициализация админского клиента...');
    await adminClient.initialize();
    console.log('Админский клиент инициализирован');

    // Проверяем состояние сессии после инициализации
    if (checkExistingSession()) {
      console.log('Сессия успешно восстановлена');
    } else {
      console.log('Ожидание сканирования QR-кода для создания новой сессии');
    }
  } catch (error) {
    console.error('Ошибка при инициализации админского клиента:', error);
    throw error;
  }
};

// Получение текущего кода подтверждения
export const getVerificationCode = (): string | null => {
  return verificationCode;
};

// Генерация нового кода подтверждения
export const generateNewVerificationCode = (): string => {
  verificationCode = generateVerificationCode();
  console.log(`Сгенерирован новый код подтверждения: ${verificationCode}`);
  io.emit('admin:verification_code', {
    code: verificationCode,
    timestamp: Date.now()
  });
  return verificationCode;
}; 