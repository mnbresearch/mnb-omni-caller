/**
 * MNB Omni Caller — demo data.
 * Read-only sample content shown to visitors who click "View live demo".
 * Uses realistic but entirely fictional data so no real customer information
 * is ever exposed publicly, and no real calls or API quota are used.
 */

const AGENT_ID = 90001;

const agent = {
  id: AGENT_ID,
  name: 'MNB Demo Sales Agent',
  bot_type: 'prompt',
  user_name: 'MNB Research',
  language: ['English (India)', 'Hindi'],
  voice: 'demo-voice',
  voice_provider: 'cartesia',
  voice_name: 'Riya',
  english_voice_accent: 'en-IN',
  llm_service: 'gpt-4.1-mini',
  status_of_building_flow: 'Completed',
  bot_call_type: 'Outgoing',
  welcome_message: 'Hi, this is Riya from MNB Research. Am I speaking with [user_name]?',
  context_breakdown: [
    { context_title: 'Identity & Purpose', context_body: '- You are Riya, the AI sales assistant for MNB Research.\n- You call prospective clients who have shown interest in AI automation.\n- Your goal is to understand their needs and book a strategy call.', is_enabled: true },
    { context_title: 'Qualify the lead', context_body: '- Ask what part of their business they want to automate.\n- Ask about team size and current tools.\n- Gauge budget and timeline politely.', is_enabled: true },
    { context_title: 'Book the meeting', context_body: '- Offer a free 30-minute strategy call.\n- Confirm a preferred time and their email.', is_enabled: true },
    { context_title: 'Handle objections', context_body: '- If they are not interested, stay polite and offer to follow up later.\n- Never be pushy.', is_enabled: true },
    { context_title: 'Closing', context_body: '- Thank them warmly and confirm next steps.', is_enabled: true },
  ],
};

function d(day, time) { return `07/${String(day).padStart(2, '0')}/2026 ${time}`; }

