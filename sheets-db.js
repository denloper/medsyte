/**
 * Google Sheets Database Loader
 * Загружает данные из публичных Google Sheets и кеширует в localStorage
 */
;(function() {
  'use strict';

  const CACHE_KEY = 'sheets_db_cache_v1';
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

  // ═══════════════════════════════════════
  //  КОНФИГУРАЦИЯ — замените на свои URL
  // ═══════════════════════════════════════
  const SHEETS_CONFIG = {
    tests: 'https://docs.google.com/spreadsheets/d/e/YOUR_ID/pub?gid=0&single=true&output=csv',
    clinics: 'https://docs.google.com/spreadsheets/d/e/YOUR_ID/pub?gid=123&single=true&output=csv',
    medications: 'https://docs.google.com/spreadsheets/d/e/YOUR_ID/pub?gid=456&single=true&output=csv',
    guidelines: 'https://docs.google.com/spreadsheets/d/e/YOUR_ID/pub?gid=789&single=true&output=csv',
    programs: 'https://docs.google.com/spreadsheets/d/e/YOUR_ID/pub?gid=101&single=true&output=csv'
  };

  // ═══════════════════════════════════════
  //  ПАРСИНГ CSV
  // ═══════════════════════════════════════
  function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0) continue;
      
      const row = {};
      headers.forEach((header, idx) => {
        row[header.trim()] = (values[idx] || '').trim();
      });
      data.push(row);
    }

    return data;
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  // ═══════════════════════════════════════
  //  ПРЕОБРАЗОВАНИЕ ДАННЫХ
  // ═══════════════════════════════════════
  function transformTests(rows) {
    return rows.map(row => ({
      id: row.id,
      canonicalName: row.canonicalName,
      shortName: row.shortName,
      category: row.category,
      units: row.units ? row.units.split(',') : [],
      aliases: row.aliases ? row.aliases.split(',').map(a => a.trim()) : [],
      references: [
        {
          sex: 'male',
          ageMin: 18,
          ageMax: 120,
          min: parseFloat(row.ref_male_min) || null,
          max: parseFloat(row.ref_male_max) || null,
          unit: row.unit_ref || ''
        },
        {
          sex: 'female',
          ageMin: 18,
          ageMax: 120,
          min: parseFloat(row.ref_female_min) || null,
          max: parseFloat(row.ref_female_max) || null,
          unit: row.unit_ref || ''
        }
      ]
    }));
  }

  function transformClinics(rows) {
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      city: row.city,
      address: row.address,
      phone: row.phone,
      rating: parseFloat(row.rating) || 0,
      specialties: row.specialties ? row.specialties.split(',') : [],
      priceRange: row.price_range,
      website: row.website
    }));
  }

  function transformMedications(rows) {
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      activeSubstance: row.active_substance,
      category: row.category,
      contraindications: row.contraindications ? row.contraindications.split(',') : [],
      interactions: row.interactions ? row.interactions.split(',') : []
    }));
  }

  function transformGuidelines(rows) {
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      keywords: row.keywords ? row.keywords.split(',') : [],
      source: row.source,
      symptoms: {
        typical: row.typical_symptoms ? row.typical_symptoms.split(',') : [],
        red_flags: row.red_flags ? row.red_flags.split(',') : []
      },
      actions: {
        home: row.actions_home ? row.actions_home.split(',') : [],
        avoid: row.actions_avoid ? row.actions_avoid.split(',') : []
      }
    }));
  }

  function transformPrograms(rows) {
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      priceOld: parseFloat(row.price_old) || null,
      priceNew: parseFloat(row.price_new) || null,
      badge: row.badge || ''
    }));
  }

  // ═══════════════════════════════════════
  //  КЕШИРОВАНИЕ
  // ═══════════════════════════════════════
  function loadFromCache() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const data = JSON.parse(cached);
      if (Date.now() - data.timestamp > CACHE_TTL) {
        return null; // Кеш истёк
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function saveToCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) {
      console.warn('[SheetsDB] Не удалось сохранить кеш:', e);
    }
  }

  // ═══════════════════════════════════════
  //  ЗАГРУЗКА ДАННЫХ
  // ═══════════════════════════════════════
  async function fetchSheet(name, url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return parseCSV(text);
    } catch (e) {
      console.warn(`[SheetsDB] Ошибка загрузки ${name}:`, e);
      return [];
    }
  }

  async function loadAll(forceRefresh = false) {
    // Проверяем кеш
    if (!forceRefresh) {
      const cached = loadFromCache();
      if (cached) {
        console.log('[SheetsDB] ✓ Загружено из кеша');
        return cached.data;
      }
    }

    console.log('[SheetsDB] ⏳ Загрузка из Google Sheets...');

    // Загружаем все таблицы параллельно
    const [tests, clinics, medications, guidelines, programs] = await Promise.all([
      fetchSheet('tests', SHEETS_CONFIG.tests),
      fetchSheet('clinics', SHEETS_CONFIG.clinics),
      fetchSheet('medications', SHEETS_CONFIG.medications),
      fetchSheet('guidelines', SHEETS_CONFIG.guidelines),
      fetchSheet('programs', SHEETS_CONFIG.programs)
    ]);

    // Трансформируем данные
    const data = {
      tests: transformTests(tests),
      clinics: transformClinics(clinics),
      medications: transformMedications(medications),
      guidelines: transformGuidelines(guidelines),
      programs: transformPrograms(programs)
    };

    // Сохраняем в кеш
    saveToCache(data);
    console.log('[SheetsDB] ✓ Загружено из Google Sheets', data);

    return data;
  }

  // ═══════════════════════════════════════
  //  API ДЛЯ РАБОТЫ С ДАННЫМИ
  // ═══════════════════════════════════════
  function findTest(canonicalName) {
    const cache = loadFromCache();
    if (!cache) return null;
    return cache.data.tests.find(t => t.canonicalName === canonicalName);
  }

  function findTestByAliasLocal(alias) {
    const cache = loadFromCache();
    if (!cache) return null;
    const lower = alias.toLowerCase().trim();
    return cache.data.tests.find(t => 
      t.aliases.some(a => a.toLowerCase().includes(lower))
    );
  }

  function getClinics(city = null) {
    const cache = loadFromCache();
    if (!cache) return [];
    if (city) {
      return cache.data.clinics.filter(c => c.city === city);
    }
    return cache.data.clinics;
  }

  function getPrograms(category = null) {
    const cache = loadFromCache();
    if (!cache) return [];
    if (category) {
      return cache.data.programs.filter(p => p.category === category);
    }
    return cache.data.programs;
  }

  function checkMedicationInteraction(med1, med2) {
    const cache = loadFromCache();
    if (!cache) return false;
    
    const med1Data = cache.data.medications.find(m => m.name === med1);
    if (!med1Data) return false;
    
    return med1Data.interactions.some(interaction => 
      interaction.toLowerCase().includes(med2.toLowerCase())
    );
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ
  // ═══════════════════════════════════════
  window.SheetsDB = {
    loadAll,
    findTest,
    findTestByAlias: findTestByAliasLocal,
    getClinics,
    getPrograms,
    checkMedicationInteraction,
    refresh: () => loadAll(true),
    version: '1.0.0'
  };

  // Автоматическая загрузка при старте
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadAll());
  } else {
    loadAll();
  }

})();