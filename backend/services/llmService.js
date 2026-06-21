import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

let anthropic = null;
let googleGenAI = null;

if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here') {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
  googleGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

/**
 * Call the configured LLM API (GPT-4 or Claude first, then Gemini, then Mock fallback)
 */
async function callLLM(prompt, systemInstruction = '', jsonMode = false) {
  // 1. Try OpenAI GPT-4 if configured
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    try {
      console.log('Calling OpenAI GPT-4...');
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      });
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API error, trying Claude fallback...', error.response?.data || error.message);
    }
  }

  // 2. Try Anthropic Claude
  if (anthropic) {
    try {
      console.log('Calling Anthropic Claude...');
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 1000,
        system: systemInstruction,
        messages: [{ role: 'user', content: prompt }]
      });
      return response.content[0].text;
    } catch (error) {
      console.error('Anthropic API error, trying Gemini fallback...', error.message);
    }
  }

  // 3. Try Google Gemini
  if (googleGenAI) {
    try {
      console.log('Calling Google Gemini...');
      const model = googleGenAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined
      });
      
      const contents = [];
      if (systemInstruction) {
        contents.push({ role: 'user', parts: [{ text: `System Instruction: ${systemInstruction}\n\nUser Input: ${prompt}` }] });
      } else {
        contents.push({ role: 'user', parts: [{ text: prompt }] });
      }

      const result = await model.generateContent({ contents });
      const text = result.response.text();
      return text;
    } catch (error) {
      console.error('Gemini API error, falling back to simulation...', error.message);
    }
  }

  // 4. Fallback Simulation (Mock data generation)
  console.log('No LLM API keys configured. Generating simulated response...');
  return simulateLLM(prompt, systemInstruction, jsonMode);
}

/**
 * Generates personalized outreach drafts based on job description and contact info
 */
export async function generateOutreachEmail(leadName, industry, scrapedText = '', jobDescription = '', contactName = '') {
  const systemInstruction = `You are a professional business development representative. You write highly personalized, short, clean, non-salesy cold outreach emails. Keep the tone friendly, helpful, and inquisitive. Avoid generic buzzwords, fake compliments, or aggressive pitches. The email must be 3-5 sentences maximum and have a clear, soft call to action.`;

  const prompt = `Write a personalized outreach email to a business contact.
Lead Details:
- Company/Lead Name: ${leadName}
- Contact Person Name: ${contactName || 'Manager'}
- Industry: ${industry}
- Lead Job / Work Description: ${jobDescription || 'No description available.'}
- Website Snippet: ${scrapedText || 'No website text available.'}

Guidelines:
1. Address the recipient directly by their name if available: "${contactName}". Otherwise, start with "Hi there," or a professional greeting.
2. Focus the pitch on their specific work/job description: "${jobDescription}". Address how we can help with their current hiring needs, staffing, scaling, or operational goals.
3. Keep it extremely brief (3 to 5 sentences max).
4. Provide your output as a raw string containing the email body. Start with a greeting and end with a signature placeholder. Do not include a Subject line or any markdown headings in the body.`;

  const emailBody = await callLLM(prompt, systemInstruction);
  
  // Clean up email body format
  let cleanBody = emailBody.trim();
  // Generate a suitable subject line
  let subjectPrompt = `Generate a short, high-open-rate subject line (under 6 words) for an email with this body: "${cleanBody.substring(0, 200)}"`;
  let subject = await callLLM(subjectPrompt, 'You are an email marketing copywriter. Return ONLY the subject line text, without quotes or labels.');
  subject = subject.replace(/Subject:/i, '').replace(/"/g, '').trim();

  return {
    subject: subject || `Question regarding ${industry}`,
    body: cleanBody
  };
}

/**
 * Classifies an incoming reply from a lead
 * Returns structured JSON: { stage, intent_to_book, sentiment, key_facts }
 */
export async function classifyIncomingReply(messageHistory, incomingReply) {
  const systemInstruction = `You are an AI reply classifier for an outreach system.
Given the previous message history and a new incoming reply from a business lead, you must classify the conversation state.
You must return a raw JSON object with the following fields:
1. stage: string (one of: 'opened', 'engaged', 'qualifying', 'booking_offered', 'booked', 'not_interested')
   - 'engaged': Lead replied with general questions or mild interest.
   - 'qualifying': Lead is asking about price, timeline, or qualifications.
   - 'booking_offered': Lead agreed to a meeting or asked when we are free.
   - 'booked': Lead explicitly confirmed a specific time or scheduled a meeting via link.
   - 'not_interested': Lead said "no", "unsubscribe", "stop", or showed negative/disinterested sentiment.
2. intent_to_book: boolean (true if the lead exhibits explicit intent to schedule a phone call/meeting, false otherwise)
3. sentiment: string (positive, neutral, negative)
4. key_facts: string (concise facts extracted, e.g., "Available Wednesday afternoon", "Wants to know pricing first")`;

  const prompt = `Analyze the following thread.
Message History:
${JSON.stringify(messageHistory, null, 2)}

Incoming Reply:
"${incomingReply}"

Return ONLY the raw JSON object. Do not wrap in markdown code blocks.`;

  const responseText = await callLLM(prompt, systemInstruction, true);
  
  try {
    // Attempt to extract and parse JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(responseText);
  } catch (error) {
    console.error('Failed to parse classifier JSON, returning fallback.', error.message, 'Raw response:', responseText);
    // Safe fallback based on keyword search
    const lower = incomingReply.toLowerCase();
    let stage = 'engaged';
    let intent = false;
    if (lower.includes('unsubscribe') || lower.includes('stop') || lower.includes('not interested') || lower.includes('remove')) {
      stage = 'not_interested';
    } else if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('book') || lower.includes('time') || lower.includes('call') || lower.includes('meet')) {
      stage = 'booking_offered';
      intent = true;
    }
    return {
      stage,
      intent_to_book: intent,
      sentiment: stage === 'not_interested' ? 'negative' : 'neutral',
      key_facts: 'Failed to extract facts automatically.'
    };
  }
}

