import React, { useState, useEffect } from 'react';
import {
  Search,
  Mail,
  Send,
  Calendar,
  FileSpreadsheet,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Check,
  Clock,
  Settings,
  User,
  Bot,
  Trash2,
  Lock,
  Plus,
  Briefcase
} from 'lucide-react';

const BACKEND_URL = window.location.origin.includes('localhost:5173') ? 'http://localhost:5000' : window.location.origin;

export default function App() {
  // State variables
  const [leads, setLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [isOAuthConnected, setIsOAuthConnected] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  // Search Form State
  const [industry, setIndustry] = useState('Dental');
  const [location, setLocation] = useState('Dallas, TX');
  const [leadCount, setLeadCount] = useState(5);
  const [sourcingLoading, setSourcingLoading] = useState(false);

  // Sheets Export State
  const [sheetUrl, setSheetUrl] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  // Modals state
  const [activeModal, setActiveModal] = useState(null); // 'draft' | 'thread' | 'book' | null
  const [selectedLead, setSelectedLead] = useState(null);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState('leads'); // 'leads' | 'search'

  // Google Places Search State
  const [searchQuery, setSearchQuery] = useState('Coffee Shop');
  const [searchLoc, setSearchLoc] = useState('Dallas, TX');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [searchCached, setSearchCached] = useState(false);

  // Claim Listing State
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimBusiness, setClaimBusiness] = useState(null);
  const [claimEmail, setClaimEmail] = useState('');
  const [claimLoading, setClaimLoading] = useState(false);

  // Draft Modal Edit state
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSending, setDraftSending] = useState(false);

  // Thread Modal State
  const [conversation, setConversation] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [simulatedReplyText, setSimulatedReplyText] = useState('');
  const [sendingSimulatedReply, setSendingSimulatedReply] = useState(false);

  // Booking Modal State
  const [bookingSummary, setBookingSummary] = useState('');
  const [bookingStart, setBookingStart] = useState('');
  const [bookingEnd, setBookingEnd] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);

  // Global action indicators
  const [actionMessage, setActionMessage] = useState(null);

  // Fetch leads and OAuth status on load
  useEffect(() => {
    fetchLeads();
    checkOAuthStatus();
  }, []);

  const fetchLeads = async () => {
    setLoadingLeads(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setLeads(data);
      }
    } catch (error) {
      showToast('Error fetching leads.', 'error');
    } finally {
      setLoadingLeads(false);
    }
  };

  const checkOAuthStatus = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/status`);
      const data = await response.json();
      setIsOAuthConnected(data.connected);
    } catch (error) {
      setIsOAuthConnected(false);
    }
  };

  const showToast = (message, type = 'success') => {
    setActionMessage({ text: message, type });
    setTimeout(() => {
      setActionMessage(null);
    }, 4000);
  };

  // Google OAuth Connection
  const handleConnectOAuth = async () => {
    setOauthLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/google`);
      const data = await response.json();
      if (data.url) {
        // Open authorization screen in popup or new tab
        const width = 600;
        const height = 600;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(
          data.url,
          'Google OAuth',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        // Check if popup closed and poll status
        const checkTimer = setInterval(async () => {
          if (!popup || popup.closed) {
            clearInterval(checkTimer);
            setOauthLoading(false);
            // Verify connected status
            const statusResp = await fetch(`${BACKEND_URL}/api/auth/status`);
            const statusData = await statusResp.json();
            setIsOAuthConnected(statusData.connected);
            if (statusData.connected) {
              showToast('Google account connected successfully!');
            }
          }
        }, 1000);
      }
    } catch (error) {
      showToast('Failed to start OAuth flow.', 'error');
      setOauthLoading(false);
    }
  };

  const handleDisconnectOAuth = async () => {
    if (!confirm('Are you sure you want to disconnect Google API?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/auth/disconnect`, { method: 'POST' });
      setIsOAuthConnected(false);
      showToast('Google account disconnected.');
    } catch (error) {
      showToast('Disconnect failed.', 'error');
    }
  };

  // Sourcing Leads
  const handleSourceLeads = async (e) => {
    e.preventDefault();
    if (!industry || !location) return;
    setSourcingLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry, location, count: leadCount })
      });
      const data = await response.json();
      if (response.ok) {
        showToast(data.message || 'Leads sourced successfully!');
        fetchLeads();
      } else {
        showToast(data.error || 'Failed to source leads.', 'error');
      }
    } catch (error) {
      showToast('Error connection to lead source API.', 'error');
    } finally {
      setSourcingLoading(false);
    }
  };

  // Delete All Leads
  const handleClearDatabase = async () => {
    if (!confirm('Are you sure you want to delete all leads from the database?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/leads/delete`, { method: 'POST' });
      setLeads([]);
      showToast('Database cleared.');
    } catch (error) {
      showToast('Clear database failed.', 'error');
    }
  };

  // Generate Email Drafts
  const handleGenerateDrafts = async (leadId) => {
    const ids = leadId ? [leadId] : leads.filter(l => !l.draftBody && l.email).map(l => l.id);
    if (ids.length === 0) {
      showToast('No leads require draft generation.', 'info');
      return;
    }
    showToast(`Generating drafts for ${ids.length} lead(s)...`, 'info');
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/generate-drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: ids })
      });
      if (response.ok) {
        showToast('Drafts generated successfully!');
        fetchLeads();
      } else {
        showToast('Failed to generate drafts.', 'error');
      }
    } catch (error) {
      showToast('Error generating drafts.', 'error');
    }
  };

  // Open Draft Modal
  const openDraftModal = (lead) => {
    setSelectedLead(lead);
    setDraftSubject(lead.draftSubject || '');
    setDraftBody(lead.draftBody || '');
    setActiveModal('draft');
  };

  // Save modified draft
  const handleSaveDraft = async () => {
    setDraftSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/update-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLead.id,
          subject: draftSubject,
          body: draftBody
        })
      });
      if (response.ok) {
        showToast('Draft saved successfully!');
        fetchLeads();
        setActiveModal(null);
      } else {
        showToast('Failed to save draft.', 'error');
      }
    } catch (error) {
      showToast('Error saving draft.', 'error');
    } finally {
      setDraftSaving(false);
    }
  };

  // Send single draft email
  const handleSendEmail = async (leadId) => {
    const id = leadId || selectedLead.id;
    setDraftSending(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: [id] })
      });
      const data = await response.json();
      if (response.ok) {
        showToast('Email sent successfully!');
        fetchLeads();
        setActiveModal(null);
      } else {
        showToast(data.error || 'Failed to send email.', 'error');
      }
    } catch (error) {
      showToast('Error sending email.', 'error');
    } finally {
      setDraftSending(false);
    }
  };

  // Export Selected Leads to Google Sheet
  const handleExportToSheets = async (e) => {
    e.preventDefault();
    if (!sheetUrl) return;
    const leadsWithEmail = leads.filter(l => l.email);
    if (leadsWithEmail.length === 0) {
      showToast('No leads with emails to export.', 'info');
      return;
    }
    setExportLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: leadsWithEmail.map(l => l.id),
          sheetUrl
        })
      });
      const data = await response.json();
      if (response.ok) {
        if (data.simulated) {
          showToast('Simulation: Leads exported. Connect Google Account to write to real Sheets.');
        } else {
          showToast('Leads successfully appended to Google Sheet!');
        }
      } else {
        showToast(data.error || 'Failed to export.', 'error');
      }
    } catch (error) {
      showToast('Error exporting to Google Sheets.', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  // Open conversation thread modal
  const openThreadModal = async (lead) => {
    setSelectedLead(lead);
    setConversation(null);
    setLoadingThread(true);
    setActiveModal('thread');

    try {
      const response = await fetch(`${BACKEND_URL}/api/conversations/thread/${lead.id}`);
      const data = await response.json();
      if (response.ok) {
        setConversation(data);
      } else {
        // No thread yet
        setConversation({
          leadId: lead.id,
          messageHistory: JSON.stringify([
            { role: 'system', content: 'Outreach campaign not started yet.', timestamp: new Date().toISOString() }
          ]),
          stage: 'opened',
          extractedFacts: '{}',
          turnCount: 0
        });
      }
    } catch (error) {
      showToast('Error loading conversation thread.', 'error');
    } finally {
      setLoadingThread(false);
    }
  };

  // Simulate receiving a reply in demo mode
  const handleSendSimulatedReply = async (e) => {
    e.preventDefault();
    if (!simulatedReplyText.trim()) return;

    setSendingSimulatedReply(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/conversations/mock-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLead.id,
          replyText: simulatedReplyText
        })
      });

      const data = await response.json();
      if (response.ok) {
        showToast('Simulated reply processed successfully!');
        setSimulatedReplyText('');
        // Reload lead list and thread
        fetchLeads();
        // Reload thread info
        const threadResp = await fetch(`${BACKEND_URL}/api/conversations/thread/${selectedLead.id}`);
        const threadData = await threadResp.json();
        setConversation(threadData);
      } else {
        showToast(data.error || 'Failed to simulate reply.', 'error');
      }
    } catch (error) {
      showToast('Error sending simulated reply.', 'error');
    } finally {
      setSendingSimulatedReply(false);
    }
  };

  // Open booking modal
  const openBookingModal = (lead) => {
    setSelectedLead(lead);
    setBookingSummary(`Discovery Call: ${lead.name}`);

    // Set default dates: tomorrow at 2:00 PM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);
    const startStr = tomorrow.toISOString().slice(0, 16);

    tomorrow.setMinutes(30);
    const endStr = tomorrow.toISOString().slice(0, 16);

    setBookingStart(startStr);
    setBookingEnd(endStr);
    setActiveModal('book');
  };

  // Confirm booking & create calendar event
  const handleConfirmBooking = async (e) => {
    e.preventDefault();
    setBookingLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/bookings/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLead.id,
          summary: bookingSummary,
          startTime: bookingStart,
          endTime: bookingEnd
        })
      });
      const data = await response.json();
      if (response.ok) {
        if (data.simulated) {
          showToast('Simulation: Event created. Connect Google account for real Calendar logs.');
        } else {
          showToast('Event successfully created in Google Calendar!');
        }
        fetchLeads();
        setActiveModal(null);
      } else {
        showToast(data.error || 'Failed to book calendar event.', 'error');
      }
    } catch (error) {
      showToast('Error booking event.', 'error');
    } finally {
      setBookingLoading(false);
    }
  };

  // Check email status color
  const getStatusBadge = (status) => {
    switch (status) {
      case 'new':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700">New</span>;
      case 'contacted':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Contacted</span>;
      case 'replied':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Replied</span>;
      case 'booked':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Booked</span>;
      case 'dead':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">Dead (Opt Out)</span>;
      case 'review_required':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Action Req.</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  // Conversation stage badges
  const getStageBadge = (stage) => {
    const bases = "px-2 py-0.5 text-xs font-medium rounded border ";
    switch (stage) {
      case 'opened':
        return <span className={bases + "bg-slate-800/80 text-slate-300 border-slate-700"}>Opened</span>;
      case 'engaged':
        return <span className={bases + "bg-sky-500/10 text-sky-400 border-sky-500/20"}>Engaged</span>;
      case 'qualifying':
        return <span className={bases + "bg-violet-500/10 text-violet-400 border-violet-500/20"}>Qualifying</span>;
      case 'booking_offered':
        return <span className={bases + "bg-purple-500/10 text-purple-400 border-purple-500/20"}>Call Offered</span>;
      case 'booked':
        return <span className={bases + "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}>Booked</span>;
      case 'not_interested':
        return <span className={bases + "bg-rose-500/10 text-rose-400 border-rose-500/20"}>Not Interested</span>;
      default:
        return <span className={bases + "bg-slate-800 text-slate-400 border-slate-700"}>{stage}</span>;
    }
  };

  // Handle Google Places Search
  const handlePlacesSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchLoading(true);
    setSearchError('');
    setSearchResults([]);
    setSearchCached(false);

    try {
      const url = `${BACKEND_URL}/api/places/search?query=${encodeURIComponent(searchQuery)}&location=${encodeURIComponent(searchLoc)}`;
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok) {
        setSearchResults(data.results || []);
        setSearchCached(data.cached || false);
        if ((data.results || []).length === 0) {
          setSearchError('No matching places found. Try refining your query or location.');
        }
      } else {
        setSearchError(data.error || 'Failed to fetch places.');
        showToast(data.error || 'Failed to search places.', 'error');
      }
    } catch (err) {
      setSearchError('Network error connecting to the Places API server.');
      showToast('Error searching places.', 'error');
    } finally {
      setSearchLoading(false);
    }
  };

  // Open Claim Modal
  const openClaimModal = (business) => {
    setClaimBusiness(business);
    setClaimEmail('');
    setShowClaimModal(true);
  };

  // Submit Claim Listing Form
  const handleClaimSubmit = async (e) => {
    e.preventDefault();
    if (!claimEmail.trim() || !claimBusiness) return;

    setClaimLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: claimBusiness.name,
          industry: claimBusiness.types?.[0] || 'Local Business',
          location: searchLoc || 'Unknown',
          phone: claimBusiness.phone || '',
          website: claimBusiness.website || '',
          email: claimEmail,
          jobDescription: claimBusiness.description || '',
          scrapedContent: `Claimed by owner (${claimEmail}). Sourced from Google Places search feature.`
        })
      });

      const data = await response.json();

      if (response.ok) {
        showToast(`Listing for ${claimBusiness.name} successfully claimed & imported into Leads!`);
        setShowClaimModal(false);
        setClaimBusiness(null);
        fetchLeads(); // Reload leads in workspace
      } else {
        showToast(data.error || 'Failed to claim listing.', 'error');
      }
    } catch (err) {
      showToast('Failed to claim listing.', 'error');
    } finally {
      setClaimLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden pb-12">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-brand-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Top Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-brand-600 to-brand-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Bot className="w-5.5 h-5.5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-white flex items-center gap-2">
              Funnel Bandit <span className="text-xs bg-brand-500/10 text-brand-400 border border-brand-500/20 px-2 py-0.5 rounded-full font-semibold">Agent v1.0</span>
            </h1>
            <p className="text-xs text-slate-400">AI-driven local lead sourcing & outreach automation</p>
          </div>
        </div>

        {/* OAuth Connect Panel */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
            <div className={`w-2 h-2 rounded-full ${isOAuthConnected ? 'bg-emerald-400' : 'bg-slate-600'}`}></div>
            <span className="text-slate-300">
              Google API: {isOAuthConnected ? 'Connected' : 'Offline Mode'}
            </span>
          </div>

          {isOAuthConnected ? (
            <button
              onClick={handleDisconnectOAuth}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-850 hover:border-red-500/30 text-xs font-semibold text-slate-300 hover:text-red-400 transition"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnectOAuth}
              disabled={oauthLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-semibold text-white shadow-lg shadow-brand-500/15 transition disabled:opacity-50"
            >
              {oauthLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Connect Google Account
            </button>
          )}
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-6 mt-6">
        <div className="flex border-b border-slate-900 gap-6">
          <button
            onClick={() => setActiveTab('leads')}
            className={`pb-4 text-sm font-semibold tracking-wide transition relative ${activeTab === 'leads' ? 'text-brand-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            Leads Campaign Workspace
            {activeTab === 'leads' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500 rounded-full"></div>
            )}
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className={`pb-4 text-sm font-semibold tracking-wide transition relative ${activeTab === 'search' ? 'text-brand-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            Google Places Finder
            {activeTab === 'search' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500 rounded-full"></div>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'leads' && (
        <main className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left Column: controls / search */}
          <div className="lg:col-span-1 space-y-8">

            {/* Sourcing Form */}
            <div className="rounded-2xl border border-slate-850 bg-slate-900/60 backdrop-blur-md p-6 shadow-xl relative overflow-hidden">
              <h2 className="font-bold text-lg text-white mb-4 flex items-center gap-2">
                <Search className="w-5 h-5 text-brand-400" /> Sourced Leads Finder
              </h2>
              <form onSubmit={handleSourceLeads} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Target Niche / Industry</label>
                  <input
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="e.g. Dental, Coffee Shop, Gym"
                    className="w-full bg-slate-950/80 border border-slate-850 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Target Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Dallas, TX or Chicago"
                    className="w-full bg-slate-950/80 border border-slate-850 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Number of Leads to Find</label>
                  <select
                    value={leadCount}
                    onChange={(e) => setLeadCount(parseInt(e.target.value))}
                    className="w-full bg-slate-950/80 border border-slate-850 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-brand-500 transition"
                  >
                    <option value={3}>3 Leads (Fast Demo)</option>
                    <option value={5}>5 Leads</option>
                    <option value={10}>10 Leads</option>
                    <option value={20}>20 Leads</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={sourcingLoading}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 font-semibold text-sm text-white shadow-lg shadow-brand-500/15 flex items-center justify-center gap-2 transition disabled:opacity-50 mt-6"
                >
                  {sourcingLoading ? (
                    <>
                      <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                      Finding & Scrapes (this takes a moment)...
                    </>
                  ) : (
                    <>
                      <Search className="w-4.5 h-4.5" />
                      Launch Sourcing Agent
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Sheets Export Form */}
            <div className="rounded-2xl border border-slate-850 bg-slate-900/60 backdrop-blur-md p-6 shadow-xl">
              <h2 className="font-bold text-lg text-white mb-4 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" /> Export to Google Sheet
              </h2>
              <form onSubmit={handleExportToSheets} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Google Sheet URL</label>
                  <input
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-slate-950/80 border border-slate-850 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-1">If using Google Auth, leads with emails will append directly.</p>
                </div>

                <button
                  type="submit"
                  disabled={exportLoading || leads.length === 0}
                  className="w-full py-3 rounded-xl border border-emerald-500/30 hover:border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 font-semibold text-sm text-emerald-400 transition disabled:opacity-30 disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                >
                  {exportLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Syncing...
                    </span>
                  ) : 'Sync Sourced Leads to Sheet'}
                </button>
              </form>
            </div>

            {/* Database Control */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-900 bg-slate-950/50">
              <span className="text-xs text-slate-500">Database Options</span>
              <button
                onClick={handleClearDatabase}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs font-semibold text-red-400 transition"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear All Leads
              </button>
            </div>

          </div>

          {/* Right 2 Columns: Leads Table / List */}
          <div className="lg:col-span-2 space-y-8">

            {/* Main leads display */}
            <div className="rounded-2xl border border-slate-850 bg-slate-900/60 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-850 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-lg text-white">Sourced Leads DB</h2>
                  <p className="text-xs text-slate-400">{leads.length} leads in workspace</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchLeads}
                    disabled={loadingLeads}
                    className="p-2 rounded-lg bg-slate-950/80 border border-slate-850 text-slate-400 hover:text-white transition"
                    title="Reload list"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingLeads ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleGenerateDrafts(null)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-950 hover:bg-slate-850 border border-slate-850 text-xs font-semibold text-slate-200 transition"
                  >
                    <Bot className="w-4 h-4 text-brand-400" /> Auto-Draft All
                  </button>
                </div>
              </div>

              {loadingLeads ? (
                <div className="py-24 text-center">
                  <RefreshCw className="w-8 h-8 text-brand-500 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-slate-400">Loading leads...</p>
                </div>
              ) : leads.length === 0 ? (
                <div className="py-24 text-center px-6">
                  <Bot className="w-12 h-12 text-slate-650 mx-auto mb-4" />
                  <h3 className="font-semibold text-white text-base">No Leads Sourced Yet</h3>
                  <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1">Enter a niche and location on the left panel to crawl local business leads dynamically.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-850 text-slate-400 text-xs font-semibold uppercase tracking-wider bg-slate-950/40">
                        <th className="px-6 py-4">Company Details</th>
                        <th className="px-6 py-4">Email / Contact</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850/60">
                      {leads.map((lead) => (
                        <tr key={lead.id} className="hover:bg-slate-850/20 transition group">

                          {/* Name and industry */}
                          <td className="px-6 py-4">
                            <div className="font-semibold text-white text-sm group-hover:text-brand-300 transition">{lead.name}</div>
                            <div className="text-xs text-slate-450 mt-0.5">{lead.industry} • {lead.location}</div>

                            <div className="flex gap-2 items-center mt-1.5 flex-wrap">
                              {lead.website && (
                                <a
                                  href={lead.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5"
                                >
                                  Visit site <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                              {lead.linkedinUrl && (
                                <>
                                  <span className="text-slate-700 text-xs">•</span>
                                  <a
                                    href={lead.linkedinUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5"
                                  >
                                    LinkedIn <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </>
                              )}
                            </div>
                          </td>

                          {/* Contact details */}
                          <td className="px-6 py-4 text-xs">
                            {lead.contactName && lead.contactName !== 'Manager' && (
                              <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-brand-400" />
                                {lead.contactName}
                              </div>
                            )}
                            {lead.email ? (
                              <div className="flex items-center gap-1.5 font-mono text-slate-300">
                                <Mail className="w-3.5 h-3.5 text-slate-500" />
                                {lead.email}
                              </div>
                            ) : (
                              <span className="text-slate-550 italic">No email scraped</span>
                            )}
                            {lead.phone && <div className="text-slate-500 font-mono mt-1">{lead.phone}</div>}
                          </td>

                          {/* Status badge */}
                          <td className="px-6 py-4">
                            {getStatusBadge(lead.status)}
                          </td>

                          {/* Actions buttons */}
                          <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                            {lead.email ? (
                              <>
                                {/* 1. If draft is missing, generate it */}
                                {!lead.draftBody ? (
                                  <button
                                    onClick={() => handleGenerateDrafts(lead.id)}
                                    className="p-1.5 rounded bg-slate-950 border border-slate-850 text-slate-400 hover:text-brand-400 hover:border-brand-500/30 transition"
                                    title="Generate personalization draft"
                                  >
                                    <Bot className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => openDraftModal(lead)}
                                    className={`p-1.5 rounded transition ${lead.status === 'new'
                                      ? 'bg-brand-600/10 hover:bg-brand-600 border border-brand-500/20 text-brand-400 hover:text-white'
                                      : 'bg-slate-950 border border-slate-850 text-slate-450 hover:text-white'
                                      }`}
                                    title={lead.status === 'new' ? "Review & Send Email" : "Review Draft Details"}
                                  >
                                    <Mail className="w-4 h-4" />
                                  </button>
                                )}

                                {/* 2. Chat history thread viewer */}
                                {lead.status !== 'new' && (
                                  <button
                                    onClick={() => openThreadModal(lead)}
                                    className="p-1.5 rounded bg-slate-950 border border-slate-850 text-slate-400 hover:text-brand-400 hover:border-brand-500/30 transition"
                                    title="View Conversation Thread"
                                  >
                                    <MessageSquare className="w-4 h-4" />
                                  </button>
                                )}

                                {/* 3. Book call helper */}
                                {(lead.status === 'replied' || lead.status === 'contacted') && (
                                  <button
                                    onClick={() => openBookingModal(lead)}
                                    className="p-1.5 rounded bg-slate-950 border border-slate-850 text-slate-450 hover:text-emerald-400 hover:border-emerald-500/30 transition"
                                    title="Book Calendar Meeting"
                                  >
                                    <Calendar className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-slate-600 italic">Scraping needed email</span>
                            )}
                          </td>

                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        </main>
      )}

      {activeTab === 'search' && (
        <main className="max-w-7xl mx-auto px-6 mt-8">
          {/* Places Search Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 animate-fadeIn">
            {/* Search sidebar panel */}
            <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 h-fit space-y-6 shadow-xl">
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">Search Filters</h2>
              <form onSubmit={handlePlacesSearch} className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">Keywords</label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. coffee shop, summit dental"
                    className="w-full bg-slate-950 border border-slate-850 focus:border-brand-500/50 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-600 outline-none transition"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">Location (Optional)</label>
                  <input
                    type="text"
                    value={searchLoc}
                    onChange={(e) => setSearchLoc(e.target.value)}
                    placeholder="e.g. Dallas, TX"
                    className="w-full bg-slate-950 border border-slate-850 focus:border-brand-500/50 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-600 outline-none transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searchLoading}
                  className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-xs font-bold text-white transition flex items-center justify-center gap-2 shadow-lg shadow-brand-500/15 disabled:opacity-50"
                >
                  {searchLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  Find Businesses
                </button>
              </form>

              <div className="pt-4 border-t border-slate-850 text-xs text-slate-500 space-y-2">
                <p>📍 Officially powered by Google Places API.</p>
                <p>⚡ High-performance local caching enabled to save API costs.</p>
              </div>
            </div>

            {/* Search results list */}
            <div className="lg:col-span-3 space-y-6">
              {searchLoading && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin"></div>
                  <span className="text-xs text-slate-400 font-medium">Retrieving real-time Google Places details...</span>
                </div>
              )}

              {searchError && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex gap-3 text-xs text-rose-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <div>{searchError}</div>
                </div>
              )}

              {!searchLoading && searchResults.length === 0 && !searchError && (
                <div className="border border-dashed border-slate-800 rounded-2xl py-20 flex flex-col items-center justify-center text-center px-6">
                  <Search className="w-10 h-10 text-slate-700 mb-3" />
                  <h3 className="text-sm font-semibold text-slate-400">Search for local businesses</h3>
                  <p className="text-xs text-slate-650 mt-1 max-w-xs leading-relaxed">
                    Type a query (like "dentists") and optional location to instantly load live Google Places data.
                  </p>
                </div>
              )}

              {!searchLoading && searchResults.length > 0 && (
                <>
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs text-slate-400 font-semibold">
                      Found {searchResults.length} verified listings
                    </span>
                    {searchCached && (
                      <span className="text-[10px] bg-slate-900 border border-slate-800 text-brand-400 px-2.5 py-0.5 rounded-full font-bold">
                        ⚡ Loaded from Cache
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {searchResults.map((business) => (
                      <div key={business.place_id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col hover:border-brand-500/30 transition group shadow-md">
                        {/* Photo header */}
                        <div className="h-44 w-full relative bg-slate-950 overflow-hidden">
                          {business.photos && business.photos[0] ? (
                            <img
                              src={business.photos[0]}
                              alt={business.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-700 font-semibold text-xs tracking-wider uppercase">
                              No Photo Available
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent"></div>

                          {/* Rating badge */}
                          {business.rating && (
                            <div className="absolute top-3 right-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[11px] font-bold text-amber-400 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg">
                              ★ {business.rating.toFixed(1)}
                            </div>
                          )}

                          <div className="absolute bottom-3 left-4 right-4">
                            <span className="text-[9px] bg-brand-500/20 text-brand-400 border border-brand-500/20 px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                              {business.types?.[0] || 'Local Business'}
                            </span>
                            <h3 className="font-bold text-white text-base mt-1.5 truncate group-hover:text-brand-300 transition">
                              {business.name}
                            </h3>
                          </div>
                        </div>

                        {/* Card body */}
                        <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                          <div className="space-y-3">
                            <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                              {business.description}
                            </p>

                            <div className="space-y-2 text-xs text-slate-400">
                              <div className="flex gap-2 items-start">
                                <span className="text-slate-500">📍</span>
                                <span className="text-slate-300">{business.address}</span>
                              </div>
                              {business.phone && (
                                <div className="flex gap-2 items-center">
                                  <span className="text-slate-500">📞</span>
                                  <a href={`tel:${business.phone}`} className="text-brand-400 hover:text-brand-300 font-mono transition">
                                    {business.phone}
                                  </a>
                                </div>
                              )}
                              {business.opening_hours && (
                                <div className="flex gap-2 items-start">
                                  <span className="text-slate-500">⏰</span>
                                  <div className="flex-1">
                                    <span className={business.isOpenNow ? "text-emerald-400 font-semibold" : "text-slate-500"}>
                                      {business.isOpenNow ? "Open Now" : "Closed"}
                                    </span>
                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                      {business.opening_hours[0]}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-3 pt-2">
                            {business.website && (
                              <a
                                href={business.website}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 py-2 rounded-xl bg-slate-950 border border-slate-850 hover:bg-slate-850 text-[11px] font-bold text-slate-300 hover:text-white transition flex items-center justify-center gap-1.5"
                              >
                                Website <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <button
                              onClick={() => openClaimModal(business)}
                              className="flex-1 py-2 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 border border-brand-500/20 text-[11px] font-bold transition"
                            >
                              Claim Listing
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 1: REVIEW & EDIT EMAIL DRAFT */}
      {/* ------------------------------------------------------------- */}
      {activeModal === 'draft' && selectedLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-850 flex justify-between items-center bg-slate-950/40">
              <div>
                <h3 className="font-bold text-white text-base">Outreach Email Editor</h3>
                <p className="text-xs text-slate-400">Personalized outreach draft for {selectedLead.name}</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">To</label>
                <input
                  type="text"
                  value={`${selectedLead.name} (${selectedLead.email})`}
                  disabled
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Subject Line</label>
                <input
                  type="text"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-4 py-2.5 text-sm text-slate-150 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Email Body (Markdown or Plain Text)</label>
                <textarea
                  rows={8}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-4 py-3 text-sm text-slate-150 focus:outline-none focus:border-brand-500 font-sans"
                />
              </div>

              {selectedLead.scrapedContent && (
                <div className="p-4 rounded-lg bg-slate-950/50 border border-slate-850">
                  <span className="text-[11px] font-semibold text-slate-400 block mb-1">Scraped Website Context Used:</span>
                  <p className="text-xs text-slate-500 italic max-h-24 overflow-y-auto">{selectedLead.scrapedContent}</p>
                </div>
              )}

              {selectedLead.jobDescription && (
                <div className="p-4 rounded-lg bg-slate-950/50 border border-slate-850">
                  <span className="text-[11px] font-semibold text-brand-400 flex items-center gap-1.5 mb-1">
                    <Briefcase className="w-3.5 h-3.5" />
                    Sourced Job Openings / Careers Context:
                  </span>
                  <p className="text-xs text-slate-400 max-h-24 overflow-y-auto">{selectedLead.jobDescription}</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-850 bg-slate-950/40 flex items-center justify-between">
              <button
                onClick={handleSaveDraft}
                disabled={draftSaving}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-white transition"
              >
                {draftSaving ? 'Saving...' : 'Save Changes'}
              </button>

              <button
                onClick={() => handleSendEmail(selectedLead.id)}
                disabled={draftSending}
                className="px-5 py-2.5 rounded-xl bg-brand-650 hover:bg-brand-550 text-xs font-semibold text-white shadow-lg shadow-brand-500/10 flex items-center gap-1.5 transition"
              >
                {draftSending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Approve & Send Outreach
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 2: CONVERSATION HISTORY & SIMULATED REPLY */}
      {/* ------------------------------------------------------------- */}
      {activeModal === 'thread' && selectedLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            <div className="px-6 py-4 border-b border-slate-850 flex justify-between items-center bg-slate-950/40">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-brand-500/10 flex items-center justify-center">
                  <MessageSquare className="w-4.5 h-4.5 text-brand-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">{selectedLead.name} Thread</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {getStageBadge(conversation ? conversation.stage : 'opened')}
                    <span className="text-[11px] text-slate-400">Total turns: {conversation ? conversation.turnCount : 0}/6</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {loadingThread ? (
              <div className="py-24 text-center flex-1">
                <RefreshCw className="w-8 h-8 text-brand-500 animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-400">Loading full message logs...</p>
              </div>
            ) : (
              <>
                {/* Message Log Grid */}
                <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-slate-950/30">
                  {conversation && JSON.parse(conversation.messageHistory).map((msg, idx) => {
                    const isUser = msg.role === 'user';
                    const isSystem = msg.role === 'system';

                    if (isSystem) {
                      return (
                        <div key={idx} className="flex justify-center my-2">
                          <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[10px] tracking-wide uppercase font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {msg.content}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={idx}
                        className={`flex gap-3 max-w-[80%] ${isUser ? 'ml-auto flex-row-reverse' : ''}`}
                      >
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold ${isUser ? 'bg-indigo-650 text-indigo-100' : 'bg-brand-650 text-brand-100'
                          }`}>
                          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>

                        <div className={`p-4 rounded-2xl relative text-sm ${isUser
                          ? 'bg-slate-800 text-slate-100 rounded-tr-none border border-slate-750'
                          : 'bg-brand-950/30 text-slate-150 rounded-tl-none border border-brand-900/30'
                          }`}>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          <span className="text-[9px] text-slate-500 block mt-2 text-right">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Facts Extraction Drawer */}
                {conversation && conversation.extractedFacts !== '{}' && (
                  <div className="px-6 py-3 border-t border-slate-850/80 bg-slate-900/80 text-xs text-slate-400 flex items-center justify-between">
                    <span className="font-semibold text-brand-400 uppercase tracking-wider text-[10px]">AI Extracted Facts:</span>
                    <span className="italic">{JSON.parse(conversation.extractedFacts).facts || 'No timeline/pricing details extracted.'}</span>
                  </div>
                )}

                {/* Simulated Lead Reply Panel */}
                <div className="p-6 border-t border-slate-850 bg-slate-950/40">
                  <span className="text-[11px] font-semibold text-slate-400 block mb-2 uppercase tracking-wider">Simulate Incoming Reply (Demo Tool)</span>
                  <form onSubmit={handleSendSimulatedReply} className="flex gap-2">
                    <input
                      type="text"
                      value={simulatedReplyText}
                      onChange={(e) => setSimulatedReplyText(e.target.value)}
                      placeholder="e.g. 'I'm interested, how much does it cost?' or 'Sounds good, let's connect next week.'"
                      className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-4 py-3 text-sm text-slate-150 placeholder-slate-600 focus:outline-none focus:border-brand-500"
                      disabled={sendingSimulatedReply}
                      required
                    />
                    <button
                      type="submit"
                      disabled={sendingSimulatedReply || !simulatedReplyText.trim()}
                      className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white rounded-xl shadow-lg shadow-indigo-500/10 flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      {sendingSimulatedReply ? (
                        <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                      ) : (
                        'Submit Reply'
                      )}
                    </button>
                  </form>
                  <div className="flex gap-4 mt-2">
                    <button
                      type="button"
                      onClick={() => setSimulatedReplyText("Not interested, unsubscribe please.")}
                      className="text-[10px] text-slate-500 hover:text-red-400 transition"
                    >
                      Quick Opt-Out Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimulatedReplyText("I'd love to learn more, what is the pricing?")}
                      className="text-[10px] text-slate-500 hover:text-indigo-400 transition"
                    >
                      Quick Pricing Question
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimulatedReplyText("Yes, I can do a call next Tuesday at 2 PM.")}
                      className="text-[10px] text-slate-500 hover:text-emerald-400 transition"
                    >
                      Quick Yes to Meeting
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 3: CALENDAR MEETING BOOKER */}
      {/* ------------------------------------------------------------- */}
      {activeModal === 'book' && selectedLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

            <div className="px-6 py-4 border-b border-slate-850 flex justify-between items-center bg-slate-950/40">
              <div>
                <h3 className="font-bold text-white text-base">Schedule Event Handoff</h3>
                <p className="text-xs text-slate-400">Confirm meeting with {selectedLead.name}</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmBooking} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Meeting Title</label>
                <input
                  type="text"
                  value={bookingSummary}
                  onChange={(e) => setBookingSummary(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-4 py-2.5 text-sm text-slate-150 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Start Time</label>
                <input
                  type="datetime-local"
                  value={bookingStart}
                  onChange={(e) => setBookingStart(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-4 py-2.5 text-sm text-slate-150 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">End Time</label>
                <input
                  type="datetime-local"
                  value={bookingEnd}
                  onChange={(e) => setBookingEnd(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg px-4 py-2.5 text-sm text-slate-150 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bookingLoading}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs text-white rounded-xl shadow-lg shadow-emerald-500/10 flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  {bookingLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Calendar className="w-3.5 h-3.5" />
                  )}
                  Confirm Event Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* CLAIM LISTING MODAL */}
      {/* ------------------------------------------------------------- */}
      {showClaimModal && claimBusiness && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-scaleIn">
            <div className="px-6 py-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
              <h3 className="font-bold text-white text-base">Claim Business Listing</h3>
              <button
                onClick={() => setShowClaimModal(false)}
                className="text-slate-400 hover:text-white transition text-lg"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleClaimSubmit} className="p-6 space-y-4">
              <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-850 text-xs text-slate-450 space-y-2">
                <p className="font-bold text-slate-300">Business Information:</p>
                <p>🏢 Name: <span className="text-slate-200">{claimBusiness.name}</span></p>
                <p>📍 Address: <span className="text-slate-200">{claimBusiness.address}</span></p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400 block">Owner/Representative Email</label>
                <input
                  type="email"
                  required
                  value={claimEmail}
                  onChange={(e) => setClaimEmail(e.target.value)}
                  placeholder="owner@domain.com"
                  className="w-full bg-slate-950 border border-slate-850 focus:border-brand-500/50 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-600 outline-none transition"
                />
                <p className="text-[10px] text-slate-550 leading-relaxed mt-1">
                  Enter your email address to claim this business. Sourcing networks will prioritize sending outreach offers to verified emails.
                </p>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-slate-850">
                <button
                  type="button"
                  onClick={() => setShowClaimModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={claimLoading}
                  className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-xs font-bold text-white transition flex items-center gap-1.5 shadow-lg shadow-brand-500/15 disabled:opacity-50"
                >
                  {claimLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                  Submit Claim
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* GLOBAL TOAST MESSAGE */}
      {/* ------------------------------------------------------------- */}
      {actionMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce">
          <div className={`px-5 py-4 rounded-xl border shadow-2xl flex items-center gap-3 text-sm font-semibold ${actionMessage.type === 'error'
            ? 'bg-rose-950/90 border-rose-500/30 text-rose-350'
            : actionMessage.type === 'info'
              ? 'bg-slate-900/90 border-brand-500/30 text-brand-350'
              : 'bg-slate-900/90 border-emerald-500/30 text-emerald-350'
            }`}>
            {actionMessage.type === 'error' ? (
              <XCircle className="w-5 h-5 text-rose-450" />
            ) : actionMessage.type === 'info' ? (
              <Bot className="w-5 h-5 text-brand-450 animate-pulse" />
            ) : (
              <CheckCircle className="w-5 h-5 text-emerald-450" />
            )}
            {actionMessage.text}
          </div>
        </div>
      )}

    </div>
  );
}
