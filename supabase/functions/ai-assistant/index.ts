// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Читаем тело запроса с защитой от пустого JSON
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { messages } = body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Получаем API-ключ OpenRouter из секретов
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      console.error('OPENROUTER_API_KEY не настроен');
      throw new Error('OPENROUTER_API_KEY не настроен');
    }

    // 3. Вызываем OpenRouter с моделью tencent/hy3:free
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tencent/hy3:free',   // <-- заменили Groq на Tencent Hy3
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content
        })),
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.95,                // этот параметр поддерживается OpenRouter
      })
    });

    if (!response.ok) {
      // Пытаемся распарсить ошибку от OpenRouter
      let errorMessage = `OpenRouter API error: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errorMessage = `OpenRouter API error: ${errorData.error.message}`;
        }
      } catch (_) {
        // если не удалось прочитать JSON, оставляем базовое сообщение
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('OpenRouter не вернул ответ');
    }

    const reply = data.choices[0]?.message?.content 
      || 'Извините, не удалось сгенерировать ответ.';

    // 4. Возвращаем успешный ответ
    return new Response(
      JSON.stringify({ reply, success: true, source: 'tencent-hy3' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message, success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});