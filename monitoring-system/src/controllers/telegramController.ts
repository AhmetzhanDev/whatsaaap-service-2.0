import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';

export const createTelegramGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Пользователь не авторизован' });
      return;
    }
    res.json({ message: 'Telegram группа создана' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка создания группы' });
  }
};

export const sendTelegramAlert = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message } = req.body;
    res.json({ message: 'Уведомление отправлено' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка отправки уведомления' });
  }
}; 