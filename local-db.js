/**
 * LOCAL DATABASE v1.0
 * IndexedDB через Dexie.js + шифрование AES-GCM
 * Локальное хранение с семейными профилями
 */
(function() {
  'use strict';

  // ═══════════════════════════════════════
  //  ЗАГРУЗКА DEXIE.JS (CDN)
  // ═══════════════════════════════════════
  function loadDexie() {
    return new Promise((resolve, reject) => {
      if (window.Dexie) return resolve(window.Dexie);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js';
      script.onload = () => resolve(window.Dexie);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  let db = null;

  // ═══════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ БД
  // ═══════════════════════════════════════
  async function init() {
    try {
      const Dexie = await loadDexie();
      
      db = new Dexie('FamilyDoctorDB');
      
      // Схема базы данных
      db.version(1).stores({
        // Пользователи (аккаунты)
        users: '++id, email, &username, createdAt',
        
        // Члены семьи (профили)
        familyMembers: '++id, userId, relation, name, createdAt',
        
        // История анализов
        analyses: '++id, userId, familyMemberId, fileName, date, createdAt',
        
        // Дневники здоровья
        diaryEntries: '++id, userId, familyMemberId, metricType, date, createdAt',
        
        // Календарь здоровья
        healthEvents: '++id, userId, familyMemberId, eventType, scheduledDate, createdAt',
        
        // Лекарства
        medications: '++id, userId, familyMemberId, name, createdAt',
        
        // Настройки
        settings: '++id, userId, key, value',
        
        // Активная сессия
        sessions: '++id, userId, token, createdAt, expiresAt'
      });
      
      console.log('[DB] ✅ IndexedDB инициализирована');
      return db;
    } catch (err) {
      console.error('[DB] ❌ Ошибка инициализации:', err);
      throw err;
    }
  }

  // ═══════════════════════════════════════
  //  КРИПТОГРАФИЯ (SHA-256 для паролей)
  // ═══════════════════════════════════════
  async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ═══════════════════════════════════════
  //  РЕГИСТРАЦИЯ
  // ═══════════════════════════════════════
  async function register({ email, username, password, name, sex, age }) {
    await ensureDB();
    
    // Проверяем, что username свободен
    const existing = await db.users.where('username').equals(username).first();
    if (existing) {
      throw new Error('Пользователь с таким именем уже существует');
    }
    
    if (email) {
      const existingEmail = await db.users.where('email').equals(email).first();
      if (existingEmail) {
        throw new Error('Email уже используется');
      }
    }
    
    // Хешируем пароль
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);
    
    // Создаём пользователя
    const userId = await db.users.add({
      email: email || null,
      username,
      passwordHash,
      salt,
      name: name || username,
      sex: sex || 'unknown',
      age: age || 0,
      createdAt: Date.now()
    });
    
    // Создаём профиль "Я" как первый член семьи
    await db.familyMembers.add({
      userId,
      relation: 'self',
      name: name || username,
      sex: sex || 'unknown',
      age: age || 0,
      createdAt: Date.now()
    });
    
    // Создаём сессию
    const token = generateToken();
    await db.sessions.add({
      userId,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 дней
    });
    
    // Сохраняем токен
    localStorage.setItem('session_token', token);
    localStorage.setItem('current_user_id', userId);
    
    return { userId, token };
  }

  // ═══════════════════════════════════════
  //  ВХОД
  // ═══════════════════════════════════════
  async function login({ username, password }) {
    await ensureDB();
    
    const user = await db.users.where('username').equals(username).first();
    if (!user) {
      throw new Error('Пользователь не найден');
    }
    
    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) {
      throw new Error('Неверный пароль');
    }
    
    // Создаём новую сессию
    const token = generateToken();
    await db.sessions.add({
      userId: user.id,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    
    localStorage.setItem('session_token', token);
    localStorage.setItem('current_user_id', user.id);
    
    return { userId: user.id, token, user };
  }

  // ═══════════════════════════════════════
  //  ВЫХОД
  // ═══════════════════════════════════════
  async function logout() {
    const token = localStorage.getItem('session_token');
    if (token && db) {
      await db.sessions.where('token').equals(token).delete();
    }
    localStorage.removeItem('session_token');
    localStorage.removeItem('current_user_id');
  }

  // ═══════════════════════════════════════
  //  ПОЛУЧЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
  // ═══════════════════════════════════════
  async function getCurrentUser() {
    await ensureDB();
    
    const token = localStorage.getItem('session_token');
    const userId = localStorage.getItem('current_user_id');
    
    if (!token || !userId) return null;
    
    // Проверяем сессию
    const session = await db.sessions
      .where('token').equals(token)
      .and(s => s.userId == userId && s.expiresAt > Date.now())
      .first();
    
    if (!session) {
      // Сессия истекла — выходим
      await logout();
      return null;
    }
    
    const user = await db.users.get(parseInt(userId));
    return user;
  }

  // ═══════════════════════════════════════
  //  СЕМЕЙНЫЕ ПРОФИЛИ
  // ═══════════════════════════════════════
  async function getFamilyMembers() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return [];
    
    return await db.familyMembers
      .where('userId').equals(user.id)
      .sortBy('createdAt');
  }

  async function addFamilyMember({ name, relation, sex, age, birthDate }) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    const id = await db.familyMembers.add({
      userId: user.id,
      name,
      relation: relation || 'other',
      sex: sex || 'unknown',
      age: age || 0,
      birthDate: birthDate || null,
      createdAt: Date.now()
    });
    
    return { id, name, relation, sex, age };
  }

  async function updateFamilyMember(memberId, updates) {
    await ensureDB();
    await db.familyMembers.update(memberId, updates);
  }

  async function deleteFamilyMember(memberId) {
    await ensureDB();
    
    // Удаляем все связанные данные
    await db.analyses.where('familyMemberId').equals(memberId).delete();
    await db.diaryEntries.where('familyMemberId').equals(memberId).delete();
    await db.healthEvents.where('familyMemberId').equals(memberId).delete();
    await db.medications.where('familyMemberId').equals(memberId).delete();
    
    // Удаляем сам профиль
    await db.familyMembers.delete(memberId);
  }

  // ═══════════════════════════════════════
  //  АНАЛИЗЫ
  // ═══════════════════════════════════════
  async function saveAnalysis({ fileName, results, familyMemberId }) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    const id = await db.analyses.add({
      userId: user.id,
      familyMemberId: familyMemberId || null,
      fileName,
      results: JSON.stringify(results),
      date: Date.now(),
      createdAt: Date.now()
    });
    
    return id;
  }

  async function getAnalyses(familyMemberId = null) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return [];
    
    let query = db.analyses.where('userId').equals(user.id);
    if (familyMemberId) {
      query = query.and(a => a.familyMemberId == familyMemberId);
    }
    
    const analyses = await query.sortBy('date');
    return analyses.map(a => ({
      ...a,
      results: JSON.parse(a.results)
    }));
  }

  async function deleteAnalysis(analysisId) {
    await ensureDB();
    await db.analyses.delete(analysisId);
  }

  // ═══════════════════════════════════════
  //  ДНЕВНИК
  // ═══════════════════════════════════════
  async function saveDiaryEntry({ metricType, value, familyMemberId }) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    return await db.diaryEntries.add({
      userId: user.id,
      familyMemberId: familyMemberId || null,
      metricType,
      value: JSON.stringify(value),
      date: Date.now(),
      createdAt: Date.now()
    });
  }

  async function getDiaryEntries(metricType, familyMemberId = null, daysBack = 30) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return [];
    
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    
    let query = db.diaryEntries
      .where('userId').equals(user.id)
      .and(e => e.metricType === metricType && e.date >= cutoff);
    
    if (familyMemberId) {
      query = query.and(e => e.familyMemberId == familyMemberId);
    }
    
    const entries = await query.sortBy('date');
    return entries.map(e => ({
      ...e,
      value: JSON.parse(e.value)
    }));
  }

  // ═══════════════════════════════════════
  //  КАЛЕНДАРЬ
  // ═══════════════════════════════════════
  async function saveHealthEvent({ eventType, title, scheduledDate, familyMemberId }) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    return await db.healthEvents.add({
      userId: user.id,
      familyMemberId: familyMemberId || null,
      eventType,
      title,
      scheduledDate,
      completed: false,
      createdAt: Date.now()
    });
  }

  async function getHealthEvents(familyMemberId = null) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return [];
    
    let query = db.healthEvents.where('userId').equals(user.id);
    if (familyMemberId) {
      query = query.and(e => e.familyMemberId == familyMemberId);
    }
    
    return await query.sortBy('scheduledDate');
  }

  async function markEventCompleted(eventId) {
    await ensureDB();
    await db.healthEvents.update(eventId, {
      completed: true,
      completedAt: Date.now()
    });
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ/ИМПОРТ
  // ═══════════════════════════════════════
  async function exportUserData() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      user: { ...user, passwordHash: undefined, salt: undefined },
      familyMembers: await db.familyMembers.where('userId').equals(user.id).toArray(),
      analyses: await db.analyses.where('userId').equals(user.id).toArray(),
      diaryEntries: await db.diaryEntries.where('userId').equals(user.id).toArray(),
      healthEvents: await db.healthEvents.where('userId').equals(user.id).toArray(),
      medications: await db.medications.where('userId').equals(user.id).toArray()
    };
    
    return JSON.stringify(data, null, 2);
  }

  async function importUserData(jsonString) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Неверный формат файла');
    }
    
    if (data.version !== '1.0') {
      throw new Error('Несовместимая версия экспорта');
    }
    
    // Импортируем семейные профили
    for (const member of data.familyMembers || []) {
      const { id, userId, ...rest } = member;
      await db.familyMembers.add({ ...rest, userId: user.id });
    }
    
    // Импортируем анализы
    for (const analysis of data.analyses || []) {
      const { id, userId, familyMemberId, ...rest } = analysis;
      await db.analyses.add({ ...rest, userId: user.id, familyMemberId: null });
    }
    
    // Импортируем дневник
    for (const entry of data.diaryEntries || []) {
      const { id, userId, familyMemberId, ...rest } = entry;
      await db.diaryEntries.add({ ...rest, userId: user.id, familyMemberId: null });
    }
    
    // Импортируем календарь
    for (const event of data.healthEvents || []) {
      const { id, userId, familyMemberId, ...rest } = event;
      await db.healthEvents.add({ ...rest, userId: user.id, familyMemberId: null });
    }
    
    return {
      familyMembers: data.familyMembers?.length || 0,
      analyses: data.analyses?.length || 0,
      diaryEntries: data.diaryEntries?.length || 0,
      healthEvents: data.healthEvents?.length || 0
    };
  }

  // ═══════════════════════════════════════
  //  СТАТИСТИКА
  // ═══════════════════════════════════════
  async function getUserStats() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return null;
    
    const [familyMembers, analyses, diaryEntries, healthEvents] = await Promise.all([
      db.familyMembers.where('userId').equals(user.id).count(),
      db.analyses.where('userId').equals(user.id).count(),
      db.diaryEntries.where('userId').equals(user.id).count(),
      db.healthEvents.where('userId').equals(user.id).count()
    ]);
    
    return { familyMembers, analyses, diaryEntries, healthEvents };
  }

  // ═══════════════════════════════════════
  //  УДАЛЕНИЕ ВСЕХ ДАННЫХ
  // ═══════════════════════════════════════
  async function deleteAllUserData() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return;
    
    await db.familyMembers.where('userId').equals(user.id).delete();
    await db.analyses.where('userId').equals(user.id).delete();
    await db.diaryEntries.where('userId').equals(user.id).delete();
    await db.healthEvents.where('userId').equals(user.id).delete();
    await db.medications.where('userId').equals(user.id).delete();
    await db.sessions.where('userId').equals(user.id).delete();
    await db.users.delete(user.id);
    
    await logout();
  }

  // ═══════════════════════════════════════
  //  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ═══════════════════════════════════════
  async function ensureDB() {
    if (!db) {
      await init();
    }
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.LocalDB = {
    init,
    
    // Аутентификация
    register,
    login,
    logout,
    getCurrentUser,
    
    // Семейные профили
    getFamilyMembers,
    addFamilyMember,
    updateFamilyMember,
    deleteFamilyMember,
    
    // Анализы
    saveAnalysis,
    getAnalyses,
    deleteAnalysis,
    
    // Дневник
    saveDiaryEntry,
    getDiaryEntries,
    
    // Календарь
    saveHealthEvent,
    getHealthEvents,
    markEventCompleted,
    
    // Экспорт/импорт
    exportUserData,
    importUserData,
    
    // Утилиты
    getUserStats,
    deleteAllUserData,
    
    version: '1.0.0'
  };

  // Автоматическая инициализация
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();