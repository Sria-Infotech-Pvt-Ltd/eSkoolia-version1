"use client";

import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import {
  Send,
  Plus,
  Copy,
  CheckCircle2,
  MessageSquare,
  Mail,
  Phone,
  Calendar,
  Users,
  Zap,
  Star,
  X,
  ChevronDown,
  RefreshCw,
  Eye,
} from "lucide-react";

/* ─────────────────────── template data ─────────────────────── */
type Template = {
  id: string;
  name: string;
  category: string;
  channel: "whatsapp" | "email" | "sms";
  body: string;
  subject?: string;
  variables: string[];
  useCase: string;
};

const TEMPLATES: Template[] = [
  // WhatsApp
  {
    id: "wa-t1",
    name: "Thank You for Inquiry",
    category: "Welcome",
    channel: "whatsapp",
    useCase: "Auto-sent on form creation",
    variables: ["{parent_name}", "{school_name}", "{child_name}", "{grade}", "{portal_link}", "{counsellor_name}"],
    body: `Hi {parent_name} 👋 Thank you for your interest in {school_name}!

We've received your inquiry for {child_name}'s admission to {grade}. Our team will reach out within 24 hours.

Track your inquiry status here: {portal_link}

— {counsellor_name}, {school_name} Admissions`,
  },
  {
    id: "wa-t2",
    name: "First Follow-up Call Confirmation",
    category: "Follow-up",
    channel: "whatsapp",
    useCase: "When reaching out for first time",
    variables: ["{parent_name}", "{counsellor_name}", "{school_name}", "{child_name}", "{grade}"],
    body: `Hi {parent_name}, this is {counsellor_name} from {school_name}.

I'm reaching out regarding {child_name}'s admission inquiry for {grade}. Would you be available for a quick 5-minute call today?

Please reply with a convenient time 🙏`,
  },
  {
    id: "wa-t3",
    name: "Visit Invitation",
    category: "Visit",
    channel: "whatsapp",
    useCase: "Invite parent for campus tour",
    variables: ["{parent_name}", "{school_name}", "{grade}", "{child_name}", "{preferred_visit_date}"],
    body: `Hi {parent_name} 😊 We'd love to show you {school_name}!

{grade} has limited seats this year — a campus visit will help {child_name} see why families love us.

Can you visit on {preferred_visit_date}? Reply YES to confirm ✅`,
  },
  {
    id: "wa-t4",
    name: "Visit Reminder",
    category: "Visit",
    channel: "whatsapp",
    useCase: "Auto-sent 24 hrs before visit",
    variables: ["{parent_name}", "{child_name}", "{school_name}", "{visit_date}", "{visit_time}"],
    body: `Hi {parent_name}, just a reminder — {child_name}'s school visit at {school_name} is tomorrow ({visit_date}) at {visit_time}.

Please use the main entrance. Looking forward to meeting you! 🏫

— {school_name} Team`,
  },
  {
    id: "wa-t5",
    name: "Post-Visit Thank You",
    category: "Post-Visit",
    channel: "whatsapp",
    useCase: "After campus visit",
    variables: ["{parent_name}", "{child_name}", "{school_name}", "{counsellor_phone}", "{portal_link}"],
    body: `Hi {parent_name}, it was wonderful meeting you and {child_name} today! We hope you loved the campus.

If you have any questions, I'm here to help: {counsellor_phone}

To complete {child_name}'s enrollment: {portal_link} 🎒`,
  },
  {
    id: "wa-t6",
    name: "Seat Filling Fast",
    category: "Urgency",
    channel: "whatsapp",
    useCase: "When grade is 80%+ full",
    variables: ["{parent_name}", "{grade}", "{school_name}", "{seats_left}", "{child_name}", "{counsellor_name}"],
    body: `Hi {parent_name}, a quick update — {grade} at {school_name} has only {seats_left} seats remaining for 2026-27.

We'd hate for {child_name} to miss out! Should we reserve a spot? Reply YES and I'll guide you 🙏

— {counsellor_name}`,
  },
  {
    id: "wa-t7",
    name: "Re-engagement (Cold Lead)",
    category: "Re-engagement",
    channel: "whatsapp",
    useCase: "Cold leads 10+ days old",
    variables: ["{parent_name}", "{child_name}", "{school_name}", "{portal_link}"],
    body: `Hi {parent_name} 👋 We noticed {child_name}'s admission inquiry is still open at {school_name}.

We completely understand if you're still deciding — we're happy to answer any questions.

Would a quick campus visit help? {portal_link}`,
  },
  {
    id: "wa-t8",
    name: "Sibling Discount Offer",
    category: "Offer",
    channel: "whatsapp",
    useCase: "Families with siblings enrolled",
    variables: ["{parent_name}", "{sibling_name}", "{school_name}", "{child_name}", "{sibling_discount}", "{grade}", "{offer_expiry}", "{school_phone}"],
    body: `Hi {parent_name} 🎉 Since {sibling_name} is already part of the {school_name} family, {child_name} is eligible for our {sibling_discount}% sibling discount for {grade} admission.

This offer is valid till {offer_expiry}. Shall we proceed?

Call us: {school_phone}`,
  },
  {
    id: "wa-t9",
    name: "Enrollment Confirmed",
    category: "Enrollment",
    channel: "whatsapp",
    useCase: "On successful enrollment",
    variables: ["{parent_name}", "{child_name}", "{school_name}", "{grade}"],
    body: `🎊 Congratulations {parent_name}! {child_name} is officially enrolled at {school_name} for {grade}, Academic Year 2026-27.

Welcome to our school family! Please visit the office to submit documents.

See you soon! 📚`,
  },
  {
    id: "wa-t10",
    name: "Open House Invite",
    category: "Event",
    channel: "whatsapp",
    useCase: "Open house event promotion",
    variables: ["{parent_name}", "{school_name}", "{event_date}", "{event_time}", "{rsvp_link}", "{child_name}"],
    body: `Hi {parent_name} 🏫 You're invited to {school_name}'s Open House on {event_date} at {event_time}!

Meet our teachers, tour the campus, and see why 95% of visiting families choose us.

RSVP here: {rsvp_link} — Limited seats. Bring {child_name}! 🌟`,
  },
  // Email Templates
  {
    id: "em-t11",
    name: "Inquiry Acknowledgment",
    category: "Welcome",
    channel: "email",
    useCase: "Detailed acknowledgment on inquiry creation",
    subject: "Your admission inquiry for {child_name} — {school_name}",
    variables: ["{parent_name}", "{child_name}", "{grade}", "{counsellor_name}", "{portal_link}", "{school_phone}", "{school_name}"],
    body: `Dear {parent_name},

Thank you for your interest in {school_name}! We've received your admission inquiry for {child_name} applying to {grade} for the 2026-27 academic year.

Here's what happens next:
1. Our counsellor {counsellor_name} will call you within 24 hours
2. We'll invite you for a campus visit — the best way to experience our school
3. We'll guide you through the enrollment process step by step

Track your inquiry status anytime: {portal_link}

Any questions? Reply to this email or call {school_phone}.

Warm regards,
{counsellor_name}
{school_name} Admissions Team`,
  },
  {
    id: "em-t12",
    name: "Visit Booking Confirmation",
    category: "Visit",
    channel: "email",
    useCase: "Confirm campus visit details",
    subject: "Your campus visit is confirmed — {school_name}",
    variables: ["{parent_name}", "{child_name}", "{visit_date}", "{visit_time}", "{school_address}", "{counsellor_name}", "{counsellor_phone}", "{school_name}"],
    body: `Dear {parent_name},

Great news! Your campus visit for {child_name} has been confirmed:
📅 Date: {visit_date}
⏰ Time: {visit_time}
📍 Venue: {school_address}
👤 Your counsellor: {counsellor_name} ({counsellor_phone})

Please arrive 5 minutes early. Parking is available at the main gate.

What to bring: Any school records or transfer certificate (optional)

Looking forward to meeting you!

Warm regards,
{school_name} Admissions Team`,
  },
  {
    id: "em-t13",
    name: "Monthly Newsletter",
    category: "Nurture",
    channel: "email",
    useCase: "Monthly update to all active inquiries",
    subject: "Updates from {school_name} — {month_year}",
    variables: ["{parent_name}", "{school_name}", "{month_year}", "{event_date}", "{grade}", "{deadline_date}", "{seats_left}", "{school_phone}", "{school_website}"],
    body: `Dear {parent_name},

Here's a quick update for families considering {school_name}:

🏆 This month's highlights:
• [Achievement 1]
• [Achievement 2]
• [Achievement 3]

📅 Upcoming:
• Open House: {event_date}
• Admission deadline for {grade}: {deadline_date}

💺 Seats remaining in {grade}: {seats_left}

Questions? Reply to this email or call {school_phone}.

{school_name} Admissions Team | {school_website}`,
  },
  {
    id: "em-t14",
    name: "Post-Decline Save Attempt",
    category: "Save",
    channel: "email",
    useCase: "After a lead is marked declined",
    subject: "We understand — and we're here if you change your mind",
    variables: ["{parent_name}", "{school_name}", "{child_name}"],
    body: `Dear {parent_name},

Thank you for considering {school_name} for {child_name}.

We understand you've chosen a different path for now, and we completely respect your decision.

If circumstances change or you'd like to reconsider, we'd be honoured to welcome {child_name} to our school family. Our doors are always open.

Wishing {child_name} all the very best 🌟

Warm regards,
{school_name} Admissions Team`,
  },
  {
    id: "em-t15",
    name: "Referral Ask",
    category: "Referral",
    channel: "email",
    useCase: "After enrollment — ask for referrals",
    subject: "Could you help another family find the right school?",
    variables: ["{parent_name}", "{child_name}", "{school_name}", "{referral_benefit}"],
    body: `Dear {parent_name},

It's been wonderful having {child_name} at {school_name}!

We'd love to welcome more great families like yours. If you know of any families looking for a school, please share our details — we offer a referral benefit for you: {referral_benefit}.

Simply ask them to mention your name when they enquire!

With gratitude,
{school_name} Team`,
  },
];

