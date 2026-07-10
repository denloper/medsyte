/**
 * LOCAL DATABASE v1.1
 * IndexedDB через Dexie.js + шифрование + миграция из localStorage
 */
(function() {
  'use strict';

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

  async function init() {
    try {
      const Dexie = await loadDexie();
      db = new Dexie('FamilyDoctorDB');
      
      db.version(1).stores({
        users: '++id, email, &username, createdAt',
        familyMembers: '++id, userId, relation, name, createdAt',
        analyses: '++id, userId, familyMemberId, fileName, date, createdAt',
        diaryEntries: '++id, userId, familyMemberId, metricType, date, createdAt',
        healthEvents: '++id, userId, familyMemberId, eventType, scheduledDate, createdAt',
        medications: '++id, userId, familyMemberId, name, createdAt',
        settings: '++id, userId, key, value',
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
  //  КРИПТОГРАФИЯ
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
    
    const existing = await db.users.where('username').equals(username).first();
    if (existing) throw new Error('Пользователь с таким именем уже существует');
    
    if (email) {
      const existingEmail = await db.users.where('email').equals(email).first();
      if (existingEmail) throw new Error('Email уже используется');
    }
    
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);
    
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
    
    // Создаём профиль "Я"
    const memberId = await db.familyMembers.add({
      userId,
      relation: 'self',
      name: name || username,
      sex: sex || 'unknown',
      age: age || 0,
      isActive: true,
      createdAt: Date.now()
    });
    
    const token = generateToken();
    await db.sessions.add({
      userId,
      token,
      activeMemberId: memberId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    
    localStorage.setItem('session_token', token);
    localStorage.setItem('current_user_id', userId);
    localStorage.setItem('active_member_id', memberId);
    
    return { userId, memberId, token };
  }

  // ═══════════════════════════════════════
  //  ВХОД
  // ═══════════════════════════════════════
  async function login({ username, password }) {
    await ensureDB();
    
    const user = await db.users.where('username').equals(username).first();
    if (!user) throw new Error('Пользователь не найден');
    
    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) throw new Error('Неверный пароль');
    
    // Находим активный профиль
    let activeMember = await db.familyMembers
      .where('userId').equals(user.id)
      .and(m => m.isActive === true)
      .first();
    
    if (!activeMember) {
      activeMember = await db.familyMembers
        .where('userId').equals(user.id)
        .first();
    }
    
    const token = generateToken();
    await db.sessions.add({
      userId: user.id,
      token,
      activeMemberId: activeMember ? activeMember.id : null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    
    localStorage.setItem('session_token', token);
    localStorage.setItem('current_user_id', user.id);
    if (activeMember) localStorage.setItem('active_member_id', activeMember.id);
    
    return { userId: user.id, memberId: activeMember?.id, token, user };
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
    localStorage.removeItem('active_member_id');
  }

  // ═══════════════════════════════════════
  //  ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
  // ═══════════════════════════════════════
  async function getCurrentUser() {
    await ensureDB();
    const token = localStorage.getItem('session_token');
    const userId = localStorage.getItem('current_user_id');
    if (!token || !userId) return null;
    
    const session = await db.sessions
      .where('token').equals(token)
      .and(s => s.userId == userId && s.expiresAt > Date.now())
      .first();
    
    if (!session) {
      await logout();
      return null;
    }
    
    return await db.users.get(parseInt(userId));
  }

  async function getActiveMember() {
    await ensureDB();
    const memberId = localStorage.getItem('active_member_id');
    if (!memberId) return null;
    return await db.familyMembers.get(parseInt(memberId));
  }

  async function setActiveMember(memberId) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    const member = await db.familyMembers.get(memberId);
    if (!member || member.userId !== user.id) {
      throw new Error('Профиль не найден');
    }
    
    // Снимаем isActive со всех профилей
    const members = await db.familyMembers.where('userId').equals(user.id).toArray();
    for (const m of members) {
      await db.familyMembers.update(m.id, { isActive: false });
    }
    
    // Активируем выбранный
    await db.familyMembers.update(memberId, { isActive: true });
    localStorage.setItem('active_member_id', memberId);
    
    return member;
  }

  // ═══════════════════════════════════════
  //  СЕМЕЙНЫЕ ПРОФИЛИ
  // ═══════════════════════════════════════
  async function getFamilyMembers() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return [];
    return await db.familyMembers.where('userId').equals(user.id).sortBy('createdAt');
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
      isActive: false,
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
    const member = await db.familyMembers.get(memberId);
    if (!member) return;
    if (member.relation === 'self') throw new Error('Нельзя удалить основной профиль');
    
    await db.analyses.where('familyMemberId').equals(memberId).delete();
    await db.diaryEntries.where('familyMemberId').equals(memberId).delete();
    await db.healthEvents.where('familyMemberId').equals(memberId).delete();
    await db.medications.where('familyMemberId').equals(memberId).delete();
    await db.familyMembers.delete(memberId);
    
    // Если удалили активный — переключаем на self
    const activeId = localStorage.getItem('active_member_id');
    if (activeId == memberId) {
      const user = await getCurrentUser();
      const selfProfile = await db.familyMembers
        .where('userId').equals(user.id)
        .and(m => m.relation === 'self')
        .first();
      if (selfProfile) await setActiveMember(selfProfile.id);
    }
  }

  // ═══════════════════════════════════════
  //  АНАЛИЗЫ
  // ═══════════════════════════════════════
  async function saveAnalysis({ fileName, results, familyMemberId }) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    return await db.analyses.add({
      userId: user.id,
      familyMemberId: familyMemberId || null,
      fileName,
      results: JSON.stringify(results),
      date: Date.now(),
      createdAt: Date.now()
    });
  }

  async function getAnalyses(familyMemberId = null) {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return [];
    
    let query = db.analyses.where('userId').equals(user.id);
    if (familyMemberId) query = query.and(a => a.familyMemberId == familyMemberId);
    
    const analyses = await query.sortBy('date');
    return analyses.map(a => ({ ...a, results: JSON.parse(a.results) }));
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
    
    if (familyMemberId) query = query.and(e => e.familyMemberId == familyMemberId);
    
    const entries = await query.sortBy('date');
    return entries.map(e => ({ ...e, value: JSON.parse(e.value) }));
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
    if (familyMemberId) query = query.and(e => e.familyMemberId == familyMemberId);
    
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
  //  МИГРАЦИЯ ИЗ LOCALSTORAGE
  // ═══════════════════════════════════════
  async function migrateFromLocalStorage() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) return { migrated: false, reason: 'no_user' };
    
    const migrationKey = `migrated_for_user_${user.id}`;
    if (localStorage.getItem(migrationKey)) {
      return { migrated: false, reason: 'already_migrated' };
    }
    
    const stats = {
      familyMembers: 0,
      analyses: 0,
      diaryEntries: 0,
      healthEvents: 0
    };
    
    try {
      // 1. Миграция family_profiles_v4
      const profilesData = localStorage.getItem('family_profiles_v4');
      if (profilesData) {
        const profiles = JSON.parse(profilesData);
        const selfProfile = await db.familyMembers
          .where('userId').equals(user.id)
          .and(m => m.relation === 'self')
          .first();
        
        for (const p of profiles) {
          if (p.id === 'self') {
            // Обновляем существующий self-профиль
            if (selfProfile && p.name) {
              await db.familyMembers.update(selfProfile.id, { name: p.name });
            }
            continue;
          }
          // Создаём новый профиль
          await db.familyMembers.add({
            userId: user.id,
            relation: 'other',
            name: p.name,
            sex: 'unknown',
            age: 0,
            isActive: false,
            legacyId: p.id,
            createdAt: Date.now()
          });
          stats.familyMembers++;
        }
      }
      
      // 2. Миграция analysis_history_v4
      const historyData = localStorage.getItem('analysis_history_v4');
      if (historyData) {
        const history = JSON.parse(historyData);
        for (const memberId in history) {
          const entries = history[memberId] || [];
          for (const entry of entries) {
            await db.analyses.add({
              userId: user.id,
              familyMemberId: null,
              fileName: entry.label || 'Анализ',
              results: JSON.stringify({ count: entry.count }),
              date: entry.date,
              createdAt: entry.date,
              legacyMemberId: memberId
            });
            stats.analyses++;
          }
        }
      }
      
      // 3. Миграция health_diary_v1
      const diaryData = localStorage.getItem('health_diary_v1');
      if (diaryData) {
        const diary = JSON.parse(diaryData);
        for (const metricType in diary) {
          const entries = diary[metricType] || [];
          for (const entry of entries) {
            await db.diaryEntries.add({
              userId: user.id,
              familyMemberId: null,
              metricType,
              value: JSON.stringify(entry),
              date: entry.date || Date.now(),
              createdAt: entry.date || Date.now(),
              legacyId: entry.id
            });
            stats.diaryEntries++;
          }
        }
      }
      
      // 4. Миграция health_calendar_v1
      const calendarData = localStorage.getItem('health_calendar_v1');
      if (calendarData) {
        const calendar = JSON.parse(calendarData);
        const completed = calendar.completed || [];
        const planned = calendar.planned || [];
        
        for (const c of completed) {
          await db.healthEvents.add({
            userId: user.id,
            familyMemberId: null,
            eventType: c.id,
            title: c.id,
            scheduledDate: c.date,
            completed: true,
            completedAt: c.date,
            createdAt: c.date
          });
          stats.healthEvents++;
        }
        
        for (const p of planned) {
          await db.healthEvents.add({
            userId: user.id,
            familyMemberId: null,
            eventType: p.id,
            title: p.id,
            scheduledDate: p.date,
            completed: false,
            createdAt: p.createdAt || Date.now()
          });
          stats.healthEvents++;
        }
      }
      
      // Помечаем миграцию как выполненную
      localStorage.setItem(migrationKey, Date.now().toString());
      
      console.log('[DB] ✅ Миграция завершена:', stats);
      return { migrated: true, stats };
    } catch (err) {
      console.error('[DB] ❌ Ошибка миграции:', err);
      return { migrated: false, reason: 'error', error: err.message };
    }
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ/ИМПОРТ
  // ═══════════════════════════════════════
  async function exportUserData() {
    await ensureDB();
    const user = await getCurrentUser();
    if (!user) throw new Error('Не авторизован');
    
    const { passwordHash, salt, ...safeUser } = user;
    
    const data = {
      version: '1.1',
      exportDate: new Date().toISOString(),
      user: safeUser,
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
    
    if (!data.version) throw new Error('Несовместимая версия');
    
    const stats = { familyMembers: 0, analyses: 0, diaryEntries: 0, healthEvents: 0 };
    
    for (const member of data.familyMembers || []) {
      if (member.relation === 'self') continue;
      const { id, userId, isActive, legacyId, ...rest } = member;
      await db.familyMembers.add({ ...rest, userId: user.id, isActive: false });
      stats.familyMembers++;
    }
    
    for (const analysis of data.analyses || []) {
      const { id, userId, familyMemberId, legacyMemberId, ...rest } = analysis;
      await db.analyses.add({ ...rest, userId: user.id, familyMemberId: null });
      stats.analyses++;
    }
    
    for (const entry of data.diaryEntries || []) {
      const { id, userId, familyMemberId, legacyId, ...rest } = entry;
      await db.diaryEntries.add({ ...rest, userId: user.id, familyMemberId: null });
      stats.diaryEntries++;
    }
    
    for (const event of data.healthEvents || []) {
      const { id, userId, familyMemberId, ...rest } = event;
      await db.healthEvents.add({ ...rest, userId: user.id, familyMemberId: null });
      stats.healthEvents++;
    }
    
    return stats;
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
    
    // Очищаем все migration-ключи
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('migrated_for_user_')) localStorage.removeItem(k);
    });
    
    await logout();
  }

  async function ensureDB() {
    if (!db) await init();
  }

  window.LocalDB = {
    init,
    register, login, logout, getCurrentUser, getActiveMember, setActiveMember,
    getFamilyMembers, addFamilyMember, updateFamilyMember, deleteFamilyMember,
    saveAnalysis, getAnalyses, deleteAnalysis,
    saveDiaryEntry, getDiaryEntries,
    saveHealthEvent, getHealthEvents, markEventCompleted,
    exportUserData, importUserData,
    getUserStats, deleteAllUserData,
    migrateFromLocalStorage,
    version: '1.1.0'
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();