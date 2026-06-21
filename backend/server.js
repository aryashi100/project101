import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import prisma from './prismaClient.js';
import { 
  getOAuth2Client, 
  searchPlaces, 
  exportLeadsToSheet, 
  sendEmailViaGmail, 
  createCalendarEvent, 
  pollGmailReplies 
} from './services/googleService.js';
import { scrapeLeads } from './services/scraperService.js';
import { 
  generateOutreachEmail, 
  classifyIncomingReply, 
  generateReplyResponse 
} from './services/llmService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Helper to pause execution (randomized delay between sends)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to identify and override stale mock data values
function isMockValue(val) {
  if (!val) return true;
  const mockNames = ['Alice Smith', 'Robert Johnson', 'Emily Davis', 'Michael Brown', 'Sarah Wilson', 'David Taylor', 'James Miller', 'Manager', 'Owner'];
  const lower = val.toLowerCase();
  if (mockNames.includes(val)) return true;
  if (lower.includes('example.com') || lower.includes('example-')) return true;
  if (lower.includes('555-') || lower.includes('(555)')) return true;
  if (lower.includes('simulated') || lower.includes('mock')) return true;
  return false;
}


/**
 * -------------------------------------------------------------
 * 1. GOOGLE OAUTH ENDPOINTS
 * -------------------------------------------------------------
 */

// Generate Auth URL
app.get('/api/auth/google', async (req, res) => {
  try {
    const oauth2Client = oauth2ClientInstance(req);
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    res.json({ url: authUrl });
  } catch (error) {
    res.status(500).json({ error: 'OAuth setup failed. Ensure client details are in .env.' });
  }
});

