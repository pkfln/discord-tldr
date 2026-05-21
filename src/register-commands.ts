import { tldrCommand } from "./commands/tldr";
import { loadRegisterConfig } from "./config";
import { REST, Routes } from "discord.js";

const config = loadRegisterConfig();

const rest = new REST({ version: "10" }).setToken(config.discordToken);
const body = [tldrCommand.toJSON()];

if (config.discordGuildId) {
  await rest.put(
    Routes.applicationGuildCommands(
      config.discordClientId,
      config.discordGuildId
    ),
    {
      body,
    }
  );

  console.log(`Registered /tldr for guild ${config.discordGuildId}`);
} else {
  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body,
  });

  console.log("Registered /tldr globally");
}
