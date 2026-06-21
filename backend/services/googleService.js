import { google } from 'googleapis';
import axios from 'axios';
import dotenv from 'dotenv';
import prisma from '../prismaClient.js';

dotenv.config();

/**
 * Helper to get the OAuth2 client pre-configured with active tokens
 */
export async function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || clientId.includes('your_google_client_id')) {
    return null; // OAuth not configured in .env
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Retrieve stored tokens from Settings table
  const accessTokenSetting = await prisma.setting.findUnique({ where: { key: 'google_access_token' } });
  const refreshTokenSetting = await prisma.setting.findUnique({ where: { key: 'google_refresh_token' } });
  const expirySetting = await prisma.setting.findUnique({ where: { key: 'google_token_expiry' } });

  if (!accessTokenSetting || !refreshTokenSetting) {
    return null; // OAuth not authorized by user yet
  }

  oauth2Client.setCredentials({
    access_token: accessTokenSetting.value,
    refresh_token: refreshTokenSetting.value,
    expiry_date: expirySetting ? parseInt(expirySetting.value, 10) : null,
  });

  // Check if token needs refresh and auto-refresh
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.setting.upsert({
        where: { key: 'google_access_token' },
        update: { value: tokens.access_token },
        create: { key: 'google_access_token', value: tokens.access_token },
      });
      if (tokens.expiry_date) {
        await prisma.setting.upsert({
          where: { key: 'google_token_expiry' },
          update: { value: tokens.expiry_date.toString() },
          create: { key: 'google_token_expiry', value: tokens.expiry_date.toString() },
        });
      }
    }
  });

  return oauth2Client;
}

/**
 * 1. Google Places API - Sourcing Leads (falls back to OpenStreetMap Nominatim)
 */
export async function searchPlaces(industry, location, count = 5) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  
  if (!apiKey || apiKey.includes('your_google_places_api_key')) {
    console.log('No Google Places API Key. Sourcing real leads from OpenStreetMap Nominatim...');
    return searchPlacesNominatim(industry, location, count);
  }

  try {
    const query = `${industry} in ${location}`;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
    const response = await axios.get(url);
    
    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google Places API returned error status: ${response.data.status}`);
    }

    const results = response.data.results || [];
    const limitedResults = results.slice(0, count);

    const leads = [];
    for (const place of limitedResults) {
      // Call Place Details to get phone number and website URL
      let phone = null;
      let website = null;

      try {
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website&key=${apiKey}`;
        const detailsResp = await axios.get(detailsUrl);
        if (detailsResp.data.status === 'OK') {
          phone = detailsResp.data.result.formatted_phone_number || null;
          website = detailsResp.data.result.website || null;
        }
      } catch (err) {
        console.error(`Error fetching Place Details for ${place.place_id}:`, err.message);
      }

      leads.push({
        name: place.name,
        address: place.formatted_address,
        phone: phone,
        website: website,
        place_id: place.place_id,
        industry: industry,
        location: location
      });
    }

    return leads;

  } catch (error) {
    console.error('Error during Google Places search, falling back to Nominatim:', error.message);
    return searchPlacesNominatim(industry, location, count);
  }
}

/**
 * Slices and cleans query parameters and searches OpenStreetMap Nominatim
 */
