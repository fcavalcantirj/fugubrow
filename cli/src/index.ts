import { Command } from "commander";
import { deploy } from "./deploy.js";

const program = new Command();
program
  .name("trustclaw")
  .description("Deploy trustclaw to Vercel")
  .version("0.1.0");

program
  .command("deploy")
  .description("Deploy a fresh trustclaw instance to Vercel")
  .action(deploy);

program.parseAsync();
