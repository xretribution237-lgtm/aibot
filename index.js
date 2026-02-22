const { Client, GatewayIntentBits } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store per-user conversation history (in-memory, resets on restart)
// Map: userId -> array of { role, content }
const conversationHistory = new Map();
const MAX_HISTORY = 10; // Keep last 10 messages per user (5 exchanges)

const SYSTEM_PROMPT = `You are a friendly and helpful assistant living inside a Discord server. 
You are warm, approachable, and genuinely enjoy helping people. 
Keep your responses concise and conversational — this is a chat environment, not an essay.
Use Discord markdown (like **bold**, *italics*, \`code\`) when it helps readability.
If you don't know something, say so honestly rather than guessing.`;

const PREFIX = '?bot ';

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore bots and messages without the prefix
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const userMessage = message.content.slice(PREFIX.length).trim();
  if (!userMessage) {
    return message.reply('Hey! You forgot to include a message. Try: `?bot hello!`');
  }

  const userId = message.author.id;

  // Get or initialize this user's history
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  const history = conversationHistory.get(userId);

  // Add user message to history
  history.push({ role: 'user', content: userMessage });

  // Trim history to max size (keep last MAX_HISTORY messages)
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const replyText = response.content[0].text;

    // Add assistant reply to history
    history.push({ role: 'assistant', content: replyText });

    // Discord has a 2000 character limit — split if needed
    if (replyText.length <= 2000) {
      await message.reply(replyText);
    } else {
      // Split into chunks of 1900 chars to leave room for reply header
      const chunks = replyText.match(/.{1,1900}/gs);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }
  } catch (error) {
    console.error('Error calling Claude API:', error);
    await message.reply('Sorry, something went wrong on my end. Please try again in a moment!');
  }
});

client.login(process.env.DISCORD_TOKEN);