const logs = [
  { id: 91001, bot_name: agent.name, time_of_call: d(9, '11:42:10'), from_number: '+91 80 4879 9695', to_number: '+91 98111 20034', call_direction: 'outbound', call_duration: '3:12', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Positive', sentiment_analysis_details: 'Prospect was interested in automating lead follow-ups and agreed to a strategy call on Friday.', call_conversation: ' <br/> LLM: Hi, this is Riya from MNB Research. Am I speaking with Aarav? <br/> user: Yes, speaking. <br/> LLM: Great! I saw you were exploring AI for your real-estate business. What would you most like to automate? <br/> user: Mainly following up with leads, it eats our whole day. <br/> LLM: Perfect fit. Could I book you a free 30-minute strategy call this Friday? <br/> user: Sure, Friday works. <br/> LLM: Booked. Thank you Aarav, have a great day! <br/>' },
  { id: 91002, bot_name: agent.name, time_of_call: d(9, '12:05:44'), from_number: '+91 80 4879 9695', to_number: '+91 99870 55123', call_direction: 'outbound', call_duration: '1:58', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Neutral', sentiment_analysis_details: 'Prospect asked for pricing details to be sent over email before committing.', call_conversation: ' <br/> LLM: Hi, this is Riya from MNB Research. Is this Priya? <br/> user: Yes. <br/> LLM: You had asked about AI voice agents. What are you hoping to achieve? <br/> user: Can you email me the pricing first? <br/> LLM: Absolutely, I will send that across today. <br/>' },
  { id: 91003, bot_name: agent.name, time_of_call: d(9, '12:31:19'), from_number: '+91 80 4879 9695', to_number: '+91 90045 78290', call_direction: 'outbound', call_duration: '4:47', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Positive', sentiment_analysis_details: 'Highly interested owner of a dental clinic; wants AI to handle appointment booking. Meeting booked.', call_conversation: ' <br/> LLM: Hello, Riya from MNB Research here. Am I speaking with Dr. Mehta? <br/> user: Yes, that is me. <br/> LLM: You run a dental clinic, correct? What takes up most of your front-desk time? <br/> user: Appointment calls, definitely. <br/> LLM: Our AI can answer and book those 24/7. Shall we set up a demo call? <br/> user: Yes please, this sounds useful. <br/>' },
  { id: 91004, bot_name: agent.name, time_of_call: d(9, '13:02:51'), from_number: '+91 80 4879 9695', to_number: '+91 98765 43210', call_direction: 'outbound', call_duration: '0:0', recording_url: false, call_status: 'no-answer', channel_type: 'Phone', sentiment_score: '', sentiment_analysis_details: '', call_conversation: '' },
  { id: 91005, bot_name: agent.name, time_of_call: d(9, '13:20:08'), from_number: '+91 80 4879 9695', to_number: '+91 91234 88771', call_direction: 'outbound', call_duration: '2:34', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Positive', sentiment_analysis_details: 'E-commerce founder interested in AI for cart-recovery calls.', call_conversation: ' <br/> LLM: Hi, Riya from MNB Research. Is this Rohan? <br/> user: Yeah. <br/> LLM: You sell online, right? We can call customers who abandon carts and recover sales. Interested? <br/> user: That is actually clever, tell me more. <br/> LLM: Let us set up a quick call to walk you through it. <br/> user: Go for it. <br/>' },
  { id: 91006, bot_name: agent.name, time_of_call: d(9, '14:10:33'), from_number: '+91 80 4879 9695', to_number: '+91 90876 12245', call_direction: 'outbound', call_duration: '0:41', recording_url: false, call_status: 'busy', channel_type: 'Phone', sentiment_score: '', sentiment_analysis_details: '', call_conversation: '' },
  { id: 91007, bot_name: agent.name, time_of_call: d(9, '14:38:27'), from_number: '+91 80 4879 9695', to_number: '+91 98330 44120', call_direction: 'outbound', call_duration: '3:55', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Positive', sentiment_analysis_details: 'Gym owner wants AI to call and re-engage lapsed members. Booked for Monday.', call_conversation: ' <br/> LLM: Hello, this is Riya from MNB Research. Am I speaking with Kabir? <br/> user: Yes. <br/> LLM: You run a fitness studio. Would re-engaging inactive members by phone help? <br/> user: We lose a lot of them, so yes. <br/> LLM: Let us book a strategy call for Monday. <br/> user: Perfect. <br/>' },
  { id: 91008, bot_name: agent.name, time_of_call: d(8, '16:22:41'), from_number: '+91 80 4879 9695', to_number: '+91 99001 23456', call_direction: 'outbound', call_duration: '1:12', recording_url: false, call_status: 'failed', channel_type: 'Phone', sentiment_score: '', sentiment_analysis_details: 'Call dropped due to poor network on the recipient side.', call_conversation: '' },
  { id: 91009, bot_name: agent.name, time_of_call: d(8, '15:48:12'), from_number: '+91 80 4879 9695', to_number: '+91 90123 45678', call_direction: 'outbound', call_duration: '5:02', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Positive', sentiment_analysis_details: 'Manufacturing SME; strong interest in automating supplier follow-ups.', call_conversation: ' <br/> LLM: Hi, Riya from MNB Research. Is this Mr. Nair? <br/> user: Yes, go ahead. <br/> LLM: Chasing suppliers and quotes by phone is time-consuming. We can automate it. Worth a chat? <br/> user: Definitely, set it up. <br/>' },
  { id: 91010, bot_name: agent.name, time_of_call: d(8, '15:10:59'), from_number: '+91 80 4879 9695', to_number: '+91 98200 99881', call_direction: 'outbound', call_duration: '2:07', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Negative', sentiment_analysis_details: 'Prospect was busy and asked not to be called again.', call_conversation: ' <br/> LLM: Hello, Riya from MNB Research calling. <br/> user: I am in a meeting, please do not call again. <br/> LLM: Understood, apologies for the interruption. Have a good day. <br/>' },
  { id: 91011, bot_name: agent.name, time_of_call: d(8, '14:33:20'), from_number: '+91 80 4879 9695', to_number: '+91 91555 20031', call_direction: 'outbound', call_duration: '3:29', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Positive', sentiment_analysis_details: 'Coaching-institute owner interested in AI to handle admission enquiries.', call_conversation: ' <br/> LLM: Hi, Riya from MNB Research. Am I speaking with Sneha? <br/> user: Yes. <br/> LLM: During admission season, do enquiry calls overwhelm your team? <br/> user: Every single year. <br/> LLM: Our AI can answer and qualify each one. Shall we book a call? <br/> user: Yes, that would be a relief. <br/>' },
  { id: 91012, bot_name: agent.name, time_of_call: d(8, '11:59:03'), from_number: '+91 80 4879 9695', to_number: '+91 98999 71234', call_direction: 'outbound', call_duration: '1:44', recording_url: false, call_status: 'completed', channel_type: 'Phone', sentiment_score: 'Neutral', sentiment_analysis_details: 'Requested a callback next week; timing not right currently.', call_conversation: ' <br/> LLM: Hello, this is Riya from MNB Research. <br/> user: Can you call me next week? Bit busy now. <br/> LLM: Of course, I will follow up then. Thank you! <br/>' },
];

const knowledge = [
  { id: 95001, name: 'MNB Research - Services Overview.pdf', original_filename: 'MNB Research - Services Overview.pdf', file_size: 184320, mime_type: 'application/pdf', upload_status: 'uploaded', upload_date: '07/08/2026 10:12:00', user_name: 'MNB Research' },
  { id: 95002, name: 'AI Voice Agent - Pricing 2026.pdf', original_filename: 'AI Voice Agent - Pricing 2026.pdf', file_size: 96500, mime_type: 'application/pdf', upload_status: 'uploaded', upload_date: '07/08/2026 10:18:00', user_name: 'MNB Research' },
];

const numbers = [
  { id: 96001, phone_number: '+91 80 4879 9695', bot_name: agent.name },
];

const campaigns = [
  { id: 97001, name: 'Real Estate Outreach - July', bot_name: agent.name, status: 'completed', total_contacts: 120, created_at: '07/07/2026' },
  { id: 97002, name: 'Dental Clinics - Follow-up', bot_name: agent.name, status: 'running', total_contacts: 64, created_at: '07/09/2026' },
];

function pagedLogs(page = 1, size = 20, status = '') {
  let list = logs;
  if (status) list = list.filter((l) => l.call_status === status);
  const start = (page - 1) * size;
  return { call_log_data: list.slice(start, start + size), total_records: list.length };
}

module.exports = { AGENT_ID, agent, logs, knowledge, numbers, campaigns, pagedLogs };