/**
 * Generates context-aware response based on the conversation stage
 */
export async function generateReplyResponse(stage, extractedFacts, messageHistory, incomingReply) {
  const systemInstruction = `You are a helpful, warm outreach assistant acting on behalf of a consulting/agency team.
Your goal is to guide the conversation step-by-step toward scheduling a quick 15-minute call.
Rules for each stage:
- 'engaged': Thank them, answer their questions briefly, build rapport. Do NOT push for a call yet.
- 'qualifying': Address their questions about cost/timeline/deliverables honestly but highlight that a quick call will give them exact numbers.
- 'booking_offered': Offer 2 specific times (e.g., "Tuesday at 2 PM or Thursday at 10 AM EST") or invite them to click a booking link: https://calendly.com/strategy-call/15min.
- 'booked': Thank them and let them know you've sent a calendar invite.
- 'not_interested': Respond politely, wishing them the best, and confirm you won't contact them again.

Keep all emails conversational, short (under 4 sentences), and very human. Do not sound like an AI.`;

  const prompt = `Generate the next reply email.
Current Stage: ${stage}
Extracted Facts: ${extractedFacts}
Message History:
${JSON.stringify(messageHistory, null, 2)}

Latest Lead Message:
"${incomingReply}"

Output ONLY the raw email body, starting with a polite greeting and ending with a signature.`;

  const emailBody = await callLLM(prompt, systemInstruction);
  return emailBody.trim();
}

/**
 * Mock LLM simulation for local demos without active API keys
 */
function simulateLLM(prompt, systemInstruction, jsonMode) {
  const promptLower = prompt.toLowerCase();
  
  if (jsonMode || systemInstruction.includes('classifier')) {
    // Simulating classifier
    let stage = 'engaged';
    let intent = false;
    let sentiment = 'positive';
    let keyFacts = 'User is interested in learning more.';

    if (promptLower.includes('not interested') || promptLower.includes('unsubscribe') || promptLower.includes('stop') || promptLower.includes('remove') || promptLower.includes('no thank')) {
      stage = 'not_interested';
      intent = false;
      sentiment = 'negative';
      keyFacts = 'Lead requested to opt out.';
    } else if (promptLower.includes('book') || promptLower.includes('call') || promptLower.includes('schedule') || promptLower.includes('time') || promptLower.includes('yes, let\'s') || promptLower.includes('free next week')) {
      stage = 'booking_offered';
      intent = true;
      sentiment = 'positive';
      keyFacts = 'Lead agreed to a call, scheduling info needed.';
    } else if (promptLower.includes('how much') || promptLower.includes('price') || promptLower.includes('cost') || promptLower.includes('pricing')) {
      stage = 'qualifying';
      intent = false;
      sentiment = 'neutral';
      keyFacts = 'Lead inquired about pricing.';
    }

    return JSON.stringify({
      stage,
      intent_to_book: intent,
      sentiment,
      key_facts: keyFacts
    });
  }

  // Simulating email generation/response
  if (prompt.includes('personalized outreach email')) {
    const businessNameMatch = prompt.match(/- Name:\s*(.*)/);
    const industryMatch = prompt.match(/- Industry:\s*(.*)/);
    const businessName = businessNameMatch ? businessNameMatch[1].trim() : 'your business';
    const industry = industryMatch ? industryMatch[1].trim() : 'services';

    return `Hi there,

I came across ${businessName} while searching for top ${industry} service providers. I was really impressed with your focus and local presence. 

We work with businesses in your industry to help streamline operations and bring in more clients. I'm curious if you are currently looking to scale up your outreach this quarter?

Would you be open to a quick 5-minute chat next week to see if there's any synergy?

Best regards,
Lead Specialist`;
  }

  if (prompt.includes('Generate the next reply email')) {
    const stageMatch = prompt.match(/Current Stage:\s*(.*)/);
    const stage = stageMatch ? stageMatch[1].trim() : 'engaged';

    if (stage === 'not_interested') {
      return `Understood. Thank you for your time, and I wish you all the best with your business. I'll make sure you're removed from our list.`;
    }
    if (stage === 'booking_offered' || stage === 'booked') {
      return `That sounds great! Let's get something scheduled. Here's a link to my calendar where you can pick a time that works best for you: https://calendly.com/strategy-call/15min\n\nLooking forward to speaking with you!`;
    }
    if (stage === 'qualifying') {
      return `Thanks for asking. Our services are tailored to each business's size and needs, so pricing typically ranges depending on setup. A quick 10-minute call would help me give you a much more accurate estimate. Would you be open to that?`;
    }
    return `Thanks for getting back to me! I'd love to share more about what we do and how it could benefit your business. What's the best way to share a quick overview?`;
  }

  // Default subject line or basic prompt answer
  if (prompt.includes('subject line')) {
    return 'Quick question for you';
  }

  return 'Simulated LLM response content.';
}
