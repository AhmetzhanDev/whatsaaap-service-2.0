import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import authRoutes from './routes/auth';
import whatsappRoutes from './routes/whatsapp';
import integrationsRoutes from './routes/integrations';
import companyRoutes from './routes/company';
import { initAdminClient } from './whatsapp/adminClient';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';

dotenv.config();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3001'],
    methods: ['GET', 'POST']
  }
});

// Настройки CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001'],
  credentials: true
}));

// Логирование всех запросов
app.use(morgan('dev'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/company', companyRoutes);

interface JWTPayload {
  userId: string;
}

// Middleware для аутентификации WebSocket
io.use((socket, next) => {
  console.log('[WS-DEBUG] Попытка подключения к WebSocket');
  const token = socket.handshake.auth.token;
  
  if (!token) {
    console.log('[WS-DEBUG] Ошибка: токен не предоставлен');
    return next(new Error('Токен не предоставлен'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    socket.data.user = decoded;
    console.log('[WS-DEBUG] Успешная аутентификация WebSocket:', {
      socketId: socket.id,
      userId: decoded.userId
    });
    next();
  } catch (error) {
    console.log('[WS-DEBUG] Ошибка аутентификации:', error);
    return next(new Error('Недействительный токен'));
  }
});

// WebSocket подключения
io.on('connection', (socket: Socket) => {
  const userId = socket.data.user?.id;
  console.log('[WS-DEBUG] Новое WebSocket подключение:', {
    socketId: socket.id,
    userId: userId,
    timestamp: new Date().toISOString()
  });
  
  // Логируем все события
  socket.onAny((event, ...args) => {
    console.log('[WS-DEBUG] Получено событие:', {
      event,
      socketId: socket.id,
      userId: userId,
      args,
      timestamp: new Date().toISOString()
    });
  });

  // Обработчик отключения
  socket.on('disconnect', (reason) => {
    console.log('[WS-DEBUG] Клиент отключился:', {
      socketId: socket.id,
      userId: userId,
      reason,
      timestamp: new Date().toISOString()
    });
  });

  // Обработчик ошибок
  socket.on('error', (error) => {
    console.error('[WS-DEBUG] Ошибка WebSocket:', {
      socketId: socket.id,
      userId: userId,
      error,
      timestamp: new Date().toISOString()
    });
  });
});

// Экспортируем io для использования в других модулях
export { io };

// Инициализируем подключение к MongoDB
mongoose.connect(process.env.MONGO_URI!)
  .then(() => {
    console.log('Подключено к MongoDB');
  })
  .catch(err => {
    console.error('Ошибка подключения к MongoDB:', err);
  });

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`API доступен по адресу: http://localhost:${PORT}/api`);
  console.log(`WebSocket сервер запущен на ws://localhost:${PORT}`);
  
  // Инициализируем админский клиент при запуске сервера
  try {
    await initAdminClient();
    console.log('Админский клиент инициализирован');
  } catch (error) {
    console.error('Ошибка при инициализации админского клиента:', error);
  }
});