// OAuth Callback Handler
app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Authorization code missing.');

  try {
    const oauth2Client = oauth2ClientInstance(req);
    const { tokens } = await oauth2Client.getToken(code);
    
    // Save tokens in DB
    await prisma.setting.upsert({
      where: { key: 'google_access_token' },
      update: { value: tokens.access_token },
      create: { key: 'google_access_token', value: tokens.access_token }
    });

    if (tokens.refresh_token) {
      await prisma.setting.upsert({
        where: { key: 'google_refresh_token' },
        update: { value: tokens.refresh_token },
        create: { key: 'google_refresh_token', value: tokens.refresh_token }
      });
    }

    if (tokens.expiry_date) {
      await prisma.setting.upsert({
        where: { key: 'google_token_expiry' },
        update: { value: tokens.expiry_date.toString() },
        create: { key: 'google_token_expiry', value: tokens.expiry_date.toString() }
      });
    }

    // Redirect to frontend dashboard (default local React port is 5173)
    res.send(`
      <html>
        <body>
          <h2>Google Account connected successfully!</h2>
          <p>You can close this window now.</p>
          <script>
            setTimeout(() => { window.close(); }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback exchange failed:', error);
    res.status(500).send('OAuth authentication failed.');
  }
});

// Get connection status
app.get('/api/auth/status', async (req, res) => {
  try {
    const client = await getOAuth2Client();
    res.json({ connected: client !== null });
  } catch (error) {
    res.json({ connected: false });
  }
});

// Disconnect OAuth
app.post('/api/auth/disconnect', async (req, res) => {
  try {
    await prisma.setting.deleteMany({
      where: {
        key: { in: ['google_access_token', 'google_refresh_token', 'google_token_expiry'] }
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Private helper to instantiate clean OAuth2 Client
function oauth2ClientInstance(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  let redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
    }
  }

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client details missing in backend env.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}


/**
 * -------------------------------------------------------------
 * 2. LEADS MANAGEMENT ENDPOINTS
 * -------------------------------------------------------------
 */

// Get all leads
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Source leads from Google Places & Scrape Websites
app.post('/api/leads/source', async (req, res) => {
  const { industry, location, count } = req.body;

  if (!industry || !location) {
    return res.status(400).json({ error: 'Industry and location are required.' });
  }

  try {
    console.log(`Sourcing leads: Industry: ${industry}, Location: ${location}, Count: ${count}`);
    
    // 1. Search Places
    const places = await searchPlaces(industry, location, parseInt(count, 10) || 5);
    console.log(`Found ${places.length} places from Google Places API.`);

    // 2. Scrape website of each place to find email and text context
    const scrapedResults = await scrapeLeads(places);
    console.log('Web scraping process completed.');

    // 3. Save to database
    const savedLeads = [];
    for (const lead of scrapedResults) {
      // Check if place already exists
      const existing = await prisma.lead.findFirst({
        where: { name: lead.name, location: lead.location }
      });

      if (!existing) {
        const saved = await prisma.lead.create({
          data: {
            name: lead.name,
            industry: lead.industry,
            location: lead.location,
            phone: lead.phone,
            website: lead.website,
            email: lead.scrapedEmail, // Use scraped email
            contactName: lead.contactName, // Save contact person name
            linkedinUrl: lead.linkedinUrl, // Save LinkedIn profile URL
            jobDescription: lead.jobDescription, // Save job/careers info
            scrapedContent: lead.scrapedContent,
            status: 'new'
          }
        });
        savedLeads.push(saved);
      } else {
        // Update existing lead with newly scraped information, overwriting any stale mock values
        const updated = await prisma.lead.update({
          where: { id: existing.id },
          data: {
            phone: isMockValue(existing.phone) ? lead.phone : existing.phone || lead.phone,
            email: isMockValue(existing.email) ? lead.scrapedEmail : existing.email || lead.scrapedEmail,
            contactName: isMockValue(existing.contactName) ? lead.contactName : existing.contactName || lead.contactName,
            linkedinUrl: isMockValue(existing.linkedinUrl) ? lead.linkedinUrl : existing.linkedinUrl || lead.linkedinUrl,
            jobDescription: isMockValue(existing.jobDescription) ? lead.jobDescription : existing.jobDescription || lead.jobDescription,
            scrapedContent: isMockValue(existing.scrapedContent) ? lead.scrapedContent : existing.scrapedContent || lead.scrapedContent
          }
        });
        savedLeads.push(updated);
      }
    }

    res.json({ message: `Successfully sourced ${savedLeads.length} leads.`, leads: savedLeads });

  } catch (error) {
    console.error('Lead sourcing endpoint failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create manual lead (used by "Claim Listing" feature)
app.post('/api/leads/manual', async (req, res) => {
  const { name, industry, location, phone, website, email, jobDescription, scrapedContent } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Company name and owner email are required.' });
  }

  try {
    const saved = await prisma.lead.create({
      data: {
        name,
        industry: industry || 'Local Business',
        location: location || 'Unknown',
        phone: phone || null,
        website: website || null,
        email,
        contactName: 'Owner',
        jobDescription: jobDescription || null,
        scrapedContent: scrapedContent || `Manually claimed listing.`,
        status: 'new'
      }
    });

    res.json({ message: 'Listing successfully claimed & imported.', lead: saved });
  } catch (error) {
    console.error('Manual lead creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});


// Generate email drafts for leads
app.post('/api/leads/generate-drafts', async (req, res) => {
  const { leadIds } = req.body;

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'Valid array of leadIds is required.' });
  }

  try {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } }
    });

    const updatedLeads = [];
    for (const lead of leads) {
      console.log(`Generating draft for: ${lead.name}`);
      const draft = await generateOutreachEmail(
        lead.name,
        lead.industry,
        lead.scrapedContent || '',
        lead.jobDescription || '',
        lead.contactName || ''
      );
      
      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          draftSubject: draft.subject,
          draftBody: draft.body
        }
      });
      updatedLeads.push(updated);
    }

    res.json({ message: `Drafts generated for ${updatedLeads.length} leads.`, leads: updatedLeads });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit draft content manually
app.post('/api/leads/update-draft', async (req, res) => {
  const { leadId, subject, body } = req.body;

  if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

  try {
    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        draftSubject: subject,
        draftBody: body
      }
    });
    res.json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send outreach emails via Gmail
app.post('/api/leads/send', async (req, res) => {
  const { leadIds } = req.body;

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'Valid array of leadIds is required.' });
  }

  try {
    const leads = await prisma.lead.findMany({
      where: { 
        id: { in: leadIds },
        draftBody: { not: null },
        email: { not: null }
      }
    });

    if (leads.length === 0) {
      return res.status(400).json({ error: 'No matching leads with valid emails and drafts to send.' });
    }

    const sentLeads = [];
    for (const lead of leads) {
      // Configurable delay (randomized between 2 to 5 seconds to avoid spam triggers)
      const randomWait = Math.floor(Math.random() * 3000) + 2000;
      console.log(`Waiting ${randomWait}ms before sending email to ${lead.email}...`);
      await delay(randomWait);

      console.log(`Sending outreach email to ${lead.name} (${lead.email})...`);
      
      const emailResponse = await sendEmailViaGmail(
        lead.email, 
        lead.draftSubject, 
        lead.draftBody
      );

      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'contacted',
          threadId: emailResponse.threadId,
          lastContactedAt: new Date()
        }
      });

      // Initialize the conversation history for this lead
      const messageHistory = JSON.stringify([
        { role: 'assistant', content: lead.draftBody, timestamp: new Date().toISOString() }
      ]);

      await prisma.conversation.upsert({
        where: { id: lead.id }, // Wait, map id of lead directly to conversation or let it auto-gen uuid. Since there is 1-to-many relationship in schema, we will query by leadId. Let's create a new row:
        create: {
          leadId: lead.id,
          messageHistory,
          stage: 'opened',
          extractedFacts: '{}',
          turnCount: 1
        },
        update: {
          messageHistory,
          stage: 'opened',
          extractedFacts: '{}',
          turnCount: 1
        }
      });

      sentLeads.push(updated);
    }

    res.json({ message: `Successfully sent outreach to ${sentLeads.length} leads.`, leads: sentLeads });

  } catch (error) {
    console.error('Email sending endpoint failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export leads to Google Sheet
app.post('/api/leads/export', async (req, res) => {
  const { leadIds, sheetUrl } = req.body;

  if (!leadIds || !Array.isArray(leadIds) || !sheetUrl) {
    return res.status(400).json({ error: 'leadIds array and sheetUrl are required.' });
  }

  try {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } }
    });

    const result = await exportLeadsToSheet(sheetUrl, leads);
    res.json({ success: true, simulated: result.simulated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear leads database
app.post('/api/leads/delete', async (req, res) => {
  const { leadIds } = req.body;
  try {
    if (leadIds && Array.isArray(leadIds)) {
      await prisma.lead.deleteMany({
        where: { id: { in: leadIds } }
      });
    } else {
      await prisma.lead.deleteMany({});
      await prisma.conversation.deleteMany({});
    }
    res.json({ success: true, message: 'Leads cleared successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * -------------------------------------------------------------
 * 3. CONVERSATION / REPLY HANDLING ENDPOINTS
 * -------------------------------------------------------------
 */

// Get conversation thread for a lead
app.get('/api/conversations/thread/:leadId', async (req, res) => {
  const { leadId } = req.params;
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { leadId }
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation thread not found.' });
    }
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin review list (turn count > 6 or status = 'review_required')
app.get('/api/conversations/review', async (req, res) => {
  try {
    const reviewLeads = await prisma.lead.findMany({
      where: {
        OR: [
          { status: 'review_required' },
          {
            conversations: {
              some: {
                turnCount: { gte: 6 }
              }
            }
          }
        ]
      },
      include: {
        conversations: true
      }
    });
    res.json(reviewLeads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Poll real Gmail API replies and auto-handle them
app.post('/api/conversations/poll', async (req, res) => {
  try {
    console.log('Polling Gmail for replies...');
    const replies = await pollGmailReplies();
    console.log(`Found ${replies.length} new replies via Gmail API.`);

    const processed = [];
    for (const reply of replies) {
      const result = await handleIncomingReplyLogic(reply.leadId, reply.replyText);
      processed.push(result);
    }

    res.json({ success: true, repliesProcessed: processed.length, data: processed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MOCK reply trigger for frontend demoing/simulation
app.post('/api/conversations/mock-reply', async (req, res) => {
  const { leadId, replyText } = req.body;
  if (!leadId || !replyText) {
    return res.status(400).json({ error: 'leadId and replyText are required.' });
  }

  try {
    console.log(`Simulating mock reply from lead: ${leadId}. Reply: "${replyText}"`);
    const result = await handleIncomingReplyLogic(leadId, replyText);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Mock reply failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manually edit & send reply draft from admin queue
app.post('/api/conversations/approve-reply', async (req, res) => {
  const { leadId, replyText } = req.body;
  if (!leadId || !replyText) {
    return res.status(400).json({ error: 'leadId and replyText are required.' });
  }

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { conversations: true }
    });

    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!lead.email) return res.status(400).json({ error: 'Lead does not have an email address.' });

    // Send via Gmail
    const mailResult = await sendEmailViaGmail(
      lead.email,
      `Re: ${lead.draftSubject || 'Our Strategy Call'}`,
      replyText,
      lead.threadId
    );

    // Update conversation
    const conversation = lead.conversations[0];
    if (conversation) {
      const history = JSON.parse(conversation.messageHistory);
      history.push({ role: 'assistant', content: replyText, timestamp: new Date().toISOString() });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageHistory: JSON.stringify(history),
          turnCount: conversation.turnCount + 1,
          lastUpdated: new Date()
        }
      });
    }

    // Reset status back from review_required if needed
    if (lead.status === 'review_required') {
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'replied' }
      });
    }

    res.json({ success: true, message: 'Manual reply sent successfully.' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * -------------------------------------------------------------
 * 4. BOOKINGS / CALENDAR ENDPOINTS
 * -------------------------------------------------------------
 */

// Book a confirmed call in Google Calendar
app.post('/api/bookings/create', async (req, res) => {
  const { leadId, summary, startTime, endTime } = req.body;

  if (!leadId || !summary || !startTime || !endTime) {
    return res.status(400).json({ error: 'leadId, summary, startTime, and endTime are required.' });
  }

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });

    console.log(`Booking Google Calendar Event for lead: ${lead.name}`);
    const calendarResult = await createCalendarEvent(
      summary,
      startTime,
      endTime,
      `Outreach onboarding chat with ${lead.name}. Contact website: ${lead.website || 'N/A'}`
    );

    // Update lead status to 'booked'
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'booked' }
    });

    // Update conversation status to 'booked'
    const conversation = await prisma.conversation.findFirst({ where: { leadId } });
    if (conversation) {
      const history = JSON.parse(conversation.messageHistory);
      history.push({ 
        role: 'system', 
        content: `Meeting confirmed & booked on Google Calendar: ${summary} (${new Date(startTime).toLocaleString()})`, 
        timestamp: new Date().toISOString() 
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          stage: 'booked',
          messageHistory: JSON.stringify(history),
          lastUpdated: new Date()
        }
      });
    }

    res.json({ success: true, calendarEventId: calendarResult.eventId, simulated: calendarResult.simulated });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * -------------------------------------------------------------
 * CORE AGENT LOGIC FOR INCOMING REPLIES (STEP 4 & 6)
 * -------------------------------------------------------------
 */
async function handleIncomingReplyLogic(leadId, replyText) {
  // 1. Fetch lead and conversation thread
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { conversations: true }
  });

  if (!lead) throw new Error('Lead not found.');

  // Guardrail: Check for opt-out / unsubscribe keywords first
  const optOutKeywords = ['unsubscribe', 'stop', 'remove', 'not interested', 'leave me alone', 'dont email me', 'don\'t email'];
  const hasOptedOut = optOutKeywords.some(kw => replyText.toLowerCase().includes(kw));

  if (hasOptedOut) {
    console.log(`Lead ${lead.name} opted out. Halting automation.`);
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'dead' }
    });

    const conversation = lead.conversations[0];
    if (conversation) {
      const history = JSON.parse(conversation.messageHistory);
      history.push({ role: 'user', content: replyText, timestamp: new Date().toISOString() });
      history.push({ role: 'system', content: 'Automation halted: Lead opted out / requested stop.', timestamp: new Date().toISOString() });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          stage: 'not_interested',
          messageHistory: JSON.stringify(history),
          lastUpdated: new Date()
        }
      });
    }

    // Send a final courteous unsubscribe confirmation email
    try {
      const finalReply = "Understood. I have removed you from our list and won't contact you again. Best of luck.";
      await sendEmailViaGmail(lead.email, `Re: ${lead.draftSubject || 'Our Strategy Call'}`, finalReply, lead.threadId);
    } catch (_) {}

    return { status: 'dead', reason: 'opt-out' };
  }

  // 2. Fetch current message history
  let conversation = lead.conversations[0];
  let history = [];
  if (conversation) {
    history = JSON.parse(conversation.messageHistory);
  }

  // Append new reply to history
  history.push({ role: 'user', content: replyText, timestamp: new Date().toISOString() });

  // Guardrail: Max turns check (6 turns max)
  const currentTurns = conversation ? conversation.turnCount + 1 : 1;
  if (currentTurns >= 6) {
    console.log(`Lead ${lead.name} exceeded max conversation turns. Flagging for manual review.`);
    
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'review_required' }
    });

    history.push({ role: 'system', content: 'Automation flagged: Exceeded max conversation turns (6). Requires human review.', timestamp: new Date().toISOString() });
    
    if (conversation) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageHistory: JSON.stringify(history),
          turnCount: currentTurns,
          lastUpdated: new Date()
        }
      });
    }
    return { status: 'review_required', reason: 'max-turns' };
  }

  // 3. Call LLM Classifier
  console.log(`Classifying reply for lead ${lead.name}...`);
  const classification = await classifyIncomingReply(history, replyText);
  console.log('Classification Result:', classification);

  // 4. Update status and conversation based on classification
  let finalStatus = 'replied';
  if (classification.stage === 'booked' || classification.intent_to_book) {
    // If they booked (e.g. they confirm a time) or show strong intent to book, we'll mark them
    finalStatus = 'replied'; // Let booking trigger 'booked' state
  }

  // 5. Call LLM Responder to generate the next response
  console.log(`Generating AI response for lead ${lead.name} (Stage: ${classification.stage})...`);
  const responseBody = await generateReplyResponse(
    classification.stage,
    classification.key_facts,
    history,
    replyText
  );

  // 6. Send response back via Gmail
  console.log(`Sending AI responder email to: ${lead.email}`);
  const mailResult = await sendEmailViaGmail(
    lead.email,
    `Re: ${lead.draftSubject || 'Our Strategy Call'}`,
    responseBody,
    lead.threadId
  );

  // 7. Update message history with our response
  history.push({ role: 'assistant', content: responseBody, timestamp: new Date().toISOString() });

  if (conversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        stage: classification.stage,
        extractedFacts: JSON.stringify({ facts: classification.key_facts }),
        messageHistory: JSON.stringify(history),
        turnCount: currentTurns + 1,
        lastUpdated: new Date()
      }
    });
  } else {
    // Should always have conversation if we sent the outreach email, but create one if missing
    await prisma.conversation.create({
      data: {
        leadId: lead.id,
        stage: classification.stage,
        extractedFacts: JSON.stringify({ facts: classification.key_facts }),
        messageHistory: JSON.stringify(history),
        turnCount: 2
      }
    });
  }

  // Update lead status
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: finalStatus }
  });

  return {
    status: finalStatus,
    stage: classification.stage,
    intent_to_book: classification.intent_to_book,
    sentReply: responseBody
  };
}

// In-memory cache for search queries (1 hour expiry)
const searchCache = new Map();

// Clear expired cache items periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, cached] of searchCache.entries()) {
    if (now - cached.timestamp >= 3600000) {
      searchCache.delete(key);
    }
  }
}, 600000); // Clean cache every 10 minutes

app.get('/api/places/search', async (req, res) => {
  const { query, location } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  const cacheKey = `${query.toLowerCase().trim()}_${(location || '').toLowerCase().trim()}`;
  const cachedData = searchCache.get(cacheKey);

  if (cachedData && Date.now() - cachedData.timestamp < 3600000) {
    console.log(`[Cache Hit] Returning cached results for: "${cacheKey}"`);
    return res.json({ cached: true, results: cachedData.results });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const isGoogleConfigured = apiKey && apiKey !== 'your_google_places_api_key_here' && !apiKey.includes('your_google_places_api_key');

  try {
    let results = [];

    if (isGoogleConfigured) {
      console.log(`[Google Places] Searching query: "${query}" in "${location || 'anywhere'}"`);
      const searchQuery = location ? `${query} near ${location}` : query;
      
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${apiKey}`;
      const searchResp = await axios.get(searchUrl);
      
      if (searchResp.data.status === 'OVER_QUERY_LIMIT') {
        return res.status(429).json({ error: 'Google Places API quota exceeded.' });
      }
      
      if (searchResp.data.status !== 'OK' && searchResp.data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google Search API returned status: ${searchResp.data.status}`);
      }

      const rawPlaces = (searchResp.data.results || []).slice(0, 5); // Fetch details for top 5 results to save budget
      
      for (const place of rawPlaces) {
        try {
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,opening_hours,rating,types,editorial_summary,photos&key=${apiKey}`;
          const detailsResp = await axios.get(detailsUrl);
          
          if (detailsResp.data.status === 'OK') {
            const r = detailsResp.data.result;
            const photoUrls = (r.photos || []).slice(0, 3).map(p => 
              `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${p.photo_reference}&key=${apiKey}`
            );

            results.push({
              place_id: place.place_id,
              name: r.name || place.name,
              phone: r.formatted_phone_number || null,
              address: r.formatted_address || place.formatted_address || null,
              website: r.website || null,
              description: r.editorial_summary?.overview || (r.types ? r.types.join(', ') : 'Local Business'),
              types: r.types || [],
              opening_hours: r.opening_hours?.weekday_text || null,
              isOpenNow: r.opening_hours?.open_now || null,
              rating: r.rating || null,
              photos: photoUrls.length > 0 ? photoUrls : null
            });
          } else {
            results.push({
              place_id: place.place_id,
              name: place.name,
              phone: null,
              address: place.formatted_address,
              website: null,
              description: 'Local Business',
              types: place.types || [],
              opening_hours: null,
              rating: place.rating || null,
              photos: null
            });
          }
        } catch (detailErr) {
          console.error(`Error getting details for ${place.place_id}:`, detailErr.message);
        }
      }
    } else {
      console.log(`[OSM Fallback] Searching OSM for query: "${query}" in "${location || 'anywhere'}"`);
      const searchQuery = location ? `${query} ${location}` : query;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&extratags=1&limit=5`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'FunnelBanditOutreachAgent/1.0 (contact@funnelbandit.example.com)'
        },
        timeout: 8000
      });

      const osmResults = response.data || [];
      
      for (const item of osmResults) {
        const nameHash = item.display_name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const mockRating = (4.0 + (nameHash % 10) / 10).toFixed(1);
        
        let photoCategory = 'business';
        const qLower = query.toLowerCase();
        if (qLower.includes('coffee') || qLower.includes('cafe')) photoCategory = 'coffee';
        else if (qLower.includes('dent')) photoCategory = 'dentist';
        else if (qLower.includes('gym') || qLower.includes('fitness')) photoCategory = 'gym';
        else if (qLower.includes('restaurant') || qLower.includes('food')) photoCategory = 'food';

        const photoUrls = [
          `https://images.unsplash.com/photo-${1600000000000 + (nameHash % 1000000)}?w=400&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&sig=${nameHash}`,
          `https://images.unsplash.com/photo-${1500000000000 + (nameHash % 1000000)}?w=400&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&sig=${nameHash + 1}`
        ];

        const name = item.name || item.display_name.split(',')[0];
        const category = item.type || item.class || 'Local Business';
        const website = item.extratags?.website || item.extratags?.['contact:website'] || null;
        const phone = item.extratags?.phone || item.extratags?.['contact:phone'] || null;
        const hours = item.extratags?.opening_hours || '9:00 AM - 6:00 PM';

        results.push({
          place_id: `osm_${item.osm_id || item.place_id}`,
          name: name,
          phone: phone,
          address: item.display_name,
          website: website,
          description: `Sourced from OpenStreetMap. Categorized as ${category}.`,
          types: [category],
          opening_hours: [hours],
          isOpenNow: true,
          rating: parseFloat(mockRating),
          photos: photoUrls
        });
      }
    }

    // Cache the results for 1 hour
    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      results
    });

    res.json({ cached: false, results });

  } catch (error) {
    console.error('Error in Places search endpoint:', error);
    res.status(500).json({ error: 'Failed to search places.', details: error.message });
  }
});

/**
 * -------------------------------------------------------------
 * START SERVER
 * -------------------------------------------------------------
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend static assets in production
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Wildcard handler to serve index.html for React SPA router
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`AI Lead Gen backend running on: http://localhost:${PORT}`);
  console.log(`=================================================`);
});
