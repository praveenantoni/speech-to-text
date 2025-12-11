
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { TranscriptionSettings, TimestampMode } from '../types';

// This function converts a File object to a base64 encoded string
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // The result includes a prefix like "data:audio/mpeg;base64,", we only need the part after the comma
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Main function to call the Gemini API
export const transcribeAudio = async (
  settings: TranscriptionSettings,
  audioFile: File,
  audioDuration: number | null,
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const audioBase64 = await fileToBase64(audioFile);

  const isWordMode = settings.timestampMode === TimestampMode.WORDSTAMP;
  
  // Define the schema for structured JSON output with NUMERIC timestamps
  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        start: { type: Type.NUMBER, description: "Start time in seconds (e.g. 0.0, 1.5, 12.35)" },
        end: { type: Type.NUMBER, description: "End time in seconds (e.g. 1.5, 2.0, 13.0)" },
        text: { type: Type.STRING, description: isWordMode ? "Single spoken word" : "Complete sentence" },
      },
      required: ["start", "end", "text"],
    },
  };

  const systemInstruction = `You are a precision audio transcription engine.

  RULES:
  1. **Timestamps**: Return timestamps as raw NUMBERS (seconds), relative to the start of the file (0.0).
  2. **Start Time**: The first word typically starts near 0.0 seconds. Do NOT use embedded timecodes from metadata.
  3. **Content**: Listen carefully. Transcribe exactly what is spoken.
  4. **Granularity**: ${isWordMode ? "One object per single word." : "Group by complete sentences."}
  5. **Punctuation**: ${settings.punctuation === 'on' ? 'Include standard punctuation in the "text" field.' : 'Remove all punctuation.'}
  
  Format the response as a JSON Array.`;

  const userPrompt = `Transcribe the attached audio file.`;

  const parts = [
    { text: userPrompt },
    {
      inlineData: {
        mimeType: audioFile.type,
        data: audioBase64,
      },
    },
  ];

  // Retry logic for 503 (Overloaded) and 429 (Quota Exceeded)
  // We increase maxRetries to allow for longer waits on quota issues if necessary, 
  // though typically we just need one long wait.
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          systemInstruction,
          temperature: 0.0, // Absolute zero temperature for strict adherence to facts/timings
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      return response.text;
    } catch (error: any) {
      lastError = error;
      
      const errorCode = error.status || error.code;
      const errorMessage = error.message || '';
      
      // Check for Service Unavailable (503) or Quota Exceeded/Rate Limit (429)
      const isOverloaded = errorCode === 503 || errorMessage.toLowerCase().includes('overloaded') || errorCode === 'UNAVAILABLE';
      const isRateLimited = errorCode === 429 || errorCode === 'RESOURCE_EXHAUSTED' || errorMessage.toLowerCase().includes('quota');

      if ((isOverloaded || isRateLimited) && attempt < maxRetries - 1) {
        // Base backoff: 2s, 4s, 8s
        let waitTime = 2000 * Math.pow(2, attempt);

        // If the error message specifies a retry time (e.g., "Please retry in 37.2s"), respect it.
        // Regex looks for "retry in X s" or "retry in X.Y s"
        const retryMatch = errorMessage.match(/retry in ([\d\.]+)s/);
        if (retryMatch && retryMatch[1]) {
            // Add a small buffer (1s) to the requested time
            waitTime = Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000;
        }

        console.warn(`Gemini API Error (${errorCode}). Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        
        // If wait time is excessively long (> 60s), we might just want to fail 
        // to avoid hanging the UI too long, but for now we try.
        await delay(waitTime);
        continue;
      }
      
      // If it's not a retry-able error, or we ran out of retries, throw immediately
      throw error;
    }
  }

  throw lastError;
};
