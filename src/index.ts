import { handleTldrCommand } from "./commands/tldr";
import { loadBotConfig } from "./config";
import { GroqClient } from "./llm/groq";
import { RateLimiter } from "./rateLimit";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type InteractionReplyOptions,
} from "discord.js";

const config = loadBotConfig();
const groq = new GroqClient(config);
const rateLimiter = new RateLimiter(config);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "tldr") return;

  try {
    await handleTldrCommand(interaction, { config, groq, rateLimiter });
  } catch (error) {
    console.error("Unhandled interaction error", {
      error: error instanceof Error ? error.message : "unknown error",
      command: interaction.commandName,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });

    const payload: InteractionReplyOptions = {
      content:
        "Something went wrong while handling this command. Please try again later.",
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }
});

await client.login(config.discordToken);
