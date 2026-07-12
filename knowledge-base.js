/**
 * Medical Knowledge Base Manager
 * Управляет базой медицинских знаний из PDF файлов
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'medical_knowledge_base_v1';
  const SUPABASE_TABLE = 'medical_knowledge';

  let knowledgeBase = {
    tests: [],           // Лабораторные тесты
    diagnoses: [],       // Диагнозы и состояния
    treatments: [],      // Схемы лечения
    drugs: [],           // Лекарства
    guidelines: [],      // Клинические рекомендации
    documents: [],       // Метаданные загруженных PDF
    lastUpdated: null
  };

  // ═══════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════
  function init() {
    loadFromLocalStorage();
    console.log(`📚 Knowledge Base initialized: ${getStats().total} entries`);
  }

  // ═══════════════════════════════════════
  //  ЗАГРУЗКА ИЗ LOCALSTORAGE
  // ═══════════════════════════════════════
  function loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        knowledgeBase = JSON.parse(saved);
        return true;
      }
    } catch (e) {
      console.warn('Failed to load knowledge base:', e);
    }
    return false;
  }

  // ═══════════════════════════════════════
  //  СОХРАНЕНИЕ В LOCALSTORAGE
  // ═══════════════════════════════════════
  function saveToLocalStorage() {
    try {
      knowledgeBase.lastUpdated = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(knowledgeBase));
      return true;
    } catch (e) {
      console.error('Failed to save knowledge base:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  ДОБАВЛЕНИЕ ДАННЫХ ИЗ PDF
  // ═══════════════════════════════════════
  function addFromPDF(pdfData) {
    const {
      fileName,
      content,
      tests = [],
      diagnoses = [],
      treatments = [],
      drugs = [],
      guidelines = []
    } = pdfData;

    // Добавляем документ в метаданные
    const docId = 'doc_' + Date.now();
    knowledgeBase.documents.push({
      id: docId,
      fileName,
      importedAt: new Date().toISOString(),
      stats: {
        tests: tests.length,
        diagnoses: diagnoses.length,
        treatments: treatments.length,
        drugs: drugs.length,
        guidelines: guidelines.length
      }
    });

    // Добавляем данные с привязкой к документу
    tests.forEach(t => knowledgeBase.tests.push({ ...t, source: docId }));
    diagnoses.forEach(d => knowledgeBase.diagnoses.push({ ...d, source: docId }));
    treatments.forEach(t => knowledgeBase.treatments.push({ ...t, source: docId }));
    drugs.forEach(d => knowledgeBase.drugs.push({ ...d, source: docId }));
    guidelines.forEach(g => knowledgeBase.guidelines.push({ ...g, source: docId }));

    saveToLocalStorage();
    return docId;
  }

  // ═══════════════════════════════════════
  //  ПОИСК ПО БАЗЕ ЗНАНИЙ
  // ═══════════════════════════════════════
  function search(query, options = {}) {
    const { limit = 10, categories = null } = options;
    const lowerQuery = query.toLowerCase();
    const keywords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
    
    const results = {
      tests: [],
      diagnoses: [],
      treatments: [],
      drugs: [],
      guidelines: []
    };

    // Функция оценки релевантности
    const score = (text) => {
      const lower = text.toLowerCase();
      return keywords.reduce((acc, kw) => {
        if (lower.includes(kw)) acc += 1;
        return acc;
      }, 0);
    };

    // Поиск по тестам
    if (!categories || categories.includes('tests')) {
      knowledgeBase.tests.forEach(test => {
        const text = `${test.name || ''} ${test.aliases?.join(' ') || ''} ${test.description || ''}`;
        const s = score(text);
        if (s > 0) results.tests.push({ ...test, _score: s });
      });
      results.tests.sort((a, b) => b._score - a._score);
      results.tests = results.tests.slice(0, limit);
    }

    // Поиск по диагнозам
    if (!categories || categories.includes('diagnoses')) {
      knowledgeBase.diagnoses.forEach(diag => {
        const text = `${diag.name || ''} ${diag.symptoms?.join(' ') || ''} ${diag.description || ''}`;
        const s = score(text);
        if (s > 0) results.diagnoses.push({ ...diag, _score: s });
      });
      results.diagnoses.sort((a, b) => b._score - a._score);
      results.diagnoses = results.diagnoses.slice(0, limit);
    }

    // Поиск по лечению
    if (!categories || categories.includes('treatments')) {
      knowledgeBase.treatments.forEach(treat => {
        const text = `${treat.name || ''} ${treat.indications?.join(' ') || ''} ${treat.description || ''}`;
        const s = score(text);
        if (s > 0) results.treatments.push({ ...treat, _score: s });
      });
      results.treatments.sort((a, b) => b._score - a._score);
      results.treatments = results.treatments.slice(0, limit);
    }

    // Поиск по лекарствам
    if (!categories || categories.includes('drugs')) {
      knowledgeBase.drugs.forEach(drug => {
        const text = `${drug.name || ''} ${drug.indications?.join(' ') || ''} ${drug.description || ''}`;
        const s = score(text);
        if (s > 0) results.drugs.push({ ...drug, _score: s });
      });
      results.drugs.sort((a, b) => b._score - a._score);
      results.drugs = results.drugs.slice(0, limit);
    }

    // Поиск по рекомендациям
    if (!categories || categories.includes('guidelines')) {
      knowledgeBase.guidelines.forEach(guide => {
        const text = `${guide.title || ''} ${guide.content || ''}`;
        const s = score(text);
        if (s > 0) results.guidelines.push({ ...guide, _score: s });
      });
      results.guidelines.sort((a, b) => b._score - a._score);
      results.guidelines = results.guidelines.slice(0, limit);
    }

    return results;
  }

  // ═══════════════════════════════════════
  //  ПОСТРОЕНИЕ КОНТЕКСТА ДЛЯ AI
  // ═══════════════════════════════════════
  function buildContextForAI(userMessage, maxTokens = 3000) {
    const results = search(userMessage, { limit: 5 });
    const context = [];
    let tokenEstimate = 0;

    // Формируем контекст из найденных данных
    if (results.tests.length > 0) {
      context.push('🧪 РЕЛЕВАНТНЫЕ ЛАБОРАТОРНЫЕ ТЕСТЫ ИЗ БАЗЫ ЗНАНИЙ:');
      results.tests.forEach(t => {
        const entry = `- ${t.name}${t.aliases ? ' (' + t.aliases.slice(0, 3).join(', ') + ')' : ''}: ${t.description || 'нет описания'}${t.norms ? '. Нормы: ' + JSON.stringify(t.norms) : ''}`;
        if (tokenEstimate + entry.length / 4 < maxTokens) {
          context.push(entry);
          tokenEstimate += entry.length / 4;
        }
      });
    }

    if (results.diagnoses.length > 0) {
      context.push('\n🏥 ВОЗМОЖНЫЕ ДИАГНОЗЫ ИЗ БАЗЫ ЗНАНИЙ:');
      results.diagnoses.forEach(d => {
        const entry = `- ${d.name}: ${d.description || ''}${d.symptoms ? '. Симптомы: ' + d.symptoms.slice(0, 5).join(', ') : ''}`;
        if (tokenEstimate + entry.length / 4 < maxTokens) {
          context.push(entry);
          tokenEstimate += entry.length / 4;
        }
      });
    }

    if (results.treatments.length > 0) {
      context.push('\n💊 СХЕМЫ ЛЕЧЕНИЯ ИЗ БАЗЫ ЗНАНИЙ:');
      results.treatments.forEach(t => {
        const entry = `- ${t.name}: ${t.description || ''}`;
        if (tokenEstimate + entry.length / 4 < maxTokens) {
          context.push(entry);
          tokenEstimate += entry.length / 4;
        }
      });
    }

    if (results.drugs.length > 0) {
      context.push('\n💊 ЛЕКАРСТВЕННЫЕ ПРЕПАРАТЫ:');
      results.drugs.forEach(d => {
        const entry = `- ${d.name}: ${d.description || ''}${d.dosage ? '. Дозировка: ' + d.dosage : ''}`;
        if (tokenEstimate + entry.length / 4 < maxTokens) {
          context.push(entry);
          tokenEstimate += entry.length / 4;
        }
      });
    }

    if (results.guidelines.length > 0) {
      context.push('\n📋 КЛИНИЧЕСКИЕ РЕКОМЕНДАЦИИ:');
      results.guidelines.forEach(g => {
        const entry = `- ${g.title}: ${g.content?.slice(0, 200) || ''}`;
        if (tokenEstimate + entry.length / 4 < maxTokens) {
          context.push(entry);
          tokenEstimate += entry.length / 4;
        }
      });
    }

    return context.length > 0 ? context.join('\n') : '';
  }

  // ═══════════════════════════════════════
  //  СТАТИСТИКА
  // ═══════════════════════════════════════
  function getStats() {
    return {
      documents: knowledgeBase.documents.length,
      tests: knowledgeBase.tests.length,
      diagnoses: knowledgeBase.diagnoses.length,
      treatments: knowledgeBase.treatments.length,
      drugs: knowledgeBase.drugs.length,
      guidelines: knowledgeBase.guidelines.length,
      total: knowledgeBase.tests.length + knowledgeBase.diagnoses.length + 
             knowledgeBase.treatments.length + knowledgeBase.drugs.length + 
             knowledgeBase.guidelines.length,
      lastUpdated: knowledgeBase.lastUpdated
    };
  }

  // ═══════════════════════════════════════
  //  ОЧИСТКА БАЗЫ
  // ═══════════════════════════════════════
  function clear() {
    knowledgeBase = {
      tests: [],
      diagnoses: [],
      treatments: [],
      drugs: [],
      guidelines: [],
      documents: [],
      lastUpdated: null
    };
    saveToLocalStorage();
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ / ИМПОРТ JSON
  // ═══════════════════════════════════════
  function exportJSON() {
    return JSON.stringify(knowledgeBase, null, 2);
  }

  function importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      knowledgeBase = data;
      saveToLocalStorage();
      return true;
    } catch (e) {
      console.error('Failed to import:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.MedicalKnowledgeBase = {
    addFromPDF,
    search,
    buildContextForAI,
    getStats,
    clear,
    exportJSON,
    importJSON,
    getAll: () => ({ ...knowledgeBase }),
    version: '1.0.0'
  };

  // Инициализация
  init();
})();