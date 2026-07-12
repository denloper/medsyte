// @ts-ignore - Deno types are available at runtime in Supabase Edge Functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Типизация для Deno env (игнорируем ошибки в VS Code)
// @ts-ignore
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ✅ Явная типизация сообщений
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ✅ Типизация тела запроса к Gemini
interface GeminiRequestBody {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    topP: number;
  };
  safetySettings: Array<{
    category: string;
    threshold: string;
  }>;
}

// ✅ Явная типизация Request (вместо any)
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json() as { messages: Message[] };

    // 🔒 Получаем ключ из переменных окружения
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY не настроен. Выполните: supabase secrets set GEMINI_API_KEY=ваш_ключ');
    }

    // Разделяем системный промпт и пользовательские сообщения
    const systemMessage = messages.find((m: Message) => m.role === 'system');
    const conversationMessages = messages.filter((m: Message) => m.role !== 'system');

    // Формируем contents (только user и model)
    const contents = conversationMessages.map((m: Message) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Формируем тело запроса
    const requestBody: GeminiRequestBody = {
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        topP: 0.95
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    // Добавляем systemInstruction для Gemini 1.5+
    if (systemMessage) {
      requestBody.systemInstruction = {
        parts: [{ text: systemMessage.content }]
      };
    }

    // Вызов Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    // Проверяем HTTP статус
    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // игнорируем ошибку парсинга
      }
      throw new Error(`Gemini API error: ${errorMessage}`);
    }

    const data = await response.json();
    
    // Проверяем наличие candidates
    if (!data.candidates || data.candidates.length === 0) {
      const reason = data.promptFeedback?.blockReason || 'unknown';
      throw new Error(`Gemini не вернул ответ. Причина: ${reason}. Возможно сработал фильтр безопасности.`);
    }
    
    const reply = data.candidates[0]?.content?.parts?.[0]?.text 
      || 'Извините, не удалось сгенерировать ответ. Попробуйте ещё раз.';

    return new Response(
      JSON.stringify({ reply, success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    // Правильная обработка unknown error
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error('Error:', errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});