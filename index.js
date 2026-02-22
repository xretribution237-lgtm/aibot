const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Store per-user conversation history (in-memory, resets on restart)
const conversationHistory = new Map();
const MAX_HISTORY = 10; // Keep last 10 messages (5 exchanges)

const SYSTEM_PROMPT = `You are a friendly and helpful assistant living inside a Discord server.
You are warm, approachable, and genuinely enjoy helping people.
Keep your responses concise and conversational — this is a chat environment, not an essay.
If you don't know something, say so honestly rather than guessing.`;

const PREFIX = '?bot ';
const HF_MODEL = 'meta-llama/Meta-Llama-3-8B-Instruct';

async function askLlama(history) {
  // Build prompt in LLaMA 3 chat format
  let prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${SYSTEM_PROMPT}<|eot_id|>`;

  for (const msg of history) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    prompt += `<|start_header_id|>${role}<|end_header_id|>\n${msg.content}<|eot_id|>`;
  }

  prompt += `<|start_header_id|>assistant<|end_header_id|>\n`;

  const response = await fetch(
    `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 512,
          temperature: 0.7,
          top_p: 0.9,
          do_sample: true,
          return_full_text: false,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HF API error ${response.status}: ${err}`);
  }

  const data = await response.json();

  // Handle model loading state (HF cold-starts free models)
  if (data.error && data.error.includes('loading')) {
    throw new Error('MODEL_LOADING');
  }

  const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
  if (!text) throw new Error('No text returned from model');

  // Strip any trailing special tokens
  return text.replace(/<\|eot_id\|>.*/s, '').trim();
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const userMessage = message.content.slice(PREFIX.length).trim();
  if (!userMessage) {
    return message.reply('Hey! You forgot to include a message. Try: `?bot hello!`');
  }

  const userId = message.author.id;

  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  const history = conversationHistory.get(userId);

  history.push({ role: 'user', content: userMessage });
  while (history.length > MAX_HISTORY) history.shift();

  await message.channel.sendTyping();

  try {
    const replyText = await askLlama(history);
    history.push({ role: 'assistant', content: replyText });

    if (replyText.length <= 2000) {
      await message.reply(replyText);
    } else {
      const chunks = replyText.match(/.{1,1900}/gs);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);

    if (error.message === 'MODEL_LOADING') {
      await message.reply('⏳ The AI model is warming up (this happens after idle periods). Wait ~20 seconds and try again!');
    } else {
      await message.reply('Sorry, something went wrong on my end. Please try again in a moment!');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