async function searchPlacesNominatim(industry, location, count = 5) {
  const ind = industry.trim();
  const loc = location.trim();
  
  // Try multiple variations of the search query to ensure we get results
  const queries = [
    `${ind} ${loc}`,
    `${ind} near ${loc}`,
    `${loc} ${ind}`
  ];

  const uniquePlaces = new Map();

  for (const q of queries) {
    if (uniquePlaces.size >= count * 3) break; // Fetch a larger candidate pool

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&extratags=1&limit=25`;
    try {
      console.log(`Querying OSM for "${q}"...`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'FunnelBanditOutreachAgent/1.0 (contact@funnelbandit.example.com)'
        },
        timeout: 8000
      });

      const results = response.data || [];
      for (const item of results) {
        const id = item.osm_id || item.place_id;
        if (!uniquePlaces.has(id)) {
          uniquePlaces.set(id, item);
        }
      }
    } catch (err) {
      console.error(`OSM query "${q}" failed:`, err.message);
    }
    
    // Rate limit delay (OSM Nominatim policy requires max 1 req/sec)
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  // Convert map values to formatted array
  const candidates = Array.from(uniquePlaces.values()).map(place => {
    const name = place.name || place.display_name.split(',')[0];
    const website = place.extratags?.website || place.extratags?.['contact:website'] || null;
    
    // Prioritize mobile phone if available, then phone, then contact:phone
    const phone = place.extratags?.['contact:mobile'] || place.extratags?.phone || place.extratags?.['contact:phone'] || null;
    const address = place.display_name;

    // Extract contact name from operator, owner, or contact:name
    const contactName = place.extratags?.operator || place.extratags?.owner || place.extratags?.['contact:name'] || place.extratags?.['contact:person'] || null;

    // Extract email from email or contact:email
    const email = place.extratags?.email || place.extratags?.['contact:email'] || null;

    return {
      name,
      address,
      phone,
      website,
      email,
      contactName,
      place_id: `osm_${place.osm_id}`,
      industry: ind,
      location: loc,
      importance: place.importance || 0
    };
  });

  // Sort candidates to prioritize entries with websites and phone numbers
  candidates.sort((a, b) => {
    const scoreA = (a.website ? 2 : 0) + (a.phone ? 1 : 0);
    const scoreB = (b.website ? 2 : 0) + (b.phone ? 1 : 0);
    if (scoreA !== scoreB) {
      return scoreB - scoreA; // More metadata first
    }
    return b.importance - a.importance;
  });

  const finalLeads = candidates.slice(0, count);

  // Absolute fallback to mocks only if OSM returned nothing
  if (finalLeads.length === 0) {
    console.log('No results found on OpenStreetMap. Falling back to mocks.');
    return getMockPlaces(industry, location, count);
  }

  console.log(`OSM Sourced ${finalLeads.length} real businesses.`);
  return finalLeads;
}

/**
 * Generate mock leads for simulation mode
 */
function getMockPlaces(industry, location, count) {
  const mocks = [];
  const industriesClean = industry.split(',').map(s => s.trim());
  const primaryIndustry = industriesClean[0] || 'Services';
  
  const sampleNames = {
    'coffee': ['Summit Coffee Roasters', 'Elixir Espresso Bar', 'Urban Grind', 'Blue Bottle Collective', 'Anchor & Hops Cafe'],
    'dental': ['Apex Family Dentistry', 'Bright Smiles Dental Care', 'Metro Dental Group', 'Riverwood Dental Partners', 'Zen Dental Care'],
    'real estate': ['Pinnacle Realty Group', 'Apex Home Sales', 'Centennial Real Estate Partners', 'Vanguard Brokerage', 'Metro Dwelling Agents'],
    'gym': ['Pulse Fitness & Performance', 'Ironwood Athletics', 'Apex Cross Training', 'Titan Strength Club', 'Vibe Yoga & Cycle Studio'],
    'restaurant': ['The Green Table Bistro', 'Bella Vista Italian Kitchen', 'Cornerstone Bar & Grill', 'Sage & Thyme Eatery', 'District Craft Gastropub'],
    'coaches': ['Elite Executive Coaching', 'Scale Up Business Consultants', 'Pinnacle Leadership Group', 'Peak Performance Advisors', 'Summit Mentors'],
    'consultants': ['Elite Executive Coaching', 'Scale Up Business Consultants', 'Pinnacle Leadership Group', 'Peak Performance Advisors', 'Summit Mentors']
  };

  const matchedKey = Object.keys(sampleNames).find(k => primaryIndustry.toLowerCase().includes(k)) || 'consultants';
  const namesList = sampleNames[matchedKey];

  for (let i = 0; i < count; i++) {
    const name = namesList[i % namesList.length] + (i >= namesList.length ? ` ${Math.floor(i / namesList.length) + 1}` : '');
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    mocks.push({
      name: name,
      address: `${100 + i * 15} Main St, ${location}`,
      phone: `+1 (555) ${100 + i * 7}-${4000 + i * 3}`,
      website: `http://example-${slug}.com`,
      place_id: `mock_place_${slug}_${i}`,
      industry: primaryIndustry,
      location: location
    });
  }

  return mocks;
}

/**
 * 2. Google Sheets API - Exporting Leads
 */
export async function exportLeadsToSheet(sheetUrl, leads) {
  const oauth2Client = await getOAuth2Client();

  if (!oauth2Client) {
    console.log('Google OAuth2 not connected. Simulating Sheet Export...');
    return { success: true, simulated: true };
  }

  try {
    // Extract sheet ID from URL
    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) throw new Error('Invalid Google Sheet URL format.');
    const spreadsheetId = match[1];

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    // Prepare values
    const values = leads.map(l => [
      l.name,
      l.industry,
      l.location,
      l.email || 'N/A',
      l.phone || 'N/A',
      l.website || 'N/A',
      l.status,
      l.createdAt.toISOString()
    ]);

    // Check if sheet has headers first
    const checkHeader = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A1:H1'
    });

    if (!checkHeader.data.values || checkHeader.data.values.length === 0) {
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1:H1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Name', 'Industry', 'Location', 'Email', 'Phone', 'Website', 'Status', 'Sourced At']]
        }
      });
    }

    // Append rows
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    return { success: true, simulated: false };

  } catch (error) {
    console.error('Error exporting to Google Sheets:', error.message);
    throw error;
  }
}