/* ─────────────────────── campaign mock data ─────────────────────── */
type Campaign = {
  id: number;
  name: string;
  status: "draft" | "scheduled" | "sent" | "active";
  channel: string;
  audience: string;
  sentCount?: number;
  deliveredPct?: number;
  replies?: number;
  scheduledFor?: string;
  sentAt?: string;
};

// The real Campaign API (apps.admissions.views.CampaignViewSet) — this used to be
// entirely absent: every create/cancel/activate/pause/delete action here just
// mutated local React state seeded from a hardcoded demo array, so nothing ever
// survived a page refresh (QA: campaigns created or cancelled don't persist).
type ApiCampaign = {
  id: number;
  name: string;
  channel: string;
  audience: string;
  status: "draft" | "scheduled" | "active" | "sent";
  scheduled_for: string | null;
  sent_at: string | null;
  sent_count: number;
  delivered_pct: number | null;
  replies: number | null;
};

function formatCampaignDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mapApiCampaign(row: ApiCampaign): Campaign {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    channel: row.channel,
    audience: row.audience,
    sentCount: row.sent_count,
    deliveredPct: row.delivered_pct ?? undefined,
    replies: row.replies ?? undefined,
    scheduledFor: row.scheduled_for ? formatCampaignDateTime(row.scheduled_for) : undefined,
    sentAt: row.sent_at ? formatCampaignDateTime(row.sent_at) : undefined,
  };
}

