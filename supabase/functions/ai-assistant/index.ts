// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 🏆 Приоритетная очередь моделей
const MODELS = [
  'google/gemma-4-26b-a4b-it:free', // 🥇 ПРИОРИТЕТ #1 (лучшая для медицины)
  'supabase functions deploy ai-assistant',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY не настроен');
    }

    console.log(`📨 Request received (${messages.length} messages)`);

    let lastError = null;
    let usedModel = null;
    let reply = null;

    //  Пробуем каждую модель по очереди
    for (const model of MODELS) {
      try {
        console.log(`🤖 Trying: ${model}`);
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://denloper.github.io',
            'X-Title': 'Medical AI Assistant'
          },
          body: JSON.stringify({
            model: model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content
            })),
            temperature: 0.7,
            max_tokens: 2048,
            top_p: 0.95
          })
        });

        if (!response.ok) {
          let errorMsg = response.statusText;
          try {
            const errorData = await response.json();
            errorMsg = errorData.error?.message || errorMsg;
          } catch {}
          
          console.warn(`⚠️ ${model} failed (${response.status}): ${errorMsg}`);
          lastError = errorMsg;
          continue; // Переходим к следующей модели
        }

        const data = await response.json();
        
        if (!data.choices || data.choices.length === 0) {
          console.warn(`⚠️ ${model} returned empty choices`);
          lastError = 'Empty response';
          continue;
        }
        
        reply = data.choices[0]?.message?.content;
        usedModel = model;
        
        if (!reply || reply.trim() === '') {
          console.warn(`⚠️ ${model} returned empty content`);
          lastError = 'Empty content';
          continue;
        }
        
        console.log(`✅ SUCCESS with ${model}`);
        break; // Успех! Выходим из цикла
      } catch (modelError) {
        console.error(`❌ ${model} error:`, modelError.message);
        lastError = modelError.message;
        continue;
      }
    }

    // Если ни одна модель не ответила
    if (!reply) {
      console.error('❌ All models failed. Last error:', lastError);
      return new Response(
        JSON.stringify({ 
          reply: null,
          success: false, 
          error: `Все модели недоступны. Последняя ошибка: ${lastError}`,
          models_tried: MODELS
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        reply, 
        success: true, 
        source: 'openrouter', 
        model: usedModel 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Fatal error:', error);
    return new Response(
      JSON.stringify({ 
        reply: null,
        success: false, 
        error: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});