/**
 * 3. Gmail API - Send outreach or replies
 */
export async function sendEmailViaGmail(toEmail, subject, body, threadId = null) {
  const oauth2Client = await getOAuth2Client();

  if (!oauth2Client) {
    console.log(`Google OAuth2 not connected. Simulating Email Send to: ${toEmail}`);
    return { success: true, simulated: true, messageId: `mock_msg_${Math.random().toString(36).substring(7)}`, threadId: threadId || `mock_thread_${Math.random().toString(36).substring(7)}` };
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build standard MIME RFC 2822 message
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `To: ${toEmail}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`
    ];

    if (threadId) {
      messageParts.push(`In-Reply-To: ${threadId}`);
      messageParts.push(`References: ${threadId}`);
    }

    messageParts.push('');
    // Replace newlines with HTML breaks for display
    const htmlBody = body.replace(/\n/g, '<br>');
    messageParts.push(htmlBody);

    const rawMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const requestBody = {
      raw: encodedMessage
    };

    if (threadId) {
      requestBody.threadId = threadId;
    }

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody
    });

    return {
      success: true,
      simulated: false,
      messageId: response.data.id,
      threadId: response.data.threadId
    };

  } catch (error) {
    console.error('Error sending email via Gmail API:', error.message);
    throw error;
  }
}

/**
 * 4. Google Calendar API - Book meetings
 */
export async function createCalendarEvent(summary, startTime, endTime, description = '') {
  const oauth2Client = await getOAuth2Client();

  if (!oauth2Client) {
    console.log(`Google OAuth2 not connected. Simulating Google Calendar Event: ${summary}`);
    return { success: true, simulated: true, eventId: `mock_event_${Math.random().toString(36).substring(7)}` };
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: summary,
      description: description,
      start: {
        dateTime: new Date(startTime).toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(endTime).toISOString(),
        timeZone: 'UTC',
      },
      reminders: {
        useDefault: true,
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    return {
      success: true,
      simulated: false,
      eventId: response.data.id,
      htmlLink: response.data.htmlLink
    };

  } catch (error) {
    console.error('Error creating Google Calendar event:', error.message);
    throw error;
  }
}

/**
 * 5. Gmail API - Poll threads for replies
 * Walks through contacted leads with active threadIds and checks if they replied.
 */
export async function pollGmailReplies() {
  const oauth2Client = await getOAuth2Client();
  if (!oauth2Client) {
    // If not authenticated, we return empty list (replies can be simulated manually in frontend)
    return [];
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Find leads with status 'contacted' and active threadId
    const contactedLeads = await prisma.lead.findMany({
      where: {
        status: 'contacted',
        threadId: { not: null }
      }
    });

    const newReplies = [];

    for (const lead of contactedLeads) {
      try {
        const thread = await gmail.users.threads.get({
          userId: 'me',
          id: lead.threadId
        });

        const messages = thread.data.messages || [];
        if (messages.length <= 1) continue; // Only our outbound message exists

        // Sort messages by internalDate
        messages.sort((a, b) => parseInt(a.internalDate) - parseInt(b.internalDate));

        const lastMessage = messages[messages.length - 1];
        
        // Find headers to check Sender
        const headers = lastMessage.payload.headers || [];
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
        
        // Check if the last message is NOT from us (i.e. is from the lead)
        const isFromMe = fromHeader.includes('me') || fromHeader.includes(process.env.GOOGLE_CLIENT_ID) || fromHeader.includes('@'); // wait, the user's gmail email could be matched or just check if it matches the lead's email
        const isFromLead = fromHeader.toLowerCase().includes(lead.email.toLowerCase());

        if (isFromLead) {
          // Extract message body
          let bodyText = '';
          const parts = lastMessage.payload.parts || [];
          
          if (lastMessage.payload.body?.data) {
            bodyText = Buffer.from(lastMessage.payload.body.data, 'base64').toString('utf-8');
          } else if (parts.length > 0) {
            // Find plaintext or html part
            const plainPart = parts.find(p => p.mimeType === 'text/plain');
            const htmlPart = parts.find(p => p.mimeType === 'text/html');
            const targetPart = plainPart || htmlPart;
            if (targetPart && targetPart.body?.data) {
              bodyText = Buffer.from(targetPart.body.data, 'base64').toString('utf-8');
            }
          }

          // Clean up HTML tags if it's HTML
          bodyText = bodyText.replace(/<[^>]*>/g, '').trim();

          newReplies.push({
            leadId: lead.id,
            threadId: lead.threadId,
            replyText: bodyText,
            messageId: lastMessage.id
          });
        }
      } catch (err) {
        console.error(`Error polling thread ${lead.threadId} for lead ${lead.name}:`, err.message);
      }
    }

    return newReplies;

  } catch (error) {
    console.error('Error polling Gmail replies:', error.message);
    return [];
  }
}
