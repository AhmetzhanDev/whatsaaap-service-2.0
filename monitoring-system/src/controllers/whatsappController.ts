import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { WhatsAppAccountModel } from '../models/WhatsAppAccount';
import { sendVerificationCode, generateUserQR } from '../whatsapp/whatsappClient';
import { DockerService } from '../services/dockerService';
import mongoose from 'mongoose';
import { UserModel } from '../models/User';
import { io } from '../server';


const dockerService = DockerService.getInstance();

// Утилита для обработки ошибок и отправки ответа
const handleError = (res: Response, error: unknown, message: string, statusCode: number = 500) => {
  console.error(message, error);
  res.status(statusCode).json({ 
    success: false,
    message: message,
    qrCode: null
  });
};
// Отправка кода подтверждения через WhatsApp
const sendWhatsAppCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Не авторизован' });
      return;
    }

    // Получаем номер телефона пользователя из базы
    const user = await UserModel.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }

    // Отправляем код через WhatsApp
    const success = await sendVerificationCode(user.phoneNumber);
    if (!success) {
      res.status(500).json({ error: 'Не удалось отправить код' });
      return;
    }

    res.json({ message: 'Код успешно отправлен' });
  } catch (error: any) {
    console.error('Ошибка при отправке кода:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};

// 📌 2. Добавление аккаунта WhatsApp
const createWhatsAppAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyName, avgResponseTime, secondTouch } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: 'Пользователь не авторизован' });
      return;
    }

    // Проверяем, есть ли уже аккаунт у пользователя
    const existingAccount = await WhatsAppAccountModel.findOne({ userId });
    if (existingAccount) {
      res.status(400).json({ message: 'У вас уже есть WhatsApp аккаунт' });
      return;
    }

    // Создаем новый аккаунт
    const account = await WhatsAppAccountModel.create({
      userId,
      companyName,
      avgResponseTime,
      secondTouch
    });

    // Создаем Docker контейнер для WhatsApp сессии
    const containerName = await dockerService.createWhatsAppContainer(account.id);

    res.status(201).json({ 
      message: 'WhatsApp аккаунт добавлен', 
      account: {
        id: account.id,
        companyName: account.companyName,
        avgResponseTime: account.avgResponseTime,
        secondTouch: account.secondTouch
      }
    });
  } catch (error) {
    handleError(res, error, 'Ошибка при создании WhatsApp аккаунта');
  }
};

// 📌 3. Получение статуса контейнера
const getContainerStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const status = await dockerService.getContainerStatus(accountId);
    res.json({ status });
  } catch (error) {
    handleError(res, error, 'Ошибка получения статуса контейнера');
  }
};

// 📌 4. Остановка контейнера
const stopContainer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    await dockerService.stopWhatsAppContainer(accountId);
    res.json({ message: 'Контейнер остановлен' });
  } catch (error) {
    handleError(res, error, 'Ошибка остановки контейнера');
  }
};

// Получение списка WhatsApp аккаунтов пользователя
const getWhatsAppAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Пользователь не авторизован' });
      return;
    }

    const accounts = await WhatsAppAccountModel.find({ userId });

    // Получаем статус для каждого контейнера
    const accountsWithStatus = await Promise.all(
      accounts.map(async (account) => {
        const status = await dockerService.getContainerStatus(account.id);
        return {
          ...account.toObject(),
          containerStatus: status
        };
      })
    );

    res.json({ accounts: accountsWithStatus });
  } catch (error) {
    handleError(res, error, 'Ошибка при получении списка аккаунтов');
  }
};

// Удаление WhatsApp аккаунта
const deleteWhatsAppAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Пользователь не авторизован' });
      return;
    }

    // Останавливаем контейнер
    await dockerService.stopWhatsAppContainer(accountId);

    const account = await WhatsAppAccountModel.findOneAndDelete({ 
      _id: accountId,
      userId 
    });

    if (!account) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    res.json({ message: 'Аккаунт удален' });
  } catch (error) {
    handleError(res, error, 'Ошибка при удалении аккаунта');
  }
};

// Получение QR-кода для пользователя
const getUserQR = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('[QR-DEBUG] Получен запрос на генерацию QR-кода');
    
    const userId = req.user?.id;
    if (!userId) {
      console.log('[QR-DEBUG] Ошибка: пользователь не авторизован');
      res.status(401).json({ 
        success: false,
        message: 'Не авторизован'
      });
      return;
    }

    console.log('[QR-DEBUG] Запрос QR-кода для пользователя:', userId);

    // Отключаем кэширование
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    // Генерируем QR-код для пользователя
    console.log('[QR-DEBUG] Начинаем генерацию QR-кода');
    const qrCode = await generateUserQR(userId, io);
    console.log('[QR-DEBUG] QR-код успешно сгенерирован');
    
    // Отправляем начальный ответ
    res.json({ 
      success: true,
      qrCode: qrCode,
      message: 'Генерация QR-кода начата. Ожидайте получения через WebSocket.'
    });
    console.log('[QR-DEBUG] Ответ отправлен клиенту');

  } catch (error) {
    console.error('[QR-DEBUG] Ошибка при генерации QR-кода:', error);
    handleError(res, error, 'Ошибка при генерации QR-кода');
  }
};

// Обработка сканирования QR-кода
const handleQRScanned = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Не авторизован' });
      return;
    }

    // Обновляем статус пользователя
    await UserModel.findByIdAndUpdate(userId, { whatsappAuthorized: true });
    res.json({ message: 'QR-код успешно отсканирован' });
  } catch (error) {
    handleError(res, error, 'Ошибка при обработке сканирования QR-кода');
  }
};

// Получение статуса QR-кода
const getQRCodeStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Не авторизован' });
      return;
    }

    // Получаем пользователя и проверяем статус авторизации WhatsApp
    const user = await UserModel.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }

    res.json({ 
      status: user.whatsappAuthorized ? 'authorized' : 'pending',
      whatsappAuthorized: user.whatsappAuthorized
    });
  } catch (error) {
    handleError(res, error, 'Ошибка при получении статуса QR-кода');
  }
};

// Функция для периодической отправки статуса
const sendStatusUpdate = async (userId: string, res: Response) => {
  try {
    const user = await UserModel.findById(userId);
    if (!user) {
      return false;
    }
    
    // Отправляем статус
    res.write(`data: ${JSON.stringify({
      success: true,
      qrScanned: user.whatsappAuthorized,
      message: user.whatsappAuthorized ? 'QR-код отсканирован' : 'QR-код не отсканирован'
    })}\n\n`);
    
    return user.whatsappAuthorized;
  } catch (error) {
    console.error('Ошибка при отправке статуса:', error);
    return false;
  }
};

// Проверка статуса QR-кода
const checkQRStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Не авторизован' });
      return;
    }

    // Настраиваем SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Отправляем статус каждые 5 секунд
    const interval = setInterval(async () => {
      const isScanned = await sendStatusUpdate(userId, res);
      if (isScanned) {
        clearInterval(interval);
        res.end();
      }
    }, 5000);

    // Очищаем интервал при закрытии соединения
    req.on('close', () => {
      clearInterval(interval);
    });

  } catch (error) {
    handleError(res, error, 'Ошибка при проверке статуса QR-кода');
  }
};

// Экспорт всех функций
export {
  sendWhatsAppCode,
  createWhatsAppAccount,
  getContainerStatus,
  stopContainer,
  getWhatsAppAccounts,
  deleteWhatsAppAccount,
  getUserQR,
  handleQRScanned,
  getQRCodeStatus,
  checkQRStatus
};