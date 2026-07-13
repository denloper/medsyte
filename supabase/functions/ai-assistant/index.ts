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
    const { messages } = await req.json();

    // ✅ Используем OpenRouter API key
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY не настроен. Выполните: supabase secrets set OPENROUTER_API_KEY=ваш_ключ');
    }

    // ✅ Запрос к OpenRouter (OpenAI-совместимый API)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://denloper.github.io',
        'X-Title': 'Medical AI Assistant'
      },
      body: JSON.stringify({
        model: 'tencent/hy3:free',
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
      throw new Error(`OpenRouter API error (${response.status}): ${errorMsg}`);
    }

    const data = await response.json();
    
    if (!data.choices || data.choices.length === 0) {
      const reason = data.prompt_feedback?.block_reason || 'unknown';
      throw new Error(`OpenRouter не вернул ответ. Причина: ${reason}`);
    }
    
    const reply = data.choices[0]?.message?.content 
      || 'Извините, не удалось сгенерировать ответ. Попробуйте ещё раз.';

    return new Response(
      JSON.stringify({ reply, success: true, source: 'openrouter', model: 'tencent/hy3' }),
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