async function fetchCampaigns(): Promise<Campaign[]> {
  const data = await apiRequestWithRefresh<{ results?: ApiCampaign[] } | ApiCampaign[]>("/api/v1/admissions/campaigns/?page_size=200");
  const rows = Array.isArray(data) ? data : (data.results ?? []);
  return rows.map(mapApiCampaign);
}

async function createCampaignApi(input: { name: string; channel: string; audience: string; scheduledFor: string }): Promise<Campaign> {
  const payload: Record<string, unknown> = { name: input.name, channel: input.channel, audience: input.audience };
  if (input.scheduledFor) payload.scheduled_for = new Date(input.scheduledFor).toISOString();
  const row = await apiRequestWithRefresh<ApiCampaign>("/api/v1/admissions/campaigns/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return mapApiCampaign(row);
}

async function updateCampaignApi(id: number, payload: Record<string, unknown>): Promise<Campaign> {
  const row = await apiRequestWithRefresh<ApiCampaign>(`/api/v1/admissions/campaigns/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return mapApiCampaign(row);
}

async function campaignStatusAction(id: number, action: "activate" | "pause" | "cancel"): Promise<Campaign> {
  const res = await apiRequestWithRefresh<{ data: ApiCampaign }>(`/api/v1/admissions/campaigns/${id}/${action}/`, { method: "POST" });
  return mapApiCampaign(res.data);
}

async function deleteCampaignApi(id: number): Promise<void> {
  await apiRequestWithRefresh<void>(`/api/v1/admissions/campaigns/${id}/`, { method: "DELETE" });
}

/* ─────────────────────── helpers ─────────────────────── */
function ChannelBadge({ ch }: { ch: Template["channel"] }) {
  const map = {
    whatsapp: { bg: "#dcfce7", color: "#15803d", label: "WhatsApp" },
    email: { bg: "#dbeafe", color: "#1d4ed8", label: "Email" },
    sms: { bg: "#fef9c3", color: "#a16207", label: "SMS" },
  };
  const s = map[ch];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const map = {
    draft: { bg: "#f3f4f6", color: "#6b7280", label: "Draft" },
    scheduled: { bg: "#eff6ff", color: "#1d4ed8", label: "● Scheduled" },
    active: { bg: "#ecfdf5", color: "#059669", label: "● Active" },
    sent: { bg: "#f5f3ff", color: "#7c3aed", label: "✓ Sent" },
  };
  const s = map[status];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

/* ─────────────────────── category styles ─────────────────────── */
const CATEGORY_STYLES: Record<string, { color: string; emoji: string }> = {
  Welcome: { color: '#3b82f6', emoji: '👋' },
  'Follow-up': { color: '#14b8a6', emoji: '📞' },
  Visit: { color: '#f59e0b', emoji: '🏫' },
  Urgency: { color: '#ef4444', emoji: '🔥' },
  Offer: { color: '#8b5cf6', emoji: '🎁' },
  Enrollment: { color: '#22c55e', emoji: '🎉' },
  'Re-engagement': { color: '#6366f1', emoji: '💙' },
  Event: { color: '#ec4899', emoji: '🌟' },
  'Post-Visit': { color: '#f59e0b', emoji: '🤝' },
  Nurture: { color: '#0ea5e9', emoji: '🌱' },
  Save: { color: '#ef4444', emoji: '💔' },
  Referral: { color: '#10b981', emoji: '🎯' },
};

function CountUp({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const steps = 30;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + increment, target);
      setCount(Math.round(current));
      if (current >= target) clearInterval(timer);
    }, Math.round(800 / steps));
    return () => clearInterval(timer);
  }, [target]);
  return <>{count}{suffix}</>;
}

function CampaignEditModal({ campaign, isOpen, onClose, onSave }: { campaign: Campaign; isOpen: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(campaign.name);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Edit Campaign</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Campaign Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Channel</label>
            <input value={campaign.channel} readOnly
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Audience</label>
            <input value={campaign.audience} readOnly
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={() => { onSave(name.trim() || campaign.name); onClose(); }}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700">Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function TemplatePreviewModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const highlightVars = (text: string) =>
    text.split(/(\{[^}]+\})/g).map((part, i) =>
      part.startsWith('{') ? (
        <span key={i} className="bg-blue-100 text-blue-700 rounded px-1 py-0.5 text-xs font-medium mx-0.5">{part}</span>
      ) : <span key={i}>{part}</span>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900">{template.name}</h2>
            <div className="flex gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                template.channel === 'whatsapp' ? 'bg-green-100 text-green-700' :
                template.channel === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
              }`}>{template.channel}</span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{template.category}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>
        <div className="p-5">
          {template.channel === 'whatsapp' ? (
            <div className="bg-[#128C7E] rounded-t-xl rounded-br-xl p-1">
              <div className="bg-[#ECE5DD] rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
                {highlightVars(template.body)}
              </div>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {template.subject && (
                <div className="bg-gray-50 border-b border-gray-200 p-3">
                  <span className="text-xs text-gray-400">Subject: </span>
                  <span className="text-sm font-medium text-gray-800">{template.subject}</span>
                </div>
              )}
              <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
                {highlightVars(template.body)}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">💡 Use case: {template.useCase}</p>
        </div>
        <div className="flex gap-3 p-5 pt-0 border-t border-gray-100">
          <button onClick={() => { navigator.clipboard.writeText(template.body); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className={`flex-1 border rounded-lg py-2 text-sm font-medium transition-colors ${copied ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {copied ? '✓ Copied!' : '📋 Copy Text'}
          </button>
          <button onClick={onClose} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── main component ─────────────────────── */
export function AdmissionsMarketing() {
  const [templateTab, setTemplateTab] = useState<Template["channel"]>("whatsapp");
  const [searchQ, setSearchQ] = useState("");
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCampaignsLoading(true);
    fetchCampaigns()
      .then((rows) => { if (!cancelled) setCampaigns(rows); })
      .catch(() => { if (!cancelled) toast.error("Could not load campaigns."); })
      .finally(() => { if (!cancelled) setCampaignsLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);
  const [events, setEvents] = useState([
    { name: "Open House", date: "15 May 2026", time: "10:00 AM", rsvp: 14, capacity: 40 },
    { name: "Campus Tour", date: "22 May 2026", time: "11:00 AM", rsvp: 6, capacity: 20 },
  ]);
  const [showNewEvent, setShowNewEvent] = useState(false);

  const filtered = TEMPLATES.filter(
    (t) => t.channel === templateTab && (searchQ === "" || t.name.toLowerCase().includes(searchQ.toLowerCase()) || t.category.toLowerCase().includes(searchQ.toLowerCase()))
  );

  function handleEditCampaign(campaign: Campaign) {
    setEditingCampaign(campaign);
    setEditModalOpen(true);
  }

  async function handleCampaignStatusAction(id: number, action: "activate" | "pause" | "cancel") {
    try {
      const updated = await campaignStatusAction(id, action);
      setCampaigns((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch {
      toast.error("Could not update this campaign. Please try again.");
    }
  }

  async function handleDeleteCampaign(id: number) {
    const previous = campaigns;
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteCampaignApi(id);
    } catch {
      setCampaigns(previous);
      toast.error("Could not delete this campaign. Please try again.");
    }
  }

  const card: React.CSSProperties = {
    background: "#fff",
    border: "1px solid var(--line, #e5e7eb)",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,.06)",
  };

  return (
    <div style={{ padding: "24px 16px", maxWidth: 1280, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fdf2f8", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Send size={20} color="#a21caf" strokeWidth={1.8} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--ink-1, #111)", margin: 0 }}>Admissions Marketing</h1>
            <p style={{ fontSize: 12, color: "var(--ink-2, #6b7280)", margin: 0 }}>Campaigns, templates, and event management</p>
          </div>
        </div>
        <button
          onClick={() => setShowNewCampaign(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 16px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          <Plus size={15} /> New Campaign
        </button>
      </div>

      {/* ── Active Campaigns ── */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line, #e5e7eb)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={15} color="#f59e0b" strokeWidth={1.8} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-1, #111)" }}>Campaigns</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-2, #6b7280)", background: "#f3f4f6", borderRadius: 20, padding: "1px 8px" }}>{campaigns.length}</span>
          </div>
        </div>

        {campaignsLoading ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--ink-2, #6b7280)", fontSize: 13.5 }}>
            Loading campaigns…
          </div>
        ) : campaigns.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center" }}>
            <Send size={40} color="#e5e7eb" />
            <p style={{ color: "var(--ink-2, #6b7280)", marginTop: 12, fontSize: 14 }}>No campaigns yet.</p>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Create your first campaign to start reaching parents at scale.</p>
            <button
              onClick={() => setShowNewCampaign(true)}
              style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 20px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
            >
              <Plus size={14} /> Create Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {campaigns.map((campaign) => {
              const stripeColor = campaign.status === 'scheduled' ? 'bg-blue-500'
                : campaign.status === 'sent' ? 'bg-green-500'
                : campaign.status === 'active' ? 'bg-amber-500'
                : 'bg-gray-400';
              const statusBadge = campaign.status === 'sent'
                ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">✓ Sent</span>
                : campaign.status === 'scheduled'
                ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">⏰ Scheduled</span>
                : campaign.status === 'active'
                ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">● Active</span>
                : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">✏️ Draft</span>;
              const channelIcon = campaign.channel.includes('WhatsApp') && campaign.channel.includes('Email') ? '💬📧'
                : campaign.channel.includes('WhatsApp') ? '💬'
                : campaign.channel.includes('Email') ? '📧'
                : '📱';
              return (
                <div key={campaign.id} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:scale-[1.002] transition-all overflow-hidden flex">
                  <div className={`w-1.5 flex-shrink-0 ${stripeColor}${campaign.status === 'active' ? ' animate-pulse' : ''}`} />
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-gray-900">{campaign.name}</span>
                      {statusBadge}
                    </div>
                    <div className="text-sm text-gray-500 mb-2">
                      {channelIcon} {campaign.channel} · 👥 {campaign.audience}
                    </div>
                    {campaign.status === 'sent' && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{campaign.sentCount} parents</span>
                        <span className="text-xs bg-green-50 text-green-700 rounded-full px-2 py-0.5">{campaign.deliveredPct}% delivered</span>
                        <span className="text-xs bg-purple-50 text-purple-700 rounded-full px-2 py-0.5">{campaign.replies} replies</span>
                      </div>
                    )}
                    {campaign.status === 'scheduled' && (
                      <div className="text-xs text-blue-600 mb-3">Scheduled: {campaign.scheduledFor} · {campaign.sentCount} recipients</div>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleEditCampaign(campaign)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-50 text-gray-700">Edit</button>
                      
                      {campaign.status === 'draft' && (
                        <button type="button" onClick={() => handleCampaignStatusAction(campaign.id, 'activate')} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-blue-700">Activate</button>
                      )}

                      {campaign.status === 'active' && (
                        <button type="button" onClick={() => handleCampaignStatusAction(campaign.id, 'pause')} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-50 text-gray-700">Pause</button>
                      )}

                      {campaign.status === 'sent' && (
                        <button type="button" onClick={() => setReportCampaign(campaign)} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-blue-700">View Report</button>
                      )}

                      {campaign.status === 'scheduled' && (
                        <button type="button" onClick={() => handleCampaignStatusAction(campaign.id, 'cancel')} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-50 text-gray-700">Cancel</button>
                      )}

                      {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
                        <button type="button" onClick={() => handleDeleteCampaign(campaign.id)} className="border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-sm hover:bg-red-50 text-gray-700">Delete</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary bar */}
        {campaigns.some(c => c.status === "sent") && (
          <div className="p-4 border-t border-gray-100">
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: '📨', iconBg: 'bg-blue-100', label: 'Total Sent', value: campaigns.filter(c => c.sentCount).reduce((a, c) => a + (c.sentCount ?? 0), 0), suffix: '', sub: null },
                { icon: '✅', iconBg: 'bg-green-100', label: 'Avg Delivery', value: Math.round(campaigns.filter(c => c.deliveredPct).reduce((a, c) => a + (c.deliveredPct ?? 0), 0) / campaigns.filter(c => c.deliveredPct).length), suffix: '%', sub: 'Industry avg: 90%' },
                { icon: '💬', iconBg: 'bg-purple-100', label: 'Total Replies', value: campaigns.reduce((a, c) => a + (c.replies ?? 0), 0), suffix: '', sub: '7.5% reply rate' },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                  <div className={`w-8 h-8 ${s.iconBg} rounded-lg flex items-center justify-center text-base mb-2`}>{s.icon}</div>
                  <div className="text-xl font-bold text-gray-900"><CountUp target={s.value} suffix={s.suffix} /></div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                  {s.sub && <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Templates Library ── */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line, #e5e7eb)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MessageSquare size={15} color="#6366f1" strokeWidth={1.8} />
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-1, #111)" }}>Message Templates Library</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-2, #6b7280)", background: "#f3f4f6", borderRadius: 20, padding: "1px 8px" }}>{TEMPLATES.length} templates</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search templates…"
                style={{ height: 32, padding: "0 12px", border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, fontSize: 12.5, width: 180, outline: "none" }}
              />
            </div>
          </div>
          {/* Channel tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            {(["whatsapp", "email", "sms"] as Template["channel"][]).map((ch) => {
              const labels = { whatsapp: "💬 WhatsApp", email: "📧 Email", sms: "📱 SMS" };
              const badgeColors = { whatsapp: "bg-green-500", email: "bg-blue-500", sms: "bg-yellow-500" };
              const cnt = TEMPLATES.filter(t => t.channel === ch).length;
              return (
                <button
                  key={ch}
                  onClick={() => setTemplateTab(ch)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all flex items-center gap-1.5 ${
                    templateTab === ch ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {labels[ch]}
                  <span className={`text-xs rounded-full px-1.5 py-0.5 text-white font-bold ${badgeColors[ch]}`}>{cnt}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 13 }}>No templates match your search.</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {filtered.map((t) => {
                const catStyle = CATEGORY_STYLES[t.category] ?? { color: '#6b7280', emoji: '📄' };
                return (
                  <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all cursor-pointer">
                    <div className="h-9 flex items-center px-4" style={{ backgroundColor: catStyle.color }}>
                      <span className="text-xl">{catStyle.emoji}</span>
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{t.name}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{t.useCase}</div>
                        </div>
                        <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 whitespace-nowrap">{t.variables.length} vars</span>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <ChannelBadge ch={t.channel} />
                        <button
                          onClick={() => setPreviewTemplate(t)}
                          className="w-8 h-8 border border-gray-200 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
                        >
                          <Eye size={13} color="#6b7280" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Events Manager ── */}
      <div style={card}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line, #e5e7eb)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={15} color="#0ea5e9" strokeWidth={1.8} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-1, #111)" }}>Events Manager</span>
          </div>
          <button
            onClick={() => setShowNewEvent(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            <Plus size={13} /> New Event
          </button>
        </div>
        <div style={{ padding: 20 }}>
          {events.map((ev, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid var(--line, #e5e7eb)", flexWrap: "wrap", gap: 10 }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1, #111)", marginBottom: 2 }}>{ev.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2, #6b7280)" }}>
                  📅 {ev.date} · ⏰ {ev.time} · 🎟️ {ev.rsvp}/{ev.capacity} RSVPs
                </div>
                <div style={{ marginTop: 6, height: 5, width: 180, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(ev.rsvp / ev.capacity) * 100}%`, background: "#0ea5e9", borderRadius: 3 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setEvents(prev => prev.map((e, idx) => idx === i && e.rsvp < e.capacity ? { ...e, rsvp: e.rsvp + 1 } : e))}
                  style={{ padding: "6px 12px", border: "1px solid var(--line, #e5e7eb)", borderRadius: 7, background: "#fff", fontSize: 12, cursor: "pointer" }}
                >
                  Manage RSVPs
                </button>
                <button
                  onClick={() => toast.success(`Reminder sent to ${Math.max(ev.capacity - ev.rsvp, 0)} pending invitee(s) for ${ev.name}.`)}
                  style={{ padding: "6px 12px", border: "1px solid #bfdbfe", borderRadius: 7, background: "#eff6ff", color: "#1d4ed8", fontSize: 12, cursor: "pointer" }}
                >
                  Send Reminder
                </button>
              </div>
            </div>
          ))}
          <p style={{ marginTop: 16, fontSize: 12.5, color: "#9ca3af", textAlign: "center" }}>
            Create an event to auto-generate RSVP links and bulk-invite all active inquiries with one click.
          </p>
        </div>
      </div>

      {previewTemplate && <TemplatePreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />}
      {editingCampaign && (
        <CampaignEditModal
          campaign={editingCampaign}
          isOpen={editModalOpen}
          onClose={() => { setEditModalOpen(false); setEditingCampaign(null); }}
          onSave={async (name) => {
            try {
              const updated = await updateCampaignApi(editingCampaign.id, { name });
              setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? updated : c));
              toast.success("Campaign updated.");
            } catch {
              toast.error("Could not update this campaign. Please try again.");
            }
          }}
        />
      )}
      {reportCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReportCampaign(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{reportCampaign.name} — Report</h2>
              <button onClick={() => setReportCampaign(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">✕</button>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex justify-between"><span>Sent to</span><span className="font-semibold">{reportCampaign.sentCount ?? 0} parents</span></div>
              <div className="flex justify-between"><span>Delivered</span><span className="font-semibold">{reportCampaign.deliveredPct ?? 0}%</span></div>
              <div className="flex justify-between"><span>Replies</span><span className="font-semibold">{reportCampaign.replies ?? 0}</span></div>
              <div className="flex justify-between"><span>Channel</span><span className="font-semibold">{reportCampaign.channel}</span></div>
              <div className="flex justify-between"><span>Audience</span><span className="font-semibold">{reportCampaign.audience}</span></div>
            </div>
            <button onClick={() => setReportCampaign(null)} className="w-full mt-6 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700">Close</button>
          </div>
        </div>
      )}
      {showNewEvent && (
        <NewEventModal
          onCancel={() => setShowNewEvent(false)}
          onSave={(ev) => {
            setEvents(prev => [...prev, ev]);
            setShowNewEvent(false);
            toast.success("Event created.");
          }}
        />
      )}

      {/* ── New Campaign Modal ── */}
      {showNewCampaign && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowNewCampaign(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 520, padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>New Campaign</h2>
              <button onClick={() => setShowNewCampaign(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X size={18} color="var(--ink-2, #6b7280)" />
              </button>
            </div>
            <NewCampaignForm
              onSave={(camp) => {
                setCampaigns((prev) => [camp, ...prev]);
                setShowNewCampaign(false);
              }}
              onCancel={() => setShowNewCampaign(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── New Campaign Form ─── */
function NewCampaignForm({ onSave, onCancel }: { onSave: (c: Campaign) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", channel: "WhatsApp", audience: "All active inquiries", scheduledFor: "" });
  const [saving, setSaving] = useState(false);
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--ink-1, #111)", marginBottom: 4, display: "block" };
  const inputStyle: React.CSSProperties = { width: "100%", height: 38, border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, padding: "0 12px", fontSize: 13, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>Campaign Name</label>
        <input value={form.name} onChange={f("name")} placeholder="e.g. Open House May 2026" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Channel</label>
        <select value={form.channel} onChange={f("channel")} style={{ ...inputStyle, background: "#fff" }}>
          <option>WhatsApp</option>
          <option>Email</option>
          <option>WhatsApp + Email</option>
          <option>SMS</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Audience</label>
        <select value={form.audience} onChange={f("audience")} style={{ ...inputStyle, background: "#fff" }}>
          <option>All active inquiries</option>
          <option>All active inquiries (Grade 1–5)</option>
          <option>Cold leads (10+ days no contact)</option>
          <option>Post-visit (not yet enrolled)</option>
          <option>All enrolled families</option>
          <option>Custom filter</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Schedule Date & Time</label>
        <input type="datetime-local" value={form.scheduledFor} onChange={f("scheduledFor")} style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 18px", border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            if (!form.name) return;
            setSaving(true);
            try {
              const created = await createCampaignApi(form);
              onSave(created);
            } catch {
              toast.error("Could not create this campaign. Please try again.");
            } finally {
              setSaving(false);
            }
          }}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Saving…" : form.scheduledFor ? "Schedule Campaign" : "Save Draft"}
        </button>
      </div>
    </div>
  );
}

/* ─── New Event Modal ─── */
type MarketingEvent = { name: string; date: string; time: string; rsvp: number; capacity: number };

function NewEventModal({ onSave, onCancel }: { onSave: (ev: MarketingEvent) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", date: "", time: "", capacity: "40" });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--ink-1, #111)", marginBottom: 4, display: "block" };
  const inputStyle: React.CSSProperties = { width: "100%", height: 38, border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, padding: "0 12px", fontSize: 13, outline: "none", boxSizing: "border-box" };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onCancel}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>New Event</h2>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} color="var(--ink-2, #6b7280)" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Event Name</label>
            <input value={form.name} onChange={f("name")} placeholder="e.g. Open House" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.date} onChange={f("date")} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Time</label>
              <input type="time" value={form.time} onChange={f("time")} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Capacity</label>
            <input type="number" min={1} value={form.capacity} onChange={f("capacity")} style={inputStyle} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" onClick={onCancel} style={{ padding: "8px 18px", border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button
              type="button"
              onClick={() => {
                const trimmedName = form.name.trim();
                if (!trimmedName || !form.date) return;
                if (!/[a-zA-Z]/.test(trimmedName)) {
                  toast.error("Event name must contain at least one letter.");
                  return;
                }
                const dateLabel = new Date(form.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                const timeLabel = form.time
                  ? new Date(`1970-01-01T${form.time}`).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "";
                onSave({
                  name: trimmedName,
                  date: dateLabel,
                  time: timeLabel,
                  rsvp: 0,
                  capacity: Math.max(1, Number(form.capacity) || 40),
                });
              }}
              style={{ padding: "8px 18px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Create Event
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
